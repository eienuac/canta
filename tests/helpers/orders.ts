import { randomUUID } from 'node:crypto'
import type { FakeDb } from './fake-supabase'

export type SeededOrder = { id: string; sku: string; orderNumber: string; total: number; token: string }

/** A pending order with one reserved line item and the checkout token we issued for it. */
export function seedPendingOrder(
  db: FakeDb,
  opts: { token: string; total?: number; sku?: string; stock?: number }
): SeededOrder {
  const id = randomUUID()
  const sku = opts.sku ?? `SKU-${id.slice(0, 4)}`
  const total = opts.total ?? 1000
  const orderNumber = `SC${id.slice(0, 6)}`
  if (!db.tables.inventory.some((r) => r.sku === sku)) {
    db.tables.inventory.push({ sku, quantity: opts.stock ?? 5, reserved_quantity: 1 })
  }
  db.tables.orders.push({
    id,
    order_number: orderNumber,
    status: 'pending_payment',
    payment_status: 'pending',
    total,
    currency: 'TRY',
    notes: null,
    cart_id: null,
    coupon_code: null,
    user_id: null,
    guest_email: 'g@test.local',
    created_at: new Date().toISOString(),
  })
  db.tables.order_items.push({ id: randomUUID(), order_id: id, product_sku_snapshot: sku, quantity: 1 })
  db.tables.payments.push({
    id: randomUUID(),
    order_id: id,
    provider_payment_id: opts.token,
    status: 'pending',
    amount: total,
    created_at: new Date().toISOString(),
  })
  return { id, sku, orderNumber, total, token: opts.token }
}

export const orderRow = (db: FakeDb, id: string) => db.tables.orders.find((o) => o.id === id)!
export const stockRow = (db: FakeDb, sku: string) => db.tables.inventory.find((r) => r.sku === sku)!
export const commitCount = (db: FakeDb) =>
  db.tables.inventory_ledger.filter((l) => l.reason === 'commit').length
