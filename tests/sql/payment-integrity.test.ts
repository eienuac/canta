/**
 * Migration 008 on a real (local) PostgreSQL: the actual migration files 001–008 are applied
 * on top of tests/sql/supabase-stub.sql. Skipped unless TEST_DATABASE_URL is a local database.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { createTestPool, testDatabaseUrl } from '../helpers/pg'

const enabled = Boolean(testDatabaseUrl())
const MIGRATIONS = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort()
const sql = (file: string) => readFileSync(file, 'utf8')

type Seeded = { orderId: string; token: string; sku: string; productId: number; cartId: string }

describe.skipIf(!enabled)('migration 008 — payment integrity', () => {
  let pool: Pool
  let legacyPaidOrder: string
  let paidBetween008And009: string
  let oldAppAfter008: string
  let seq = 0

  const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows[0] as T
  const order = (id: string) =>
    one<{ status: string; payment_status: string; needs_review: boolean; review_reason: string | null; stock_committed_at: Date | null }>(
      'select status::text, payment_status::text, needs_review, review_reason, stock_committed_at from public.orders where id = $1',
      [id]
    )
  const inv = (sku: string) =>
    one<{ quantity: number; reserved_quantity: number }>(
      'select quantity, reserved_quantity from public.inventory where sku = $1',
      [sku]
    )
  const cmsStock = async (sku: string) =>
    Number(
      (
        await one<{ stock: string }>(
          `select coalesce((select stock from payload.products_variants where sku = $1),
                           (select stock from payload.products where sku = $1)) as stock`,
          [sku]
        )
      ).stock
    )
  const finalize = (s: Seeded, opts: { token?: string | null; price?: number; paid?: number; currency?: string } = {}) =>
    one<{ r: { result: string; reason?: string } }>(
      `select public.finalize_paid_order($1, $2, $3, $4, $5, $6, $7, $8) as r`,
      [
        s.orderId,
        opts.token === undefined ? s.token : opts.token,
        `pay-${seq++}`,
        opts.price ?? 1000,
        opts.paid ?? opts.price ?? 1000,
        opts.currency ?? 'TRY',
        1,
        JSON.stringify({ paymentStatus: 'SUCCESS' }),
      ]
    ).then((row) => row.r)

  /** A pending order exactly as createCheckoutSession leaves it (reserved stock, token). */
  async function seed(opts: { variant?: boolean; stock?: number; cmsStock?: number; total?: number; coupon?: string } = {}): Promise<Seeded> {
    const n = seq++
    const sku = `SKU-${n}`
    const key = `idem-${n}`
    const total = opts.total ?? 1000
    const cart = await one<{ id: string }>(`insert into public.carts (guest_token) values ($1) returning id`, [`guest-${n}`])
    await pool.query(`insert into public.cart_items (cart_id, product_id, sku, quantity) values ($1, 'p', $2, 1)`, [cart.id, sku])
    const product = await one<{ id: number }>(
      `insert into payload.products (sku, stock) values ($1, $2) returning id`,
      [opts.variant ? null : sku, opts.variant ? 0 : (opts.cmsStock ?? opts.stock ?? 5)]
    )
    if (opts.variant) {
      await pool.query(`insert into payload.products_variants (_parent_id, id, sku, stock) values ($1, $2, $3, $4)`, [
        product.id,
        `v-${n}`,
        sku,
        opts.cmsStock ?? opts.stock ?? 5,
      ])
    }
    await pool.query(`insert into public.inventory (sku, product_id, quantity, reserved_quantity) values ($1, $2, $3, 1)`, [
      sku,
      String(product.id),
      opts.stock ?? 5,
    ])
    await pool.query(`insert into public.inventory_ledger (sku, delta, reason, idempotency_key) values ($1, 1, 'reserve', $2)`, [
      sku,
      `${key}:reserve:${sku}`,
    ])
    const o = await one<{ id: string }>(
      `insert into public.orders (order_number, guest_email, subtotal, total, shipping_address, cart_id, idempotency_key, coupon_code)
       values ($1, 'g@test.local', $2, $2, '{}'::jsonb, $3, $4, $5) returning id`,
      [`SC-${n}`, total, cart.id, key, opts.coupon ?? null]
    )
    await pool.query(
      `insert into public.order_items (order_id, product_id, product_name_snapshot, product_sku_snapshot, unit_price_snapshot, quantity)
       values ($1, $2, 'Çanta', $3, $4, 1)`,
      [o.id, String(product.id), sku, total]
    )
    const token = `tok-${n}`
    await pool.query(
      `insert into public.payments (order_id, provider, provider_payment_id, amount, status, idempotency_key)
       values ($1, 'iyzico', $2, $3, 'pending', $4)`,
      [o.id, token, total, `${key}:payment`]
    )
    return { orderId: o.id, token, sku, productId: product.id, cartId: cart.id }
  }

  beforeAll(async () => {
    pool = createTestPool()
    await pool.query(`
      drop schema if exists public cascade; create schema public;
      drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists payload cascade;
      grant usage on schema public to anon, authenticated, service_role;
    `).catch(async () => {
      // roles may not exist yet on a fresh database
      await pool.query(`drop schema if exists public cascade; create schema public;
        drop schema if exists auth cascade; drop schema if exists storage cascade; drop schema if exists payload cascade;`)
    })
    await pool.query(sql('tests/sql/supabase-stub.sql'))
    for (const file of MIGRATIONS.filter((f) => f < '008')) await pool.query(sql(`supabase/migrations/${file}`))

    // A legacy paid order (committed before 008) to check the backfill.
    const legacy = await seed()
    await pool.query(`update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1`, [legacy.orderId])
    await pool.query(`insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key) values ($1, $2, -1, 'commit', $3)`, [
      legacy.sku,
      legacy.orderId,
      `order:${legacy.orderId}:commit:${legacy.sku}`,
    ])
    legacyPaidOrder = legacy.orderId

    await pool.query(sql('supabase/migrations/008_payment_integrity.sql'))

    // Between 008 and 009 the PREVIOUS application version is still live. Its finalize
    // sequence (claim the order, then commit stock) must keep working.
    const live = await seed()
    oldAppAfter008 = await pool
      .query(
        `update public.orders set status = 'payment_received', payment_status = 'paid'
         where id = $1 and payment_status = 'pending' returning id`,
        [live.orderId]
      )
      .then((r) => (r.rowCount === 1 ? 'ok' : 'no-row'), (e: Error) => e.message)
    await pool.query(`insert into public.inventory_ledger (sku, order_id, delta, reason, idempotency_key) values ($1, $2, -1, 'commit', $3)`, [
      live.sku,
      live.orderId,
      `order:${live.orderId}:commit:${live.sku}`,
    ])
    paidBetween008And009 = live.orderId

    for (const file of MIGRATIONS.filter((f) => f > '008')) await pool.query(sql(`supabase/migrations/${file}`))
  })

  afterAll(async () => {
    await pool?.end()
  })

  describe('backfill and deploy order (008 → application → 009)', () => {
    it('sets stock_committed_at on paid orders that were already committed', async () => {
      const o = await order(legacyPaidOrder)
      expect(o.stock_committed_at).not.toBeNull()
      expect(o.needs_review).toBe(false)
    })

    it('008 alone keeps the previous application version working', () => {
      expect(oldAppAfter008).toBe('ok')
    })

    it('009 backfills orders paid by the previous version in between', async () => {
      const o = await order(paidBetween008And009)
      expect(o).toMatchObject({ status: 'payment_received', payment_status: 'paid', needs_review: false })
      expect(o.stock_committed_at).not.toBeNull()
    })

    it('after 009 the previous version\'s claim-before-stock sequence is rejected', async () => {
      const s = await seed()
      await expect(
        pool.query(`update public.orders set status = 'payment_received', payment_status = 'paid' where id = $1`, [s.orderId])
      ).rejects.toThrow(/paid with stock committed/)
    })
  })

  describe('M2: finalize_paid_order is atomic', () => {
    it('records the payment, commits inventory + Payload variant stock and clears the cart', async () => {
      const s = await seed({ variant: true, stock: 5 })

      expect(await finalize(s)).toEqual({ result: 'paid' })

      expect(await order(s.orderId)).toMatchObject({ status: 'payment_received', payment_status: 'paid', needs_review: false })
      expect((await order(s.orderId)).stock_committed_at).not.toBeNull()
      expect(await inv(s.sku)).toEqual({ quantity: 4, reserved_quantity: 0 })
      expect(await cmsStock(s.sku)).toBe(4)
      expect(await one(`select count(*)::int c from public.cart_items where cart_id = $1`, [s.cartId])).toEqual({ c: 0 })
      expect(await one(`select status::text, paid_price::float, provider_reference from public.payments where order_id = $1`, [s.orderId])).toMatchObject({
        status: 'paid',
        paid_price: 1000,
      })
    })

    it('decrements a product without variants', async () => {
      const s = await seed({ variant: false, stock: 3 })
      expect(await finalize(s)).toEqual({ result: 'paid' })
      expect(await cmsStock(s.sku)).toBe(2)
    })

    it('a replayed result is a no-op', async () => {
      const s = await seed({ variant: true })
      await finalize(s)
      expect((await finalize(s)).result).toBe('duplicate')
      expect(await inv(s.sku)).toEqual({ quantity: 4, reserved_quantity: 0 })
      expect(await cmsStock(s.sku)).toBe(4)
    })

    it('concurrent finalizations commit stock exactly once', async () => {
      const s = await seed({ variant: true })
      const results = await Promise.all(Array.from({ length: 6 }, () => finalize(s)))
      expect(results.filter((r) => r.result === 'paid')).toHaveLength(1)
      expect(await inv(s.sku)).toEqual({ quantity: 4, reserved_quantity: 0 })
      expect(await cmsStock(s.sku)).toBe(4)
    })

    it('a CMS stock shortage rolls back ALL stock changes but keeps the payment', async () => {
      const s = await seed({ variant: true, stock: 5, cmsStock: 0 })

      expect(await finalize(s)).toMatchObject({ result: 'review', reason: 'STOCK' })

      expect(await order(s.orderId)).toMatchObject({ status: 'payment_review', payment_status: 'paid', needs_review: true })
      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 1 }) // untouched
      expect(await cmsStock(s.sku)).toBe(0)
      expect(await one(`select status::text from public.payments where order_id = $1`, [s.orderId])).toEqual({ status: 'paid' })
    })

    it('an unknown token is rejected', async () => {
      const s = await seed()
      await expect(finalize(s, { token: 'not-ours' })).rejects.toThrow(/token mismatch/)
      expect((await order(s.orderId)).payment_status).toBe('pending')
    })
  })

  describe('H1: price vs paid price', () => {
    it('installment interest (paid > price) completes normally and stores both amounts', async () => {
      const s = await seed({ variant: true })
      expect(await finalize(s, { price: 1000, paid: 1045.5 })).toEqual({ result: 'paid' })
      expect(await one(`select price::float, paid_price::float from public.payments where order_id = $1`, [s.orderId])).toEqual({
        price: 1000,
        paid_price: 1045.5,
      })
    })

    it.each([
      ['AMOUNT_MISMATCH', { price: 900 }],
      ['PAID_LESS_THAN_PRICE', { price: 1000, paid: 990 }],
      ['CURRENCY_MISMATCH', { currency: 'USD' }],
    ])('%s → payment kept, order in review, stock untouched', async (reason, opts) => {
      const s = await seed({ variant: true })
      expect(await finalize(s, opts)).toEqual({ result: 'review', reason })
      expect(await order(s.orderId)).toMatchObject({ status: 'payment_review', payment_status: 'paid', review_reason: reason })
      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 1 })
    })

    it('review orders are never picked up by the pending-order cleanup', async () => {
      const s = await seed({ variant: true })
      await finalize(s, { price: 900 })
      const pending = await one<{ c: number }>(
        `select count(*)::int c from public.orders where id = $1 and payment_status = 'pending'`,
        [s.orderId]
      )
      expect(pending.c).toBe(0)
    })
  })

  describe('L5: duplicate and late payments', () => {
    it('a second successful attempt for a paid order is flagged for refund', async () => {
      const s = await seed({ variant: true })
      await pool.query(
        `insert into public.payments (order_id, provider, provider_payment_id, amount, status) values ($1, 'iyzico', 'tok-second', 1000, 'pending')`,
        [s.orderId]
      )
      await finalize(s)

      expect(await finalize(s, { token: 'tok-second' })).toEqual({ result: 'duplicate_payment' })

      expect(await one(`select status::text, refund_state from public.payments where provider_payment_id = 'tok-second'`)).toEqual({
        status: 'paid',
        refund_state: 'required',
      })
      expect(await order(s.orderId)).toMatchObject({ status: 'payment_received', needs_review: true })
      expect(await inv(s.sku)).toEqual({ quantity: 4, reserved_quantity: 0 }) // stock committed once
    })

    it('a late payment for a cancelled order goes to review, not completion', async () => {
      const s = await seed({ variant: true })
      await pool.query(`update public.orders set status = 'cancelled', payment_status = 'failed' where id = $1`, [s.orderId])

      expect(await finalize(s)).toEqual({ result: 'review', reason: 'LATE_PAYMENT' })
      expect(await order(s.orderId)).toMatchObject({ status: 'payment_review', payment_status: 'paid' })
    })

    it('a second paid order for the same cart and amount is flagged', async () => {
      const a = await seed({ variant: true })
      await finalize(a)
      const b = await seed({ variant: true })
      await pool.query(`update public.orders set cart_id = $1 where id = $2`, [a.cartId, b.orderId])

      expect(await finalize(b)).toEqual({ result: 'review', reason: 'POSSIBLE_DUPLICATE_ORDER' })
    })
  })

  describe('approve_payment_review', () => {
    it('re-reserves released stock and completes the order', async () => {
      const s = await seed({ variant: true })
      // checkout reservation was released when the order expired
      await pool.query(`update public.inventory set reserved_quantity = 0 where sku = $1`, [s.sku])
      await pool.query(`insert into public.inventory_ledger (sku, delta, reason, idempotency_key) values ($1, -1, 'release', $2)`, [
        s.sku,
        `cancel:${s.orderId}:release:${s.sku}`,
      ])
      await pool.query(`update public.orders set status = 'cancelled', payment_status = 'failed' where id = $1`, [s.orderId])
      await finalize(s)

      expect(await one(`select public.approve_payment_review($1, null, 'ok') as r`, [s.orderId])).toEqual({ r: { result: 'approved' } })
      expect(await order(s.orderId)).toMatchObject({ status: 'payment_received', needs_review: false })
      expect(await inv(s.sku)).toEqual({ quantity: 4, reserved_quantity: 0 })
      expect(await cmsStock(s.sku)).toBe(4)
    })

    it('fails cleanly when stock is no longer available', async () => {
      const s = await seed({ variant: true, stock: 5, cmsStock: 0 })
      await finalize(s) // → review (STOCK)

      await expect(one(`select public.approve_payment_review($1, null, null)`, [s.orderId])).rejects.toThrow(/CMS/)
      expect(await order(s.orderId)).toMatchObject({ status: 'payment_review' })
      expect(await inv(s.sku)).toEqual({ quantity: 5, reserved_quantity: 1 })
    })
  })

  describe('order transition guard', () => {
    const setStatus = (id: string, status: string) =>
      pool.query(`update public.orders set status = $2::public.order_status where id = $1`, [id, status])
    const setPayment = (id: string, ps: string) =>
      pool.query(`update public.orders set payment_status = $2::public.payment_status where id = $1`, [id, ps])

    it('allows the normal fulfilment path', async () => {
      const s = await seed({ variant: true })
      await finalize(s)
      for (const st of ['preparing', 'shipped', 'delivered']) await setStatus(s.orderId, st)
      expect((await order(s.orderId)).status).toBe('delivered')
    })

    it('rejects skipping payment, going backwards, un-paying and cancelling a paid order', async () => {
      const pending = await seed()
      await expect(setStatus(pending.orderId, 'shipped')).rejects.toThrow(/transition|stock committed/)
      await expect(setStatus(pending.orderId, 'payment_received')).rejects.toThrow(/paid with stock committed/)

      const paid = await seed({ variant: true })
      await finalize(paid)
      await setStatus(paid.orderId, 'shipped')
      await expect(setStatus(paid.orderId, 'payment_received')).rejects.toThrow(/transition/)
      await expect(setPayment(paid.orderId, 'failed')).rejects.toThrow(/payment_status transition/)
      await expect(setPayment(paid.orderId, 'refunded')).rejects.toThrow(/completed refund/)
      await expect(setStatus(paid.orderId, 'cancelled')).rejects.toThrow(/transition|refund/)
    })

    it('a recorded manual refund allows refund/cancel of a paid order', async () => {
      const s = await seed({ variant: true })
      await finalize(s)
      const pay = await one<{ id: string }>(`select id from public.payments where order_id = $1`, [s.orderId])

      await expect(one(`select public.record_manual_refund($1, null, '  ')`, [pay.id])).rejects.toThrow(/reference/)
      await one(`select public.record_manual_refund($1, null, 'IYZ-REF-1')`, [pay.id])

      expect((await order(s.orderId)).payment_status).toBe('refunded')
      await expect(setStatus(s.orderId, 'shipped')).rejects.toThrow(/paid with stock committed/)
      await setStatus(s.orderId, 'cancelled')
      expect((await order(s.orderId)).status).toBe('cancelled')
    })
  })

  describe('L4: is_admin requires a verified, non-banned account', () => {
    async function isAdminAs(user: { confirmed: boolean; banned?: boolean; role: 'admin' | 'customer' }) {
      const id = randomUUID()
      await pool.query(
        `insert into auth.users (id, email, email_confirmed_at, banned_until) values ($1, $2, $3, $4)`,
        [id, `${id}@test.local`, user.confirmed ? new Date() : null, user.banned ? new Date(Date.now() + 86_400_000) : null]
      )
      await pool.query(`update public.profiles set role = $2 where id = $1`, [id, user.role])
      const client = await pool.connect()
      try {
        await client.query('begin')
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id])
        return (await client.query('select public.is_admin() as a')).rows[0].a as boolean
      } finally {
        await client.query('rollback')
        client.release()
      }
    }

    it.each([
      [{ confirmed: true, role: 'admin' as const }, true],
      [{ confirmed: false, role: 'admin' as const }, false],
      [{ confirmed: true, banned: true, role: 'admin' as const }, false],
      [{ confirmed: true, role: 'customer' as const }, false],
    ])('%o → %s', async (user, expected) => {
      expect(await isAdminAs(user)).toBe(expected)
    })
  })

  describe('privileges', () => {
    it('payment functions are executable by the service role only', async () => {
      const fn = 'public.finalize_paid_order(uuid, text, text, numeric, numeric, text, integer, jsonb)'
      const r = await one<Record<string, boolean>>(
        `select has_function_privilege('anon', $1, 'execute') anon,
                has_function_privilege('authenticated', $1, 'execute') auth,
                has_function_privilege('service_role', $1, 'execute') service,
                has_function_privilege('service_role', 'public.commit_order_stock(uuid)', 'execute') service_commit`,
        [fn]
      )
      expect(r).toEqual({ anon: false, auth: false, service: true, service_commit: false })
    })
  })
})
