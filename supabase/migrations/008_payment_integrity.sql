-- 008 — Payment integrity (audit findings M2, H1, L5, L4)
--
--  M2  finalize_paid_order(): recording the payment, committing Supabase inventory AND the
--      Payload CMS stock happen in ONE database transaction. Stock is all-or-nothing (a
--      savepoint), so a crash or a shortage can never leave a paid order half-committed.
--  H1  The basket `price` is compared with the order total; `paid_price` (may include the
--      installment interest) is stored separately. Paid-but-inconsistent payments go to the
--      new `payment_review` status instead of being lost or auto-cancelled.
--  L5  Every checkout attempt keeps its own payments row/token. A second successful
--      payment for an already paid order (or a late payment for a cancelled/duplicate
--      order) is recorded and flagged for refund/review, never completed automatically.
--  L4  is_admin() also requires a verified, non-banned account.
--
--  Compatible with the application version deployed BEFORE it (new columns/functions only).
--  The order transition guard that requires the new application code is in 009.
--  Deploy order: 008 → application → 009. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------
alter type public.order_status add value if not exists 'payment_review' after 'pending_payment';

alter table public.orders
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists stock_committed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists reviewed_at timestamptz;

alter table public.payments
  add column if not exists price numeric(12, 2),
  add column if not exists paid_price numeric(12, 2),
  add column if not exists installment integer,
  add column if not exists provider_reference text,
  add column if not exists superseded_at timestamptz,
  add column if not exists refund_state text not null default 'none',
  add column if not exists refund_reference text,
  add column if not exists refunded_at timestamptz;

do $$ begin
  alter table public.payments
    add constraint payments_refund_state_check
    check (refund_state in ('none', 'required', 'requested', 'processing', 'succeeded', 'failed'));
exception when duplicate_object then null;
end $$;

create index if not exists payments_provider_payment_id_idx on public.payments (provider_payment_id);
create index if not exists orders_needs_review_idx on public.orders (needs_review) where needs_review;
create unique index if not exists coupon_usages_order_id_key
  on public.coupon_usages (order_id) where order_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Backfill (before the guard trigger exists)
-- ---------------------------------------------------------------------------
update public.orders o
set stock_committed_at = l.committed_at
from (
  select order_id, min(created_at) as committed_at
  from public.inventory_ledger
  where reason = 'commit' and order_id is not null
  group by order_id
) l
where l.order_id = o.id and o.payment_status = 'paid' and o.stock_committed_at is null;

update public.orders
set needs_review = true, review_reason = coalesce(review_reason, 'BACKFILL_NO_STOCK_COMMIT')
where payment_status = 'paid' and stock_committed_at is null;

update public.payments
set provider_reference = raw_response ->> 'paymentId'
where provider_reference is null and raw_response ? 'paymentId';

-- ---------------------------------------------------------------------------
-- 3) Stock: reserve (if needed) + commit inventory + commit Payload CMS stock
--    Raises on any shortage / ambiguity. Callers run it inside a savepoint.
-- ---------------------------------------------------------------------------
create or replace function public.commit_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders%rowtype;
  it record;
  n integer;
  live_reservation boolean;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then raise exception 'order % not found', p_order_id; end if;

  for it in
    select product_sku_snapshot as sku, sum(quantity)::integer as qty
    from public.order_items where order_id = p_order_id
    group by product_sku_snapshot order by product_sku_snapshot
  loop
    if exists (select 1 from public.inventory_ledger
               where idempotency_key = 'order:' || p_order_id || ':commit:' || it.sku) then
      continue; -- already committed
    end if;

    -- Is the checkout reservation for this line still held?
    live_reservation :=
      exists (select 1 from public.inventory_ledger where idempotency_key in (
        o.idempotency_key || ':reserve:' || it.sku,
        'late:' || p_order_id || ':reserve:' || it.sku,
        'review:' || p_order_id || ':reserve:' || it.sku))
      and not exists (select 1 from public.inventory_ledger where idempotency_key in (
        o.idempotency_key || ':release:' || it.sku,
        'cancel:' || p_order_id || ':release:' || it.sku));

    if not live_reservation then
      update public.inventory
      set reserved_quantity = reserved_quantity + it.qty, updated_at = now()
      where sku = it.sku and quantity - reserved_quantity >= it.qty;
      get diagnostics n = row_count;
      if n <> 1 then raise exception 'insufficient stock for %', it.sku; end if;
      insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key)
      values (it.sku, p_order_id, it.qty, 'reserve', 'review:' || p_order_id || ':reserve:' || it.sku);
    end if;

    update public.inventory
    set quantity = quantity - it.qty,
        reserved_quantity = reserved_quantity - it.qty,
        updated_at = now()
    where sku = it.sku and quantity >= it.qty and reserved_quantity >= it.qty;
    get diagnostics n = row_count;
    if n <> 1 then raise exception 'cannot commit stock for %', it.sku; end if;
    insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key)
    values (it.sku, p_order_id, -it.qty, 'commit', 'order:' || p_order_id || ':commit:' || it.sku);

    -- Payload CMS stock: a variant SKU or a product SKU of a product without variants.
    if exists (select 1 from payload.products_variants where sku = it.sku) then
      update payload.products_variants set stock = stock - it.qty
      where sku = it.sku and stock >= it.qty;
      get diagnostics n = row_count;
      if n <> 1 then raise exception 'insufficient CMS variant stock for %', it.sku; end if;
    else
      update payload.products p set stock = p.stock - it.qty
      where p.sku = it.sku and p.stock >= it.qty
        and not exists (select 1 from payload.products_variants v where v._parent_id = p.id);
      get diagnostics n = row_count;
      if n <> 1 then raise exception 'insufficient or missing CMS product stock for %', it.sku; end if;
    end if;
    insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key)
    values (it.sku, p_order_id, 0, 'cms_commit', 'order:' || p_order_id || ':cms:' || it.sku);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Finalize a verified payment (called after the provider result was verified)
