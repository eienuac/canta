/**
 * Migration 010 on a real local PostgreSQL: partial refunds and refund history, the
 * return-request refund guard, and stock release when a payment_review order is cancelled.
 * Skipped unless TEST_DATABASE_URL is a local database.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { applyMigrations, createTestPool, resetSupabaseSchema, testDatabaseUrl } from '../helpers/pg'
import { createSqlOrders, type Seeded, type SqlOrders } from '../helpers/sql-orders'

const enabled = Boolean(testDatabaseUrl())

describe.skipIf(!enabled)('migration 010 — refunds and returns', () => {
  let pool: Pool
  let one: SqlOrders['one']
  let order: SqlOrders['order']
  let inv: SqlOrders['inv']
  let seed: SqlOrders['seed']
  let finalize: SqlOrders['finalize']

  const paymentOf = (o: Seeded) =>
    one<{ id: string }>(`select id from public.payments where order_id = $1 order by created_at limit 1`, [o.orderId])
  const refund = (paymentId: string, reference: string, amount?: number) =>
    amount === undefined
      ? one<{ r: Record<string, unknown> }>(`select public.record_manual_refund($1, null, $2) as r`, [paymentId, reference])
      : one<{ r: Record<string, unknown> }>(`select public.record_manual_refund($1, null, $2, $3) as r`, [
          paymentId,
          reference,
          amount,
        ])
  const payment = (id: string) =>
    one<{ refunded_amount: number; refund_state: string }>(
      `select refunded_amount::float, refund_state from public.payments where id = $1`,
      [id]
    )

  beforeAll(async () => {
    pool = createTestPool()
    ;({ one, order, inv, seed, finalize } = createSqlOrders(pool))
    await resetSupabaseSchema(pool)
    await applyMigrations(pool)
  })

  afterAll(async () => {
    await pool?.end()
  })

  describe('partial refunds', () => {
    it('two partial refunds add up to a full refund, each one recorded', async () => {
      const s = await seed()
      await finalize(s)
      const pay = await paymentOf(s)

      expect((await refund(pay.id, 'IYZ-A', 400)).r).toMatchObject({ amount: 400, order_fully_refunded: false })
      expect(await payment(pay.id)).toEqual({ refunded_amount: 400, refund_state: 'partial' })
      expect((await order(s.orderId)).payment_status).toBe('partially_refunded')

      expect((await refund(pay.id, 'IYZ-B', 600)).r).toMatchObject({ amount: 600, order_fully_refunded: true })
      expect(await payment(pay.id)).toEqual({ refunded_amount: 1000, refund_state: 'succeeded' })
      expect((await order(s.orderId)).payment_status).toBe('refunded')
      expect(
        await one(`select count(*)::int c, sum(amount)::float total from public.payment_refunds where payment_id = $1`, [pay.id])
      ).toEqual({ c: 2, total: 1000 })
    })

    it('rejects more than the refundable amount, a reused reference and a missing reference', async () => {
      const s = await seed()
      await finalize(s)
      const pay = await paymentOf(s)
      await refund(pay.id, 'IYZ-1', 300)

      await expect(refund(pay.id, 'IYZ-2', 701)).rejects.toThrow(/exceeds the refundable amount/)
      await expect(refund(pay.id, 'IYZ-1', 10)).rejects.toThrow(/already recorded/)
      await expect(refund(pay.id, '  ', 10)).rejects.toThrow(/reference is required/)
      expect(await payment(pay.id)).toEqual({ refunded_amount: 300, refund_state: 'partial' })
    })

    it('a call without an amount (previous application version) refunds the remaining amount', async () => {
      const s = await seed()
      await finalize(s)
      const pay = await paymentOf(s)
      await refund(pay.id, 'IYZ-P', 250)

      await one(
        `select public.record_manual_refund(p_payment_id => $1, p_admin_id => null, p_reference => 'IYZ-REST') as r`,
        [pay.id]
      )

      expect(await payment(pay.id)).toEqual({ refunded_amount: 1000, refund_state: 'succeeded' })
      expect((await order(s.orderId)).payment_status).toBe('refunded')
    })

    it('parallel partial refunds can never exceed the paid amount', async () => {
      const s = await seed()
      await finalize(s)
      const pay = await paymentOf(s)

      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) => refund(pay.id, `PAR-${i}`, 300).then(() => 'ok', () => 'rejected'))
      )

      expect(results.filter((r) => r === 'ok')).toHaveLength(3) // 3 × 300 ≤ 1000 < 4 × 300
      expect((await payment(pay.id)).refunded_amount).toBe(900)
    })

    it('refunding a duplicate charge leaves the order paid and clears the review flag', async () => {
      const s = await seed()
      await pool.query(
        `insert into public.payments (order_id, provider, provider_payment_id, amount, status) values ($1, 'iyzico', $2, 1000, 'pending')`,
        [s.orderId, `${s.token}-second`]
      )
      await finalize(s)
      expect((await finalize(s, { token: `${s.token}-second` })).result).toBe('duplicate_payment')
      const second = await one<{ id: string }>(`select id from public.payments where provider_payment_id = $1`, [`${s.token}-second`])

      await refund(second.id, 'IYZ-DUP')

      expect(await payment(second.id)).toEqual({ refunded_amount: 1000, refund_state: 'succeeded' })
      expect(await order(s.orderId)).toMatchObject({ payment_status: 'paid', needs_review: false })
    })
  })

  describe('return requests', () => {
    async function deliveredOrderWithReturn() {
      const userId = randomUUID()
      await pool.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [
        userId,
        `${userId}@test.local`,
      ])
      const s = await seed()
      await pool.query(`update public.orders set user_id = $2 where id = $1`, [s.orderId, userId])
      await finalize(s)
      await pool.query(`update public.orders set status = 'shipped' where id = $1`, [s.orderId])
      await pool.query(`update public.orders set status = 'delivered' where id = $1`, [s.orderId])
      const ret = await one<{ id: string }>(
        `insert into public.return_requests (order_id, user_id, reason) values ($1, $2, 'Beğenmedim') returning id`,
        [s.orderId, userId]
      )
      return { s, returnId: ret.id }
    }
    const setReturn = (id: string, status: string) =>
      pool.query(`update public.return_requests set status = $2::public.return_status where id = $1`, [id, status])

    it('cannot be marked refunded before the payment refund is recorded', async () => {
      const { returnId } = await deliveredOrderWithReturn()
      await setReturn(returnId, 'approved')

      await expect(setReturn(returnId, 'refunded')).rejects.toThrow(/before the payment refund is recorded/)
    })

    it('can be marked refunded after a (partial) refund is recorded', async () => {
      const { s, returnId } = await deliveredOrderWithReturn()
      const pay = await paymentOf(s)
      await refund(pay.id, 'IYZ-RET', 500)

      await setReturn(returnId, 'refunded')
      expect(await one(`select status::text from public.return_requests where id = $1`, [returnId])).toEqual({ status: 'refunded' })
    })

    it('a returned order needs the refund first (guard), then can be closed', async () => {
      const { s } = await deliveredOrderWithReturn()
      await expect(pool.query(`update public.orders set status = 'returned' where id = $1`, [s.orderId])).rejects.toThrow(
        /refunded first/
      )
      await refund((await paymentOf(s)).id, 'IYZ-FULL')
      await pool.query(`update public.orders set status = 'returned' where id = $1`, [s.orderId])
      expect((await order(s.orderId)).status).toBe('returned')
    })
  })

  describe('cancelling a payment_review order', () => {
    it('releases the reservation it held (once) after the refund', async () => {
      const s = await seed()
      expect((await finalize(s, { price: 900 })).result).toBe('review')
      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 1 })
      await refund((await paymentOf(s)).id, 'IYZ-REVIEW')

      await pool.query(`update public.orders set status = 'cancelled' where id = $1`, [s.orderId])
      await pool.query(`update public.orders set notes = 'touched' where id = $1`, [s.orderId]) // no second release

      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 0 })
      expect(
        await one(`select count(*)::int c from public.inventory_ledger where idempotency_key = $1`, [`cancel:${s.orderId}:release:${s.sku}`])
      ).toEqual({ c: 1 })
    })

    it('cannot be cancelled before the refund is recorded (guard)', async () => {
      const s = await seed()
      await finalize(s, { price: 900 })
      await expect(pool.query(`update public.orders set status = 'cancelled' where id = $1`, [s.orderId])).rejects.toThrow(
        /after a refund/
      )
      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 1 })
    })
  })

  describe('privileges', () => {
    it('new functions are server-only', async () => {
      const r = await one<Record<string, boolean>>(
        `select has_function_privilege('authenticated', 'public.record_manual_refund(uuid, uuid, text, numeric)', 'execute') auth_refund,
                has_function_privilege('service_role', 'public.record_manual_refund(uuid, uuid, text, numeric)', 'execute') service_refund,
                has_function_privilege('authenticated', 'public.release_review_order_stock()', 'execute') auth_release,
                has_table_privilege('authenticated', 'public.payment_refunds', 'select') auth_read_refunds,
                has_table_privilege('anon', 'public.payment_refunds', 'select') anon_read_refunds`
      )
      expect(r).toEqual({
        auth_refund: false,
        service_refund: true,
        auth_release: false,
        auth_read_refunds: false,
        anon_read_refunds: false,
      })
    })
  })
})
