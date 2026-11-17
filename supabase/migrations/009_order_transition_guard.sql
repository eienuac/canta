-- 009 — Order transition guard (audit findings M2/H1/L5 follow-up)
--
-- Apply AFTER the application version that finalizes payments through
-- public.finalize_paid_order (migration 008) is deployed: the previous application code
-- marked orders as payment_received before committing stock, which this guard rejects.
-- Safe to re-run.

-- Orders paid by the previous application version between 008 and this migration.
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

-- ---------------------------------------------------------------------------
-- Order transition guard (applies to every writer, service role included)
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

drop trigger if exists orders_transition_guard on public.orders;
create trigger orders_transition_guard
  before update of status, payment_status on public.orders
  for each row execute function public.orders_transition_guard();

revoke execute on function public.orders_transition_guard() from public, anon, authenticated;