-- ---------------------------------------------------------------------------
create or replace function public.finalize_paid_order(
  p_order_id uuid,
  p_token text,                 -- checkout token we issued (null only for signed webhooks)
  p_provider_reference text,    -- provider payment id
  p_price numeric,              -- basket price reported by the provider
  p_paid_price numeric,         -- amount charged (may include installment interest)
  p_currency text,
  p_installment integer,
  p_summary jsonb               -- whitelisted provider response (no card data)
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders%rowtype;
  pay public.payments%rowtype;
  reason text;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;

  if p_token is not null then
    select * into pay from public.payments
    where order_id = p_order_id and provider_payment_id = p_token
    order by created_at desc limit 1 for update;
    if not found then raise exception 'payment token mismatch'; end if;
  else
    select * into pay from public.payments
    where order_id = p_order_id and superseded_at is null
    order by created_at desc limit 1 for update;
    if not found then raise exception 'payment not found for order %', p_order_id; end if;
  end if;

  if pay.status = 'paid' then
    return jsonb_build_object('result', 'duplicate', 'order_status', o.status, 'payment_status', o.payment_status);
  end if;

  -- 1) The money is always recorded first.
  update public.payments
  set status = 'paid',
      price = p_price,
      paid_price = p_paid_price,
      installment = p_installment,
      provider_reference = coalesce(p_provider_reference, provider_reference),
      raw_response = p_summary,
      updated_at = now()
  where id = pay.id;

  -- 2) The order was already paid by another attempt → second charge, refund needed.
  if o.payment_status = 'paid' then
    update public.payments set refund_state = 'required', updated_at = now() where id = pay.id;
    update public.orders
    set needs_review = true,
        review_reason = coalesce(review_reason || '; ', '') || 'DUPLICATE_PAYMENT',
        updated_at = now()
    where id = o.id;
    return jsonb_build_object('result', 'duplicate_payment');
  end if;

  -- 3) Consistency checks. Any failure → payment_review (never auto-complete, never lose).
  if p_currency is not null and upper(p_currency) <> upper(o.currency) then
    reason := 'CURRENCY_MISMATCH';
  elsif p_price is null or abs(p_price - o.total) > 0.01 then
    reason := 'AMOUNT_MISMATCH';
  elsif p_paid_price is null or p_paid_price + 0.01 < p_price then
    reason := 'PAID_LESS_THAN_PRICE';
  elsif o.payment_status <> 'pending' then
    reason := 'LATE_PAYMENT';
  elsif o.cart_id is not null and exists (
    select 1 from public.orders x
    where x.cart_id = o.cart_id and x.id <> o.id and x.payment_status = 'paid'
      and x.total = o.total and abs(extract(epoch from (x.created_at - o.created_at))) < 7200
  ) then
    reason := 'POSSIBLE_DUPLICATE_ORDER';
  end if;

  if reason is not null then
    update public.orders
    set payment_status = 'paid', status = 'payment_review', needs_review = true,
        review_reason = reason, updated_at = now()
    where id = o.id;
    return jsonb_build_object('result', 'review', 'reason', reason);
  end if;

  -- 4) Stock: all or nothing (savepoint). A shortage keeps the payment and sends the
  --    order to review with no partial stock change.
  begin
    perform public.commit_order_stock(o.id);
    update public.orders
    set payment_status = 'paid', status = 'payment_received',
        stock_committed_at = now(), updated_at = now()
    where id = o.id;
  exception when others then
    update public.orders
    set payment_status = 'paid', status = 'payment_review', needs_review = true,
        review_reason = 'STOCK: ' || left(sqlerrm, 200), updated_at = now()
    where id = o.id;
    return jsonb_build_object('result', 'review', 'reason', 'STOCK');
  end;

  -- 5) Side effects of a completed order.
  if o.coupon_code is not null then
    insert into public.coupon_usages (coupon_id, user_id, order_id, guest_email)
    select c.id, o.user_id, o.id, o.guest_email from public.coupons c where c.code = o.coupon_code
    on conflict (order_id) where order_id is not null do nothing;
  end if;
  if o.cart_id is not null then
    delete from public.cart_items where cart_id = o.cart_id;
  end if;

  return jsonb_build_object('result', 'paid');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Admin: approve a payment_review order (commits stock or fails cleanly)
