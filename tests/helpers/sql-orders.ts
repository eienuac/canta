/**
 * Order fixtures and accessors for SQL tests that run the real migrations on a local
 * PostgreSQL (see tests/helpers/pg.ts). Mirrors what createCheckoutSession leaves behind.
 */
import type { Pool } from 'pg'

export type Seeded = { orderId: string; token: string; sku: string; productId: number; cartId: string }

export function createSqlOrders(pool: Pool) {
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

  return { one, order, inv, cmsStock, finalize, seed }
}

export type SqlOrders = ReturnType<typeof createSqlOrders>
