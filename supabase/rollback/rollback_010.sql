-- ROLLBACK 010 — restores the 008/009 functions. Non-destructive: the payment_refunds table,
-- payments.refunded_amount and their data are KEPT (ignored by the 008/009 functions).
-- Restores: 3-argument record_manual_refund (full refunds only), the 008 duplicate-order rule,
-- the 009 guard, and removes the two 010 triggers.

drop trigger if exists orders_release_review_stock on public.orders;
drop function if exists public.release_review_order_stock();
drop trigger if exists return_requests_refund_guard on public.return_requests;
drop function if exists public.return_request_refund_guard();

drop function if exists public.record_manual_refund(uuid, uuid, text, numeric);
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
  -- Lock order: ORDER first, then PAYMENT — the same order as finalize_paid_order, so a
  -- concurrent payment callback and a manual refund on one order cannot deadlock.
  select order_id into o.id from public.payments where id = p_payment_id;
  if not found then raise exception 'payment % not found', p_payment_id; end if;
  select * into o from public.orders where id = o.id for update;
  select * into pay from public.payments where id = p_payment_id for update;
  if pay.status <> 'paid' or pay.refund_state = 'succeeded' then
    raise exception 'payment is not refundable';
  end if;

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
      select 1 from public.payments where order_id = new.id and refund_state = 'succeeded'
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

-- partial refunds have no 008 equivalent: keep their state readable for the 008 functions
alter table public.payments drop constraint if exists payments_refund_state_check;
alter table public.payments
  add constraint payments_refund_state_check
  check (refund_state in ('none', 'required', 'requested', 'processing', 'partial', 'succeeded', 'failed'));

revoke execute on function public.record_manual_refund(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_manual_refund(uuid, uuid, text) to service_role;
revoke execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)
  to service_role;
revoke execute on function public.orders_transition_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
