-- The /account/addresses page reads and writes public.addresses, but the table was never
-- created in the live database (only in the TypeScript types). Create it with strict RLS.

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text check (title is null or char_length(title) <= 60),
  first_name text not null check (char_length(first_name) between 1 and 80),
  last_name text not null check (char_length(last_name) between 1 and 80),
  phone text not null check (char_length(phone) between 7 and 24),
  city text not null check (char_length(city) between 1 and 80),
  district text check (district is null or char_length(district) <= 80),
  neighborhood text check (neighborhood is null or char_length(neighborhood) <= 120),
  address_line text not null check (char_length(address_line) between 5 and 300),
  postal_code text check (postal_code is null or char_length(postal_code) <= 12),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists addresses_user_id_idx on public.addresses (user_id);

-- At most 10 saved addresses per user (prevents the table being used as free storage).
create or replace function public.limit_addresses_per_user()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.addresses where user_id = new.user_id) >= 10 then
    raise exception 'address limit reached' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists addresses_limit on public.addresses;
create trigger addresses_limit
  before insert on public.addresses
  for each row execute function public.limit_addresses_per_user();

alter table public.addresses enable row level security;

-- Only the owner can see / change their own addresses.
drop policy if exists addresses_select_own on public.addresses;
drop policy if exists addresses_insert_own on public.addresses;
drop policy if exists addresses_update_own on public.addresses;
drop policy if exists addresses_delete_own on public.addresses;

create policy addresses_select_own on public.addresses
  for select to authenticated using (auth.uid() = user_id);
create policy addresses_insert_own on public.addresses
  for insert to authenticated with check (auth.uid() = user_id);
create policy addresses_update_own on public.addresses
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy addresses_delete_own on public.addresses
  for delete to authenticated using (auth.uid() = user_id);

-- Explicit grants only (Supabase default privileges would otherwise hand out everything).
revoke all on table public.addresses from anon, authenticated;
grant select, insert, delete on table public.addresses to authenticated;
grant update (title, first_name, last_name, phone, city, district, neighborhood,
              address_line, postal_code, is_default, updated_at)
  on table public.addresses to authenticated;
grant all on table public.addresses to service_role;

notify pgrst, 'reload schema';
