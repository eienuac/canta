-- 003 — Security hardening (idempotent; safe to re-run).
-- Supersedes the RLS/grant parts of 001_initial_schema.sql. The live database never had
-- the reviews/returns/coupons/addresses policies from 001, so those tables stay "deny all"
-- for browser clients and are only reachable through server routes (service role).

begin;

-- ---------------------------------------------------------------------------
-- 1) profiles: a customer must NEVER be able to change their own role.
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon;
revoke insert, update, delete, truncate, references, trigger on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (first_name, last_name, phone, updated_at) on table public.profiles to authenticated;

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;

-- Defence in depth: even with a future broad grant, role changes need the service role.
create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'role can only be changed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_role_change on public.profiles;
create trigger profiles_prevent_role_change
  before update on public.profiles
  for each row execute function public.prevent_profile_role_change();

-- ---------------------------------------------------------------------------
-- 2) Table privileges: anonymous visitors touch nothing directly; signed-in users
--    only what the browser client really needs (favorites, own orders).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke truncate, references, trigger on table public.%I from authenticated', t);
  end loop;
end $$;

-- Server-only tables (service role): no browser access at all.
do $$
declare t text;
begin
  foreach t in array array['carts','cart_items','coupons','coupon_usages','inventory','inventory_ledger',
                           'payments','reviews','return_requests','return_items']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from authenticated', t);
    end if;
  end loop;
end $$;

-- Browser needs: favorites (own rows), orders + order_items (own, read-only).
grant select, insert, update, delete on table public.favorites to authenticated;
revoke insert, update, delete on table public.orders, public.order_items from authenticated;
grant select on table public.orders, public.order_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Functions: stock RPCs + rls_auto_enable are server-only.
-- ---------------------------------------------------------------------------
revoke execute on function public.reserve_inventory(text, integer, text) from public, anon, authenticated;
revoke execute on function public.commit_inventory(text, integer, uuid, text) from public, anon, authenticated;
revoke execute on function public.release_inventory(text, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_inventory(text, integer, text) to service_role;
grant execute on function public.commit_inventory(text, integer, uuid, text) to service_role;
grant execute on function public.release_inventory(text, integer, text) to service_role;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Persistent rate limiting (shared across all serverless instances).
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);
alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from anon, authenticated;
grant select, insert, update, delete on table public.rate_limits to service_role;

create or replace function public.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  c integer;
begin
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count = case when r.reset_at < now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning r.count into c;

  return c <= p_limit;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Media bucket: images only, 10 MB max.
-- ---------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif','image/gif']
where id = 'media';

-- ---------------------------------------------------------------------------
-- 6) Align fresh installs with the live policy set (these never existed live).
-- ---------------------------------------------------------------------------
drop policy if exists "reviews_read_approved" on public.reviews;
drop policy if exists "reviews_insert_own" on public.reviews;
drop policy if exists "reviews_admin" on public.reviews;
drop policy if exists "returns_own" on public.return_requests;
drop policy if exists "return_items_own" on public.return_items;
drop policy if exists "coupons_read_active" on public.coupons;
drop policy if exists "coupons_admin" on public.coupons;
drop policy if exists "inventory_read" on public.inventory;
drop policy if exists "carts_own" on public.carts;
drop policy if exists "cart_items_via_cart" on public.cart_items;
drop policy if exists "payments_select" on public.payments;
drop policy if exists "payments_select_own" on public.payments;

commit;

notify pgrst, 'reload schema';
