-- 010 — Refund records, return-request guard, review-cancel stock release, duplicate-order rule
--
--  * payment_refunds: one row per refund made in the iyzico panel (partial refunds supported).
--    record_manual_refund(payment, admin, reference, amount default NULL = remaining amount);
--    calls without an amount (the application version before this migration) keep working.
--  * A return request can only be marked `refunded` after the order's refund is recorded.
--  * Cancelling an order that is still in payment_review (after its refund) releases the stock
--    reservation it held.
--  * POSSIBLE_DUPLICATE_ORDER is raised only for checkouts that were open at the same time
--    (order created before the other order of the same cart was paid), not for repeat purchases.
--
--  Compatible with the application version deployed before it. Safe to re-run.

-- ---------------------------------------------------------------------------
-- 1) Refund records
-- ---------------------------------------------------------------------------
create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  reference text not null check (length(trim(reference)) >= 3),
  mode text not null default 'manual' check (mode in ('manual', 'api')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (payment_id, reference)
);
create index if not exists payment_refunds_order_id_idx on public.payment_refunds (order_id);

alter table public.payment_refunds enable row level security;
revoke all on table public.payment_refunds from public, anon, authenticated;
grant select, insert on table public.payment_refunds to service_role;

alter table public.payments
  add column if not exists refunded_amount numeric(12, 2) not null default 0;

alter table public.payments drop constraint if exists payments_refund_state_check;
alter table public.payments
  add constraint payments_refund_state_check
  check (refund_state in ('none', 'required', 'requested', 'processing', 'partial', 'succeeded', 'failed'));

-- refunds recorded with the 008 function (full refunds) get a history row
insert into public.payment_refunds (payment_id, order_id, amount, reference, created_at)
select p.id, p.order_id, coalesce(p.paid_price, p.amount), coalesce(p.refund_reference, 'legacy-' || p.id),
       coalesce(p.refunded_at, now())
from public.payments p
where p.refund_state = 'succeeded'
  and not exists (select 1 from public.payment_refunds r where r.payment_id = p.id);

update public.payments
set refunded_amount = coalesce(paid_price, amount)
where refund_state = 'succeeded' and refunded_amount = 0;

-- ---------------------------------------------------------------------------
-- 2) Manual refund (full or partial). Lock order: ORDER, then PAYMENT.
-- ---------------------------------------------------------------------------
drop function if exists public.record_manual_refund(uuid, uuid, text);

