import { randomInt } from 'node:crypto'
import type { Product } from '@/payload-types'

type SyncableVariant = {
  id?: string | null
  sku?: string | null
  color?: string | null
  size?: string | null
  stock?: number | null
}

type SyncableProduct = {
  id: string | number
  sku?: string | null
  stock?: number | null
  _status?: string | null
  isActive?: boolean | null
  variants?: SyncableVariant[] | null
}

function normalizeStock(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/**
 * Syncs inventory identity + quantity from Payload CMS stock fields to Supabase.
 * Does NOT copy price, description, or marketing fields.
 * Preserves reserved_quantity on update.
 */
export async function syncProductInventory(doc: SyncableProduct | Product): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return
  }

  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const supabase = getSupabaseAdmin()
  const productId = String(doc.id)

  const rows: Array<{
    sku: string
    product_id: string
    variant_id: string | null
    quantity: number
  }> = []

  if (doc.variants && doc.variants.length > 0) {
    for (const variant of doc.variants) {
      if (!variant?.sku) continue
      rows.push({
        sku: variant.sku,
        product_id: productId,
        variant_id: variant.id ? String(variant.id) : variant.sku,
        quantity: normalizeStock(variant.stock),
      })
    }
  } else if (doc.sku) {
    rows.push({
      sku: doc.sku,
      product_id: productId,
      variant_id: null,
      quantity: normalizeStock(doc.stock),
    })
  }

  if (rows.length === 0) return

  for (const row of rows) {
    const { data: existing } = await supabase
      .from('inventory')
      .select('id, reserved_quantity')
      .eq('sku', row.sku)
      .maybeSingle()

    if (existing) {
      // Never set quantity below already-reserved units
      const reserved = existing.reserved_quantity ?? 0
      const quantity = Math.max(row.quantity, reserved)
      const { error } = await supabase
        .from('inventory')
        .update({
          product_id: row.product_id,
          variant_id: row.variant_id,
          quantity,
          updated_at: new Date().toISOString(),
        })
        .eq('sku', row.sku)
      if (error) throw error
    } else {
      const { error } = await supabase.from('inventory').insert({
        sku: row.sku,
        product_id: row.product_id,
        variant_id: row.variant_id,
        quantity: row.quantity,
        reserved_quantity: 0,
      })
      if (error) throw error
    }
  }
}

export async function getInventoryBySkus(skus: string[]) {
  if (skus.length === 0) return []
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.from('inventory').select('*').in('sku', skus)
  if (error) throw error
  return data ?? []
}

