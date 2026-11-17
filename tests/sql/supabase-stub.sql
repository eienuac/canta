-- Minimal stand-ins for the Supabase / Payload objects the migrations reference, so the
-- real supabase/migrations/*.sql files can be applied to a plain local PostgreSQL in tests.
-- Column sets for payload.* mirror the production tables that the migrations touch.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  email_confirmed_at timestamptz,
  banned_until timestamptz,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
-- Tests impersonate a user with: select set_config('request.jwt.claim.sub', '<uuid>', true)
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create schema payload;
create table payload.media (id serial primary key);
create table payload.users (id serial primary key, email varchar, role varchar);
create table payload.products (
  id serial primary key,
  sku varchar,
  stock numeric,
  _status varchar default 'published'
);
create unique index products_sku_idx on payload.products (sku);
create table payload.products_variants (
  _order integer not null default 1,
  _parent_id integer not null references payload.products (id) on delete cascade,
  id varchar primary key,
  sku varchar,
  stock numeric
);
