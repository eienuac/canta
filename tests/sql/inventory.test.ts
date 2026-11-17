/**
 * Runs the real inventory RPCs (supabase/migrations/002) on a local PostgreSQL and checks
 * them under concurrency. Skipped unless TEST_DATABASE_URL points to a local database.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { createTestPool, testDatabaseUrl } from '../helpers/pg'

const enabled = Boolean(testDatabaseUrl())

// Schema subset from 001_initial_schema.sql that the RPCs depend on.
const BASE_SCHEMA = `
  drop table if exists public.inventory_ledger, public.inventory, public.orders, public.carts cascade;
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create table public.carts (id uuid primary key default gen_random_uuid());
  create table public.orders (id uuid primary key default gen_random_uuid());
  create table public.inventory (
    id uuid primary key default gen_random_uuid(),
    sku text not null unique,
    product_id text not null,
    variant_id text,
    quantity integer not null default 0 check (quantity >= 0),
    reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
    updated_at timestamptz not null default now(),
    constraint inventory_available_check check (quantity >= reserved_quantity)
  );
  create table public.inventory_ledger (
    id uuid primary key default gen_random_uuid(),
    sku text not null,
    order_id uuid,
    delta integer not null,
    reason text not null,
    idempotency_key text not null unique,
    created_at timestamptz not null default now()
  );
`

describe.skipIf(!enabled)('inventory RPCs (002) on PostgreSQL', () => {
  let pool: Pool

  const call = (sql: string, params: unknown[]) =>
    pool.query(sql, params).then(
      (r) => r.rows[0]?.ok as boolean,
      () => 'error' as const
    )
  const stock = async (sku: string) =>
    (await pool.query('select quantity, reserved_quantity from public.inventory where sku = $1', [sku])).rows[0]

  beforeAll(async () => {
    pool = createTestPool()
    await pool.query(BASE_SCHEMA)
    await pool.query(readFileSync('supabase/migrations/002_checkout_stock_release.sql', 'utf8'))
  })
  afterAll(async () => {
    await pool?.end()
  })
  beforeEach(async () => {
    await pool.query('truncate public.inventory, public.inventory_ledger')
  })

  it('never oversells: 30 parallel reservations for 1 unit', async () => {
    await pool.query(`insert into public.inventory (sku, product_id, quantity) values ('S1', 'p', 1)`)
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        call('select public.reserve_inventory($1, 1, $2) as ok', ['S1', `k-${i}`])
      )
    )
    expect(results.filter((r) => r === true)).toHaveLength(1)
    expect(await stock('S1')).toEqual({ quantity: 1, reserved_quantity: 1 })
  })

  it('reserves at most the available quantity: 50 parallel requests for 5 units', async () => {
    await pool.query(`insert into public.inventory (sku, product_id, quantity) values ('S5', 'p', 5)`)
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        call('select public.reserve_inventory($1, 1, $2) as ok', ['S5', `k-${i}`])
      )
    )
    expect(results.filter((r) => r === true)).toHaveLength(5)
    expect(await stock('S5')).toEqual({ quantity: 5, reserved_quantity: 5 })
  })

  it('applies one idempotency key once, even when called concurrently', async () => {
    await pool.query(`insert into public.inventory (sku, product_id, quantity) values ('S10', 'p', 10)`)
    await Promise.all(
      Array.from({ length: 20 }, () => call('select public.reserve_inventory($1, 1, $2) as ok', ['S10', 'same']))
    )
    expect((await stock('S10')).reserved_quantity).toBe(1)
  })

  it('commits a single remaining unit only once', async () => {
    await pool.query(
      `insert into public.inventory (sku, product_id, quantity, reserved_quantity) values ('C1', 'p', 1, 1)`
    )
    const results = await Promise.all(
      [1, 2].map((i) =>
        call('select public.commit_inventory($1, 1, gen_random_uuid(), $2) as ok', ['C1', `c-${i}`])
      )
    )
    expect(results.filter((r) => r === true)).toHaveLength(1)
    expect(await stock('C1')).toEqual({ quantity: 0, reserved_quantity: 0 })
  })
})