create or replace function public.record_manual_refund(
  p_payment_id uuid, p_admin_id uuid, p_reference text, p_amount numeric default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pay public.payments%rowtype;
  o public.orders%rowtype;
  paid numeric;
  refundable numeric;
  amt numeric;
  was_duplicate boolean;
  new_refunded numeric;
  remaining numeric;
begin
  if coalesce(trim(p_reference), '') = '' or length(trim(p_reference)) < 3 then
    raise exception 'refund reference is required';
  end if;
  select order_id into o.id from public.payments where id = p_payment_id;
  if not found then raise exception 'payment % not found', p_payment_id; end if;
  select * into o from public.orders where id = o.id for update;
  select * into pay from public.payments where id = p_payment_id for update;

  paid := coalesce(pay.paid_price, pay.amount);
  refundable := paid - pay.refunded_amount;
  if pay.status <> 'paid' or refundable <= 0.001 then
    raise exception 'payment is not refundable';
  end if;
  amt := coalesce(p_amount, refundable);
  if amt <= 0 or amt > refundable + 0.001 then
    raise exception 'refund amount exceeds the refundable amount (%)', refundable;
  end if;
  if exists (select 1 from public.payment_refunds where payment_id = pay.id and reference = trim(p_reference)) then
    raise exception 'refund reference already recorded';
  end if;

  insert into public.payment_refunds (payment_id, order_id, amount, reference, created_by)
  values (pay.id, o.id, amt, trim(p_reference), p_admin_id);

  was_duplicate := pay.refund_state = 'required';
  new_refunded := pay.refunded_amount + amt;
  update public.payments
  set refunded_amount = new_refunded,
      refund_state = case
        when new_refunded >= paid - 0.001 then 'succeeded'
        when was_duplicate then 'required'
        else 'partial' end,
      refund_reference = trim(p_reference),
      refunded_at = now(),
      updated_at = now()
  where id = pay.id;

  -- what is still held from this order's paid payments
  select coalesce(sum(coalesce(paid_price, amount) - refunded_amount), 0) into remaining
  from public.payments where order_id = o.id and status = 'paid';

  if o.payment_status in ('paid', 'partially_refunded') then
    if remaining <= 0.001 then
      update public.orders set payment_status = 'refunded', updated_at = now() where id = o.id;
    elsif not was_duplicate then
      -- a refund of the order's own payment (a duplicate charge refund leaves the order paid)
      update public.orders set payment_status = 'partially_refunded', updated_at = now() where id = o.id;
    end if;
  end if;

  update public.orders
  set needs_review = (status = 'payment_review') or exists (
        select 1 from public.payments
        where order_id = o.id and refund_state in ('required', 'requested', 'processing', 'failed')),
      reviewed_by = coalesce(p_admin_id, reviewed_by),
      reviewed_at = now(),
      updated_at = now()
  where id = o.id;

  return jsonb_build_object(
    'result', 'refunded',
    'amount', amt,
    'payment_fully_refunded', new_refunded >= paid - 0.001,
    'order_fully_refunded', remaining <= 0.001
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Duplicate-order rule (finalize_paid_order from 008 with one changed condition)
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
      -- only checkouts that were open at the same time: this order was created BEFORE the
      -- other one was paid. Buying again after a completed order is a normal repeat purchase.
      and o.created_at < coalesce(
        x.stock_committed_at,
        (select min(p.updated_at) from public.payments p where p.order_id = x.id and p.status = 'paid'),
        now())
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
-- 4) Order guard (009) — a refund is proven by a payment_refunds row (partial refunds too)
-- ---------------------------------------------------------------------------
create or replace function public.orders_transition_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  ok boolean;
  old_p text := old.payment_status::text;
  new_p text := new.payment_status::text;
  old_s text := old.status::text;
  new_s text := new.status::text;
begin
  if new_p is distinct from old_p then
    ok := case old_p
      when 'pending' then new_p in ('paid', 'failed')
      when 'authorized' then new_p in ('paid', 'failed')
      when 'failed' then new_p = 'paid' and new_s = 'payment_review'
      when 'paid' then new_p in ('refunded', 'partially_refunded')
      when 'partially_refunded' then new_p in ('refunded', 'partially_refunded')
      else false
    end;
    if not ok then
      raise exception 'invalid payment_status transition % -> %', old_p, new_p using errcode = 'check_violation';
    end if;
    if new_p in ('refunded', 'partially_refunded') and not exists (
      select 1 from public.payment_refunds where order_id = new.id
    ) then
      raise exception 'order cannot be marked refunded without a completed refund' using errcode = 'check_violation';
    end if;
  end if;

  if new_s is distinct from old_s then
    ok := case old_s
      when 'pending_payment' then new_s in ('payment_received', 'payment_review', 'cancelled')
      when 'payment_review' then new_s in ('payment_received', 'cancelled')
      when 'payment_received' then new_s in ('preparing', 'shipped', 'cancelled')
      when 'preparing' then new_s in ('shipped', 'cancelled')
      when 'shipped' then new_s = 'delivered'
      when 'delivered' then new_s = 'returned'
      when 'cancelled' then new_s = 'payment_review'
      else false
    end;
    if not ok then
      raise exception 'invalid order status transition % -> %', old_s, new_s using errcode = 'check_violation';
    end if;
  end if;

  -- Rules for entering a status (a refund on its own does not move the order).
  if new_s is distinct from old_s then
    if new_s in ('payment_received', 'preparing', 'shipped', 'delivered')
       and (new_p <> 'paid' or new.stock_committed_at is null) then
      raise exception 'order must be paid with stock committed for status %', new_s using errcode = 'check_violation';
    end if;
    if new_s = 'cancelled' and new_p not in ('pending', 'failed', 'refunded') then
      raise exception 'a paid order can only be cancelled after a refund' using errcode = 'check_violation';
    end if;
    if new_s = 'returned' and new_p not in ('refunded', 'partially_refunded') then
      raise exception 'a returned order must be refunded first' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Cancelling a payment_review order releases the reservation it still holds
-- ---------------------------------------------------------------------------
create or replace function public.release_review_order_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  it record;
  live boolean;
begin
  if not (old.status::text = 'payment_review' and new.status::text = 'cancelled' and new.stock_committed_at is null) then
    return new;
  end if;
  for it in
    select product_sku_snapshot as sku, sum(quantity)::integer as qty
    from public.order_items where order_id = new.id
    group by product_sku_snapshot order by product_sku_snapshot
  loop
    live :=
      exists (select 1 from public.inventory_ledger where idempotency_key in (
        new.idempotency_key || ':reserve:' || it.sku,
        'late:' || new.id || ':reserve:' || it.sku,
        'review:' || new.id || ':reserve:' || it.sku))
      and not exists (select 1 from public.inventory_ledger where idempotency_key in (
        new.idempotency_key || ':release:' || it.sku,
        'cancel:' || new.id || ':release:' || it.sku));
    if live then
      update public.inventory
      set reserved_quantity = greatest(reserved_quantity - it.qty, 0), updated_at = now()
      where sku = it.sku;
      insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key)
      values (it.sku, new.id, -it.qty, 'release', 'cancel:' || new.id || ':release:' || it.sku);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists orders_release_review_stock on public.orders;
create trigger orders_release_review_stock
  after update of status on public.orders
  for each row execute function public.release_review_order_stock();

-- ---------------------------------------------------------------------------
-- 6) A return request is `refunded` only after the order's refund is recorded
-- ---------------------------------------------------------------------------
create or replace function public.return_request_refund_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status::text = 'refunded'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not exists (
       select 1 from public.orders
       where id = new.order_id and payment_status::text in ('refunded', 'partially_refunded')
     ) then
    raise exception 'return cannot be marked refunded before the payment refund is recorded'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists return_requests_refund_guard on public.return_requests;
create trigger return_requests_refund_guard
  before insert or update of status on public.return_requests
  for each row execute function public.return_request_refund_guard();

-- ---------------------------------------------------------------------------
-- 7) Privileges
-- ---------------------------------------------------------------------------
revoke execute on function public.record_manual_refund(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.record_manual_refund(uuid, uuid, text, numeric) to service_role;
revoke execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  to service_role;
revoke execute on function public.release_review_order_stock() from public, anon, authenticated, service_role;
revoke execute on function public.return_request_refund_guard() from public, anon, authenticated, service_role;
revoke execute on function public.orders_transition_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
