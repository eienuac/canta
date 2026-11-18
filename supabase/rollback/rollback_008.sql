-- ROLLBACK 008 — removes the payment functions and restores the previous is_admin().
-- Non-destructive: new columns, their data (paid_price, refund records…) and the enum value
-- 'payment_review' are KEPT; they are ignored by the previous application version.
-- Precondition: no order may still be in payment_review (the previous version does not know it).
do $$
begin
  if exists (select 1 from public.orders where status = 'payment_review') then
    raise exception 'resolve payment_review orders first (approve, or refund + cancel)';
  end if;
end $$;

drop function if exists public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb);
drop function if exists public.approve_payment_review(uuid, uuid, text);
drop function if exists public.record_manual_refund(uuid, uuid, text);
drop function if exists public.commit_order_stock(uuid);

-- is_admin() as defined in 001
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

notify pgrst, 'reload schema';