/** Read stock from Payload CMS by product/variant SKU (fallback when inventory row missing). */
export async function getCmsStockBySku(sku: string): Promise<number> {
  try {
    const { getPayloadClient } = await import('@/lib/payload')
    const payload = await getPayloadClient()

    const byVariant = await payload.find({
      collection: 'products',
      where: { 'variants.sku': { equals: sku } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      locale: 'tr',
    })
    const variantProduct = byVariant.docs[0] as Product | undefined
    if (variantProduct?.variants?.length) {
      const match = variantProduct.variants.find((v) => v.sku === sku)
      if (match) return normalizeStock(match.stock)
    }

    const bySku = await payload.find({
      collection: 'products',
      where: { sku: { equals: sku } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      locale: 'tr',
    })
    const product = bySku.docs[0] as Product | undefined
    if (product) return normalizeStock(product.stock)
  } catch {
    // ignore — treat as zero
  }
  return 0
}

export async function getAvailableStock(sku: string): Promise<number> {
  const cmsStock = await getCmsStockBySku(sku)

  try {
    const rows = await getInventoryBySkus([sku])
    const row = rows[0]
    if (row) {
      // Prefer CMS stock as base; only reserved_quantity comes from ops inventory
      return Math.max(0, cmsStock - (row.reserved_quantity ?? 0))
    }
  } catch {
    // ignore inventory read failures
  }

  return cmsStock
}

/**
 * Stock changes go exclusively through the atomic inventory RPCs (supabase/migrations/002).
 * There is deliberately no client-side fallback: a non-atomic read-modify-write could
 * oversell under concurrency, so an RPC failure fails the operation instead.
 */
function inventoryRpcError(fn: string, sku: string, error: { message?: string }) {
  return new Error(`${fn} failed for ${sku}: ${error.message ?? 'unknown error'}`)
}

export async function reserveStock(sku: string, qty: number, idempotencyKey: string): Promise<boolean> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('reserve_inventory', {
    p_sku: sku,
    p_qty: qty,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw inventoryRpcError('reserve_inventory', sku, error)
  return Boolean(data)
}

export async function commitStock(
  sku: string,
  qty: number,
  orderId: string,
  idempotencyKey: string
): Promise<boolean> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.rpc('commit_inventory', {
    p_sku: sku,
    p_qty: qty,
    p_order_id: orderId,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw inventoryRpcError('commit_inventory', sku, error)
  return Boolean(data)
}

/** Undo a prior reserve (payment failure / checkout abort). Idempotent. */
export async function releaseStock(sku: string, qty: number, idempotencyKey: string): Promise<boolean> {
  const { getSupabaseAdmin } = await import('@/lib/supabase/admin')
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase.rpc('release_inventory', {
    p_sku: sku,
    p_qty: qty,
    p_idempotency_key: idempotencyKey,
  })

  if (error) throw inventoryRpcError('release_inventory', sku, error)
  return Boolean(data)
}

/**
 * Runs `fn` while holding a transaction-scoped Postgres advisory lock for this product, so read-modify-write
 * updates of the CMS stock from different serverless instances cannot overwrite each other.
 * The lock is polled (try-lock + short sleeps) instead of blocking, so waiters never hold a
 * pool connection while the lock owner still needs one for its own update.
 */
async function withProductStockLock<T>(
  payload: { db: unknown },
  productId: string | number,
  fn: () => Promise<T>
): Promise<T> {
  type PgPool = {
    connect: () => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
      release: () => void
    }>
  }
  const pool = (payload.db as { pool?: PgPool }).pool
  if (!pool) return fn() // adapter without pool access: fall back to unlocked update

  const key = `cms-stock-tx:${productId}`
  const deadline = Date.now() + 50_000
  for (;;) {
    const client = await pool.connect()
    try {
      // Transaction-scoped lock: works behind Supabase's transaction pooler (port 6543), where
      // session-level advisory locks are NOT reliable. The transaction stays open while fn runs
      // (the backend is pinned for that time) and COMMIT releases the lock.
      await client.query('begin')
      const res = await client.query('select pg_try_advisory_xact_lock(hashtext($1)) as ok', [key])
      if (res.rows[0]?.ok === true) {
        try {
          return await fn()
        } finally {
          await client.query('commit').catch(() => null)
        }
      }
      await client.query('rollback').catch(() => null)
    } catch (err) {
      await client.query('rollback').catch(() => null)
      throw err
    } finally {
      client.release()
    }
    if (Date.now() > deadline) throw new Error(`stock lock timeout for product ${productId}`)
    await new Promise((r) => setTimeout(r, 40 + randomInt(60)))
  }
}

/**
 * Decrement the CMS stock (source of truth for storefront availability) after a
 * paid sale. Without this, inventory.quantity is reset from the CMS on the next
 * product save and sold units reappear.
 * Callers must guarantee single execution per order (paid claim); concurrent orders for the
 * same product are serialised by an advisory lock and always re-read the current stock.
 */
export async function decrementCmsStock(sku: string, qty: number): Promise<boolean> {
  try {
    const { getPayloadClient } = await import('@/lib/payload')
    const payload = await getPayloadClient()

    // 1) locate the product (variant SKU first, then main SKU)
    const byVariant = await payload.find({
      collection: 'products',
      where: { 'variants.sku': { equals: sku } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      locale: 'tr',
    })
    let located = byVariant.docs[0] as Product | undefined
    if (!located?.variants?.some((v) => v.sku === sku)) {
      const bySku = await payload.find({
        collection: 'products',
        where: { sku: { equals: sku } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
        locale: 'tr',
      })
      located = bySku.docs[0] as Product | undefined
    }
    if (!located) return false
    const productId = located.id

    // 2) under the lock: re-read the CURRENT stock, subtract, write
    return await withProductStockLock(payload, productId, async () => {
      const fresh = (await payload.findByID({
        collection: 'products',
        id: productId,
        depth: 0,
        overrideAccess: true,
        locale: 'tr',
      })) as Product

      const variant = fresh.variants?.find((v) => v.sku === sku)
      if (variant) {
        const variants = fresh.variants!.map((v) =>
          v.sku === sku ? { ...v, stock: Math.max(0, normalizeStock(v.stock) - qty) } : v
        )
        await payload.update({
          collection: 'products',
          id: productId,
          data: { variants },
          depth: 0,
          overrideAccess: true,
          locale: 'tr',
        })
        return true
      }
      if (fresh.sku === sku) {
        await payload.update({
          collection: 'products',
          id: productId,
          data: { stock: Math.max(0, normalizeStock(fresh.stock) - qty) },
          depth: 0,
          overrideAccess: true,
          locale: 'tr',
        })
        return true
      }
      return false
    })
  } catch (err) {
    console.error('[decrementCmsStock]', sku, err instanceof Error ? err.message : 'unknown')
  }
  return false
}
