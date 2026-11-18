/**
 * supabase/rollback/rollback_010.sql, rollback_009.sql and rollback_008.sql against the final
 * migrations, applied newest first, on a real local PostgreSQL. Skipped unless
 * TEST_DATABASE_URL is a local database.
 */
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { applyMigrations, createTestPool, resetSupabaseSchema, testDatabaseUrl } from '../helpers/pg'
import { createSqlOrders, type Seeded, type SqlOrders } from '../helpers/sql-orders'

const enabled = Boolean(testDatabaseUrl())
const rollback = (n: '008' | '009' | '010') => readFileSync(`supabase/rollback/rollback_${n}.sql`, 'utf8')
const migration = (file: string) => readFileSync(`supabase/migrations/${file}`, 'utf8')

const FN_008_009 = ['finalize_paid_order', 'approve_payment_review', 'record_manual_refund', 'commit_order_stock', 'orders_transition_guard']
const FN_010 = ['release_review_order_stock', 'return_request_refund_guard']

describe.skipIf(!enabled)('rollback scripts for 008 / 009 / 010', () => {
  let pool: Pool
  let one: SqlOrders['one']
  let seed: SqlOrders['seed']
  let finalize: SqlOrders['finalize']
  let paidOrder: Seeded
  let reviewOrder: Seeded

  const fnSignatures = async (names: string[]) =>
    (
      await pool.query(
        `select p.oid::regprocedure::text sig from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by 1`,
        [names]
      )
    ).rows.map((r) => r.sig as string)
  const triggers = async () =>
    (
      await pool.query(
        `select tgname from pg_trigger where tgname in
         ('orders_transition_guard', 'orders_release_review_stock', 'return_requests_refund_guard') order by 1`
      )
    ).rows.map((r) => r.tgname as string)

  beforeAll(async () => {
    pool = createTestPool()
    ;({ one, seed, finalize } = createSqlOrders(pool))
    await resetSupabaseSchema(pool)
    await applyMigrations(pool) // 001 … 010

    paidOrder = await seed()
    expect(await finalize(paidOrder)).toEqual({ result: 'paid' })
    const pay = await one<{ id: string }>(`select id from public.payments where order_id = $1`, [paidOrder.orderId])
    await pool.query(`select public.record_manual_refund($1, null, 'PARTIAL-1', 100)`, [pay.id]) // 010 partial refund
    reviewOrder = await seed()
    expect((await finalize(reviewOrder, { price: 900 })).result).toBe('review') // amount mismatch
  })

  afterAll(async () => {
    await pool?.end()
  })

  it('rollback_010 restores the 008 refund function and removes the 010 triggers, keeping refund data', async () => {
    await pool.query(rollback('010'))
    await pool.query(rollback('010')) // re-runnable

    expect(await fnSignatures(['record_manual_refund'])).toEqual(['record_manual_refund(uuid,uuid,text)'])
    expect(await fnSignatures(FN_010)).toEqual([])
    expect(await triggers()).toEqual(['orders_transition_guard'])
    expect(await one(`select count(*)::int c from public.payment_refunds`)).toEqual({ c: 1 })
    expect(await one(`select payment_status::text from public.orders where id = $1`, [paidOrder.orderId])).toEqual({
      payment_status: 'partially_refunded',
    })
  })

  it('rollback_009 removes only the guard (and is re-runnable)', async () => {
    await pool.query(rollback('009'))
    await pool.query(rollback('009'))
    expect(await triggers()).toEqual([])
    expect(await fnSignatures(FN_008_009)).toHaveLength(4) // the 008 functions stay
  })

  it('rollback_008 refuses while an order is still in payment_review, changing nothing', async () => {
    await expect(pool.query(rollback('008'))).rejects.toThrow(/resolve payment_review orders first/)
    expect(await fnSignatures(FN_008_009)).toHaveLength(4)
  })

  it('rollback_008 runs once review orders are resolved, keeping all data', async () => {
    await pool.query(`select public.approve_payment_review($1, null, 'before rollback')`, [reviewOrder.orderId])
    await pool.query(rollback('008'))
    await pool.query(rollback('008'))

    expect(await fnSignatures(FN_008_009)).toEqual([])
    expect(
      await one(`select status::text, (stock_committed_at is not null) committed from public.orders where id = $1`, [
        paidOrder.orderId,
      ])
    ).toEqual({ status: 'payment_received', committed: true })
    expect(await one(`select refunded_amount::float, refund_state from public.payments where order_id = $1`, [paidOrder.orderId])).toEqual({
      refunded_amount: 100,
      refund_state: 'partial',
    })
  })

  it('after rollback the previous application version works (claim before stock commit)', async () => {
    const s = await seed()
    const r = await pool.query(
      `update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1 and payment_status = 'pending'`,
      [s.orderId]
    )
    expect(r.rowCount).toBe(1)
  })

  it('after rollback is_admin() is the previous definition (role only)', async () => {
    const def = await one<{ d: string }>(`select pg_get_functiondef('public.is_admin()'::regprocedure) d`)
    expect(def.d).not.toMatch(/email_confirmed_at/)
  })

  it('008, 009 and 010 can be re-applied after a rollback', async () => {
    for (const f of ['008_payment_integrity.sql', '009_order_transition_guard.sql', '010_refunds_and_returns.sql']) {
      await pool.query(migration(f))
    }
    expect(await fnSignatures(['record_manual_refund'])).toEqual(['record_manual_refund(uuid,uuid,text,numeric)'])
    expect(await fnSignatures([...FN_008_009, ...FN_010])).toHaveLength(7)
    expect(await triggers()).toEqual(['orders_release_review_stock', 'orders_transition_guard', 'return_requests_refund_guard'])
    const def = await one<{ d: string }>(`select pg_get_functiondef('public.is_admin()'::regprocedure) d`)
    expect(def.d).toMatch(/email_confirmed_at/)
    const s = await seed()
    await expect(
      pool.query(`update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1`, [s.orderId])
    ).rejects.toThrow(/paid with stock committed/)
  })
})
