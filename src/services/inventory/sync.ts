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
