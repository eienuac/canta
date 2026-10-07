-- Atomic coupon limit check.
-- Call it right AFTER inserting the pending order. Orders are ranked by (created_at, id):
-- an order is only accepted if the number of paid usages + earlier pending orders is still
-- below the limit. The advisory lock serialises concurrent checkouts for the same coupon,
-- so two simultaneous checkouts can no longer both slip past `usage_limit` / `per_user_limit`.

create or replace function public.coupon_claim_ok(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  c public.coupons%rowtype;
  used integer;
  ahead integer;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return false; end if;
  if o.coupon_code is null then return true; end if;

  select * into c from public.coupons where code = o.coupon_code;
  if not found then return false; end if;

  perform pg_advisory_xact_lock(hashtext('coupon:' || c.id::text));

  if c.usage_limit is not null then
    select count(*) into used from public.coupon_usages where coupon_id = c.id;
    select count(*) into ahead from public.orders
      where coupon_code = o.coupon_code
        and payment_status = 'pending'
        and created_at > now() - interval '30 minutes'
        and (created_at, id) < (o.created_at, o.id);
    if used + ahead >= c.usage_limit then return false; end if;
  end if;

  if c.per_user_limit is not null then
    if o.user_id is not null then
      select count(*) into used from public.coupon_usages
        where coupon_id = c.id and user_id = o.user_id;
      select count(*) into ahead from public.orders
        where coupon_code = o.coupon_code and user_id = o.user_id
          and payment_status = 'pending'
          and created_at > now() - interval '30 minutes'
          and (created_at, id) < (o.created_at, o.id);
    elsif o.guest_email is not null then
      select count(*) into used from public.coupon_usages
        where coupon_id = c.id and guest_email = o.guest_email;
      select count(*) into ahead from public.orders
        where coupon_code = o.coupon_code and guest_email = o.guest_email
          and payment_status = 'pending'
          and created_at > now() - interval '30 minutes'
          and (created_at, id) < (o.created_at, o.id);
    else
      used := 0; ahead := 0;
    end if;
    if used + ahead >= c.per_user_limit then return false; end if;
  end if;

  return true;
end;
$$;

revoke execute on function public.coupon_claim_ok(uuid) from public, anon, authenticated;
grant execute on function public.coupon_claim_ok(uuid) to service_role;

notify pgrst, 'reload schema';
