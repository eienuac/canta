/**
 * supabase/rollback/rollback_009.sql and rollback_008.sql against the final migrations,
 * on a real local PostgreSQL. Skipped unless TEST_DATABASE_URL is a local database.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { applyMigrations, createTestPool, resetSupabaseSchema, testDatabaseUrl } from '../helpers/pg'

const enabled = Boolean(testDatabaseUrl())
const rollback = (n: '008' | '009') => readFileSync(`supabase/rollback/rollback_${n}.sql`, 'utf8')
const migration = (file: string) => readFileSync(`supabase/migrations/${file}`, 'utf8')

describe.skipIf(!enabled)('rollback scripts for 008 / 009', () => {
  let pool: Pool
  let seq = 0

  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows[0] as T
  const fnCount = async () =>
    (
      await one<{ c: number }>(
        `select count(*)::int c from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('finalize_paid_order','approve_payment_review','record_manual_refund','commit_order_stock','orders_transition_guard')`
      )
    ).c
  const triggerCount = async () =>
    (await one<{ c: number }>(`select count(*)::int c from pg_trigger where tgname = 'orders_transition_guard'`)).c

  /** A pending order with a reserved line and the checkout token we issued. */
  async function seedOrder(opts: { total?: number } = {}) {
    const n = seq++
    const sku = `RB-${n}`
    const total = opts.total ?? 100
    const product = await one<{ id: number }>(`insert into payload.products (sku, stock) values ($1, 5) returning id`, [sku])
    await pool.query(`insert into public.inventory (sku, product_id, quantity, reserved_quantity) values ($1, $2, 5, 1)`, [
      sku,
      String(product.id),
    ])
    await pool.query(`insert into public.inventory_ledger (sku, delta, reason, idempotency_key) values ($1, 1, 'reserve', $2)`, [
      sku,
      `rk-${n}:reserve:${sku}`,
    ])
    const o = await one<{ id: string }>(
      `insert into public.orders (order_number, guest_email, subtotal, total, shipping_address, idempotency_key)
       values ($1, 'g@test.local', $2, $2, '{}', $3) returning id`,
      [`RB-${n}`, total, `rk-${n}`]
    )
    await pool.query(
      `insert into public.order_items (order_id, product_id, product_name_snapshot, product_sku_snapshot, unit_price_snapshot, quantity)
       values ($1, $2, 'x', $3, $4, 1)`,
      [o.id, String(product.id), sku, total]
    )
    await pool.query(
      `insert into public.payments (order_id, provider, provider_payment_id, amount, status) values ($1, 'iyzico', $2, $3, 'pending')`,
      [o.id, `tok-${n}`, total]
    )
    return { id: o.id, token: `tok-${n}`, sku, total }
  }
  const finalize = (o: { id: string; token: string }, price: number) =>
    one<{ r: { result: string } }>(`select public.finalize_paid_order($1, $2, 'pay', $3, $3, 'TRY', 1, '{}') as r`, [
      o.id,
      o.token,
      price,
    ]).then((x) => x.r)

  let paidOrder: { id: string }
  let reviewOrder: { id: string }

  beforeAll(async () => {
    pool = createTestPool()
    await resetSupabaseSchema(pool)
    await applyMigrations(pool) // 001 … 009

    const paid = await seedOrder()
    expect(await finalize(paid, 100)).toEqual({ result: 'paid' })
    paidOrder = paid
    const review = await seedOrder()
    expect((await finalize(review, 90)).result).toBe('review') // amount mismatch → payment_review
    reviewOrder = review
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('rollback_009 removes only the guard (and is re-runnable)', async () => {
    expect(await triggerCount()).toBe(1)
    await pool.query(rollback('009'))
    await pool.query(rollback('009'))
    expect(await triggerCount()).toBe(0)
    expect(await fnCount()).toBe(4) // the 008 functions stay
  })

  it('rollback_008 refuses while an order is still in payment_review, changing nothing', async () => {
    await expect(pool.query(rollback('008'))).rejects.toThrow(/resolve payment_review orders first/)
    expect(await fnCount()).toBe(4)
  })

  it('rollback_008 runs once review orders are resolved, keeping all data', async () => {
    await pool.query(`select public.approve_payment_review($1, null, 'before rollback')`, [reviewOrder.id])
    await pool.query(rollback('008'))
    await pool.query(rollback('008')) // re-runnable

    expect(await fnCount()).toBe(0)
    // data written by the new version is kept (non-destructive rollback)
    expect(
      await one(`select status::text, payment_status::text, (stock_committed_at is not null) committed from public.orders where id = $1`, [
        paidOrder.id,
      ])
    ).toEqual({ status: 'payment_received', payment_status: 'paid', committed: true })
    expect(await one(`select paid_price::float, refund_state from public.payments where order_id = $1`, [paidOrder.id])).toEqual({
      paid_price: 100,
      refund_state: 'none',
    })
  })

  it('after rollback the previous application version works (claim before stock commit)', async () => {
    const o = await seedOrder()
    const r = await pool.query(
      `update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1 and payment_status = 'pending'`,
      [o.id]
    )
    expect(r.rowCount).toBe(1)
  })

  it('after rollback is_admin() is the previous definition (role only)', async () => {
    const def = await one<{ d: string }>(`select pg_get_functiondef('public.is_admin()'::regprocedure) d`)
    expect(def.d).not.toMatch(/email_confirmed_at/)
  })

  it('008 and 009 can be re-applied after a rollback', async () => {
    await pool.query(migration('008_payment_integrity.sql'))
    await pool.query(migration('009_order_transition_guard.sql'))
    expect(await fnCount()).toBe(5)
    expect(await triggerCount()).toBe(1)
    const def = await one<{ d: string }>(`select pg_get_functiondef('public.is_admin()'::regprocedure) d`)
    expect(def.d).toMatch(/email_confirmed_at/)
    // the guard is active again
    const o = await seedOrder()
    await expect(
      pool.query(`update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1`, [o.id])
    ).rejects.toThrow(/paid with stock committed/)
  })
})
