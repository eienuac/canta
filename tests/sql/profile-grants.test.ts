/**
 * On a real local PostgreSQL with all migrations: a customer can edit their own name/phone
 * (column grant from 003) but not their role, nor another customer's profile; the 011
 * foreign-key indexes exist and rollback_011 removes them.
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { applyMigrations, createTestPool, resetSupabaseSchema, testDatabaseUrl } from '../helpers/pg'

const enabled = Boolean(testDatabaseUrl())

describe.skipIf(!enabled)('customer profile updates and 011 FK indexes', () => {
  let pool: Pool
  const me = randomUUID()
  const other = randomUUID()

  beforeAll(async () => {
    pool = createTestPool()
    await resetSupabaseSchema(pool)
    await applyMigrations(pool)
    // Supabase grants schema usage to its API roles by default; the local stub does not.
    await pool.query('grant usage on schema public, auth to authenticated')
    for (const id of [me, other]) {
      await pool.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id}@test.local`])
      await pool.query(
        `insert into public.profiles (id, email, first_name) values ($1, $2, 'Eski') on conflict (id) do nothing`,
        [id, `${id}@test.local`]
      )
    }
  })
  afterAll(async () => pool?.end())

  /** Runs `sql` as the `authenticated` role with auth.uid() = `uid`, then rolls back. */
  async function asCustomer<T>(uid: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
      await c.query('set local role authenticated')
      return await fn(c)
    } finally {
      await c.query('rollback').catch(() => {})
      c.release()
    }
  }

  it('a customer can update their own name and phone', async () => {
    const n = await asCustomer(me, async (c) =>
      (await c.query(`update public.profiles set first_name = 'Ayşe', phone = '05551112233' where id = $1`, [me])).rowCount
    )
    expect(n).toBe(1)
  })

  it("a customer cannot change their role", async () => {
    await expect(
      asCustomer(me, (c) => c.query(`update public.profiles set role = 'admin' where id = $1`, [me]))
    ).rejects.toThrow(/permission denied/)
  })

  it("a customer cannot update someone else's profile", async () => {
    const n = await asCustomer(me, async (c) =>
      (await c.query(`update public.profiles set first_name = 'X' where id = $1`, [other])).rowCount
    )
    expect(n).toBe(0)
  })

  it('foreign-key indexes exist, and rollback_011 removes them', async () => {
    const idx = async () =>
      (await pool.query(`select count(*)::int n from pg_indexes where schemaname = 'public' and indexname like '%\\_idx' and indexname in (
        'orders_user_id_idx','order_items_order_id_idx','payments_order_id_idx','carts_user_id_idx','return_requests_order_id_idx')`)).rows[0].n
    expect(await idx()).toBe(5)
    await pool.query(readFileSync('supabase/rollback/rollback_011.sql', 'utf8'))
    expect(await idx()).toBe(0)
    await pool.query(readFileSync('supabase/migrations/011_fk_indexes.sql', 'utf8'))
    expect(await idx()).toBe(5)
  })
})