-- ---------------------------------------------------------------------------
create or replace function public.approve_payment_review(p_order_id uuid, p_admin_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order % not found', p_order_id; end if;
  if o.status <> 'payment_review' or o.payment_status <> 'paid' then
    raise exception 'order is not awaiting payment review';
  end if;

  perform public.commit_order_stock(o.id); -- raises → whole call rolls back, order unchanged

  update public.orders
  set status = 'payment_received', stock_committed_at = now(), needs_review = false,
      reviewed_by = p_admin_id, reviewed_at = now(),
      notes = case when coalesce(p_note, '') = '' then notes
                   else coalesce(notes || ';', '') || 'REVIEW:' || p_note end,
      updated_at = now()
  where id = o.id;

  if o.coupon_code is not null then
    insert into public.coupon_usages (coupon_id, user_id, order_id, guest_email)
    select c.id, o.user_id, o.id, o.guest_email from public.coupons c where c.code = o.coupon_code
    on conflict (order_id) where order_id is not null do nothing;
  end if;
  return jsonb_build_object('result', 'approved');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Admin: record a refund made manually in the iyzico panel (full refund)
--    The order becomes `refunded` only through here, with a provider reference.
-- ---------------------------------------------------------------------------
create or replace function public.record_manual_refund(
  p_payment_id uuid, p_admin_id uuid, p_reference text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments%rowtype;
  o public.orders%rowtype;
  open_paid integer;
begin
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'refund reference is required';
  end if;
  select * into pay from public.payments where id = p_payment_id for update;
  if not found then raise exception 'payment % not found', p_payment_id; end if;
  if pay.status <> 'paid' or pay.refund_state = 'succeeded' then
    raise exception 'payment is not refundable';
  end if;
  select * into o from public.orders where id = pay.order_id for update;

  update public.payments
  set refund_state = 'succeeded', refund_reference = trim(p_reference), refunded_at = now(), updated_at = now()
  where id = pay.id;

  -- Order-level status: refunded once no paid, un-refunded payment remains.
  select count(*) into open_paid from public.payments
  where order_id = o.id and status = 'paid' and refund_state <> 'succeeded';

  if open_paid = 0 and o.payment_status in ('paid', 'partially_refunded') then
    update public.orders
    set payment_status = 'refunded', needs_review = false,
        reviewed_by = p_admin_id, reviewed_at = now(), updated_at = now()
    where id = o.id;
  elsif open_paid = 0 then
    null;
  else
    -- a duplicate charge was refunded; the order itself stays paid
    update public.orders
    set needs_review = exists (
          select 1 from public.payments
          where order_id = o.id and refund_state in ('required', 'requested', 'processing', 'failed')),
        updated_at = now()
    where id = o.id;
  end if;
  return jsonb_build_object('result', 'refunded', 'order_fully_refunded', open_paid = 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) L4: admin requires a verified, non-banned account (RLS helper)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.role = 'admin'
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;

-- ---------------------------------------------------------------------------
-- 8) Privileges: the payment functions are server-only
-- ---------------------------------------------------------------------------
revoke execute on function public.commit_order_stock(uuid) from public, anon, authenticated, service_role;
revoke execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  from public, anon, authenticated;
revoke execute on function public.approve_payment_review(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.record_manual_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  to service_role;
grant execute on function public.approve_payment_review(uuid, uuid, text) to service_role;
grant execute on function public.record_manual_refund(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
