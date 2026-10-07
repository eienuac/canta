import { nanoid } from 'nanoid'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { assertCartAccess, getCartWithProducts } from '@/services/cart'
import { validateCoupon } from '@/services/coupons'
import {
  commitStock,
  decrementCmsStock,
  releaseStock,
  reserveStock,
} from '@/services/inventory/sync'
import { calculateShipping } from '@/services/shipping'
import { getPaymentProvider } from '@/services/payment'
import { absoluteUrl } from '@/lib/utils'

export const checkoutAddressSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(10),
  city: z.string().min(2),
  district: z.string().optional(),
  neighborhood: z.string().optional(),
  addressLine: z.string().min(5),
  postalCode: z.string().optional(),
})

export const checkoutSchema = z.object({
  cartId: z.string().uuid(),
  guestToken: z.string().min(8).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  shippingMethod: z.enum(['standard', 'express']).default('standard'),
  address: checkoutAddressSchema,
  couponCode: z.string().optional().nullable(),
  idempotencyKey: z.string().min(8),
  clientIp: z.string().default('127.0.0.1'),
})

function generateOrderNumber() {
  const date = new Date()
  const y = date.getFullYear().toString().slice(-2)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `SC${y}${m}${d}${nanoid(6).toUpperCase()}`
}

async function releaseReservations(
  items: Array<{ sku: string; quantity: number }>,
  idempotencyKey: string
) {
  for (const item of items) {
    await releaseStock(
      item.sku,
      item.quantity,
      `${idempotencyKey}:release:${item.sku}`
    ).catch((err) => {
      console.error('[releaseReservations]', item.sku, err)
    })
  }
}

/**
 * Server-side checkout: never trusts client prices.
 * Re-fetches product prices from CMS and stock from Supabase.
 */
export async function createCheckoutSession(input: z.infer<typeof checkoutSchema>) {
  const data = checkoutSchema.parse(input)
  const supabase = getSupabaseAdmin()

  // Ownership first — also protects the idempotent-replay branch below.
  await assertCartAccess(data.cartId, data.userId, data.guestToken)

  // Opportunistically free stock held by abandoned checkouts.
  await releaseExpiredPendingOrders(20).catch(() => 0)

  const { data: existing } = await supabase
    .from('orders')
    .select('*')
    .eq('idempotency_key', data.idempotencyKey)
    .maybeSingle()
  if (existing) {
    if (existing.cart_id !== data.cartId) {
      throw new Error('Geçersiz sipariş isteği')
    }
    if (existing.payment_status === 'paid') {
      return { order: existing, payment: null, reused: true as const }
    }
    // Re-init payment for the same idempotent checkout attempt
    if (existing.payment_status === 'pending') {
      const cart = await getCartWithProducts(data.cartId)
      const provider = getPaymentProvider()
      const paymentInit = await provider.createPayment({
        orderId: existing.id,
        orderNumber: existing.order_number,
        amount: Number(existing.total),
        currency: 'TRY',
        buyer: {
          id: data.userId || data.address.email,
          name: data.address.firstName,
          surname: data.address.lastName,
          email: data.address.email,
          phone: data.address.phone,
          ip: data.clientIp,
          city: data.address.city,
          country: 'Turkey',
          address: data.address.addressLine,
        },
        basketItems: [
          ...cart.items.map((item) => ({
            id: item.sku,
            name: item.name,
            category: 'Deri',
            price: item.lineTotal,
          })),
          ...(Number(existing.shipping_cost) > 0
            ? [
                {
                  id: `shipping-${existing.shipping_method || 'standard'}`,
                  name: 'Kargo',
                  category: 'Kargo',
                  price: Number(existing.shipping_cost),
                },
              ]
            : []),
        ],
        callbackUrl: absoluteUrl('/api/payments/callback'),
      })
      // Keep the stored checkout token in sync with the newest initialize call
      if (paymentInit.providerPaymentId) {
        await supabase
          .from('payments')
          .update({
            provider_payment_id: paymentInit.providerPaymentId,
            updated_at: new Date().toISOString(),
          })
          .eq('order_id', existing.id)
          .eq('status', 'pending')
      }
      return { order: existing, payment: paymentInit, reused: true as const }
    }
    return { order: existing, payment: null, reused: true as const }
  }

  // A new attempt replaces any earlier unpaid attempt for this cart (frees its reservation).
  await cancelPendingOrdersForCart(data.cartId)

  const cart = await getCartWithProducts(data.cartId)
  if (!cart.items.length) {
    throw new Error('Sepet boş')
  }
  if (cart.checkoutBlocked || cart.hasStockIssues) {
    const bad = cart.items.filter((i) => i.stockStatus !== 'ok').map((i) => i.name)
    throw new Error(
      bad.length
        ? `Sepetinizde stok sorunu var: ${bad.join(', ')}`
        : 'Sepetinizde stok sorunu var'
    )
  }

  const reserved: Array<{ sku: string; quantity: number }> = []
  let createdOrderId: string | null = null
  let itemsInserted = false
  try {
    for (const item of cart.items) {
      const ok = await reserveStock(
        item.sku,
        item.quantity,
        `${data.idempotencyKey}:reserve:${item.sku}`
      )
      if (!ok) {
        throw new Error(`${item.name} için yeterli stok yok`)
      }
      reserved.push({ sku: item.sku, quantity: item.quantity })
    }

    let discountTotal = 0
    let couponCode: string | null = null
    const codeFromRequest = data.couponCode?.trim() || null
    const codeFromCart = cart.couponCode || cart.cart?.coupon_code || null
    const resolvedCoupon = codeFromRequest || codeFromCart
    if (resolvedCoupon) {
      const coupon = await validateCoupon({
        code: resolvedCoupon,
        subtotal: cart.subtotal,
        userId: data.userId,
        guestEmail: data.address.email,
      })
      if (!coupon.valid) throw new Error(coupon.error)
      discountTotal = coupon.discount
      couponCode = coupon.coupon.code
    }

    const shipping = calculateShipping({
      method: data.shippingMethod,
      subtotal: cart.subtotal - discountTotal,
    })

    const total = Math.max(0, cart.subtotal - discountTotal + shipping.cost)
    const orderNumber = generateOrderNumber()

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: data.userId ?? null,
        guest_email: data.userId ? null : data.address.email.trim().toLowerCase(),
        status: 'pending_payment',
        payment_status: 'pending',
        subtotal: cart.subtotal,
        discount_total: discountTotal,
        shipping_cost: shipping.cost,
        total,
        currency: 'TRY',
        coupon_code: couponCode,
        shipping_method: shipping.method,
        shipping_address: data.address,
        billing_address: data.address,
        cart_id: data.cartId,
        notes: `cart_id:${data.cartId}`,
        idempotency_key: data.idempotencyKey,
      })
      .select('*')
      .single()

    if (error || !order) throw error || new Error('Sipariş oluşturulamadı')
    createdOrderId = order.id

    const orderItems = cart.items.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      product_name_snapshot: item.name,
      product_sku_snapshot: item.sku,
      product_image_snapshot: item.imageUrl,
      unit_price_snapshot: item.unitPrice,
      quantity: item.quantity,
      variant_snapshot: item.variant,
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
    if (itemsError) throw itemsError
    itemsInserted = true

    // Atomic coupon limit check (serialised in the DB). The pre-check in validateCoupon is
    // only a fast path; this one cannot be raced by parallel checkouts.
    if (couponCode) {
      const { data: claimOk, error: claimError } = await supabase.rpc('coupon_claim_ok', {
        p_order_id: order.id,
      })
      if (claimError) throw claimError
      if (!claimOk) throw new Error('Kupon kullanım limitine ulaşıldı')
    }

    const provider = getPaymentProvider()
    const paymentInit = await provider.createPayment({
      orderId: order.id,
      orderNumber: order.order_number,
      amount: total,
      currency: 'TRY',
      buyer: {
        id: data.userId || data.address.email,
        name: data.address.firstName,
        surname: data.address.lastName,
        email: data.address.email,
        phone: data.address.phone,
        ip: data.clientIp,
        city: data.address.city,
        country: 'Turkey',
        address: data.address.addressLine,
      },
      basketItems: [
        ...cart.items.map((item) => ({
          id: item.sku,
          name: item.name,
          category: 'Deri',
          price: item.lineTotal,
        })),
        ...(shipping.cost > 0
          ? [
              {
                id: `shipping-${shipping.method}`,
                name: shipping.label,
                category: 'Kargo',
                price: shipping.cost,
              },
            ]
          : []),
      ],
      callbackUrl: absoluteUrl('/api/payments/callback'),
    })

    const { error: paymentInsertError } = await supabase.from('payments').insert({
      order_id: order.id,
      provider: provider.name,
      provider_payment_id: paymentInit.providerPaymentId ?? null,
      amount: total,
      currency: 'TRY',
      status: 'pending',
      raw_response: (paymentInit.raw as import('@/types/database').Json) ?? null,
      idempotency_key: `${data.idempotencyKey}:payment`,
    })
    if (paymentInsertError) throw paymentInsertError

    return { order, payment: paymentInit, reused: false as const }
  } catch (err) {
    if (createdOrderId && itemsInserted) {
      // Order row + items exist → cancelPendingOrder releases reservations exactly once.
      const done = await cancelPendingOrder(createdOrderId).catch(() => false)
      if (!done && reserved.length) {
        await releaseReservations(reserved, data.idempotencyKey)
      }
    } else if (reserved.length) {
      if (createdOrderId) {
        await supabase
          .from('orders')
          .update({ status: 'cancelled', payment_status: 'failed' })
          .eq('id', createdOrderId)
          .eq('payment_status', 'pending')
      }
      await releaseReservations(reserved, data.idempotencyKey)
    }
    throw err
  }
}

const PENDING_ORDER_TTL_MS = 30 * 60 * 1000

type OrderRow = import('@/types/database').Database['public']['Tables']['orders']['Row']

function appendNote(existing: string | null | undefined, note: string) {
  return existing ? `${existing};${note}` : note
}

/**
 * Atomically moves a still-pending order to cancelled/failed and releases its stock
 * reservation exactly once. Returns false if somebody else already moved it
 * (paid / cancelled), so callers never double-release.
 */
export async function cancelPendingOrder(orderId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()
  const { data: claimed } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      payment_status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()
  if (!claimed) return false

  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId)
  for (const item of items ?? []) {
    await releaseStock(
      item.product_sku_snapshot,
      item.quantity,
      `cancel:${orderId}:release:${item.product_sku_snapshot}`
    ).catch((err) => {
      console.error('[cancelPendingOrder] release failed', item.product_sku_snapshot, err)
    })
  }

  await supabase
    .from('payments')
    .update({ status: 'failed', updated_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'pending')

  return true
}

/**
 * Frees stock held by abandoned checkouts. Safe to call often; also wired to a daily cron.
 */
export async function releaseExpiredPendingOrders(limit = 50): Promise<number> {
  const supabase = getSupabaseAdmin()
  const cutoff = new Date(Date.now() - PENDING_ORDER_TTL_MS).toISOString()
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('payment_status', 'pending')
    .lt('created_at', cutoff)
    .limit(limit)
  let released = 0
  for (const row of data ?? []) {
    if (await cancelPendingOrder(row.id)) released++
  }
  return released
}

async function cancelPendingOrdersForCart(cartId: string) {
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('cart_id', cartId)
    .eq('payment_status', 'pending')
  for (const row of data ?? []) {
    await cancelPendingOrder(row.id)
  }
}

export async function markOrderPaymentFailed(params: {
  orderId: string
  providerPaymentId?: string
  raw?: unknown
  webhookIdempotencyKey?: string
}) {
  const supabase = getSupabaseAdmin()

  const { data: order } = await supabase.from('orders').select('*').eq('id', params.orderId).single()
  if (!order) throw new Error('Order not found')
  if (order.payment_status === 'paid') {
    return { ok: true, ignored: true as const }
  }

  const cancelled = await cancelPendingOrder(order.id)

  // Keep the checkout token in provider_payment_id so a late successful payment
  // can still be matched and verified.
  await supabase
    .from('payments')
    .update({
      status: 'failed',
      raw_response: (params.raw as import('@/types/database').Json) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', order.id)
    .neq('status', 'paid')

  return { ok: true, duplicate: !cancelled }
}

export async function finalizePaidOrder(params: {
  orderId: string
  /** iyzico checkout-form token (verified against the token we stored at initialize) */
  token?: string
  providerPaymentId?: string
  amount?: number
  currency?: string
  raw?: unknown
  /** @deprecated idempotency is now enforced by an atomic paid-claim on the order */
  webhookIdempotencyKey?: string
}) {
  const supabase = getSupabaseAdmin()

  const { data: order } = await supabase.from('orders').select('*').eq('id', params.orderId).single()
  if (!order) throw new Error('Order not found')

  if (order.payment_status === 'paid') {
    return { ok: true, duplicate: true }
  }

  // Amount MUST be provided by the (verified) provider response and match exactly.
  if (params.amount == null || !Number.isFinite(params.amount)) {
    throw new Error('Payment amount missing')
  }
  if (Math.abs(Number(params.amount) - Number(order.total)) > 0.01) {
    throw new Error('Payment amount mismatch')
  }
  if (params.currency && params.currency.toUpperCase() !== String(order.currency).toUpperCase()) {
    throw new Error('Payment currency mismatch')
  }

  // The checkout token must be the one we issued for THIS order.
  if (params.token) {
    const { data: tokenRow } = await supabase
      .from('payments')
      .select('id')
      .eq('order_id', order.id)
      .eq('provider_payment_id', params.token)
      .limit(1)
      .maybeSingle()
    if (!tokenRow) throw new Error('Payment token mismatch')
  }

  // Atomic claim: only one concurrent caller can flip the order to paid.
  // 1) normal path — stock is still reserved
  const now = new Date().toISOString()
  let lateReleased = false
  let { data: claimed } = await supabase
    .from('orders')
    .update({ status: 'payment_received', payment_status: 'paid', updated_at: now })
    .eq('id', order.id)
    .eq('payment_status', 'pending')
    .select('id')
    .maybeSingle()
  // 2) late payment on an order we already cancelled/expired — reservation was released
  if (!claimed) {
    const late = await supabase
      .from('orders')
      .update({ status: 'payment_received', payment_status: 'paid', updated_at: now })
      .eq('id', order.id)
      .eq('payment_status', 'failed')
      .select('id')
      .maybeSingle()
    claimed = late.data
    lateReleased = Boolean(claimed)
  }
  if (!claimed) {
    return { ok: true, duplicate: true }
  }

  await supabase
    .from('payments')
    .update({
      status: 'paid',
      provider_payment_id: params.providerPaymentId ?? params.token ?? null,
      raw_response: (params.raw as import('@/types/database').Json) ?? null,
      updated_at: now,
    })
    .eq('order_id', order.id)

  // From here on the customer HAS paid: never throw — flag problems for manual follow-up.
  const problems: string[] = []
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id)

  for (const item of items ?? []) {
    const sku = item.product_sku_snapshot
    try {
      if (lateReleased) {
        const reservedAgain = await reserveStock(sku, item.quantity, `late:${order.id}:reserve:${sku}`)
        if (!reservedAgain) {
          problems.push(`STOK_YETERSIZ:${sku}`)
          continue
        }
      }
      const committed = await commitStock(sku, item.quantity, order.id, `order:${order.id}:commit:${sku}`)
      if (!committed) {
        problems.push(`COMMIT_BASARISIZ:${sku}`)
        continue
      }
      const decremented = await decrementCmsStock(sku, item.quantity)
      if (!decremented) problems.push(`CMS_STOK_DUSULMEDI:${sku}`)
    } catch (err) {
      console.error('[finalizePaidOrder] stock step failed', sku, err instanceof Error ? err.message : '')
      problems.push(`STOK_HATASI:${sku}`)
    }
  }

  if (problems.length) {
    console.error('[finalizePaidOrder] needs attention', { orderId: order.id, problems })
    await supabase
      .from('orders')
      .update({ notes: appendNote(order.notes, `ATTENTION:${problems.join(',')}`) })
      .eq('id', order.id)
  }

  if (order.coupon_code) {
    const { data: coupon } = await supabase
      .from('coupons')
      .select('id')
      .eq('code', order.coupon_code)
      .maybeSingle()
    if (coupon) {
      await supabase.from('coupon_usages').insert({
        coupon_id: coupon.id,
        user_id: order.user_id,
        order_id: order.id,
        guest_email: order.guest_email,
      })
    }
  }

  // Clear the cart after successful payment (user or guest)
  const cartId = (order as OrderRow).cart_id || cartIdFromNotes(order.notes)
  if (cartId) {
    await supabase.from('cart_items').delete().eq('cart_id', cartId)
  } else if (order.user_id) {
    const { data: cart } = await supabase
      .from('carts')
      .select('id')
      .eq('user_id', order.user_id)
      .maybeSingle()
    if (cart) {
      await supabase.from('cart_items').delete().eq('cart_id', cart.id)
    }
  }

  return { ok: true, duplicate: false }
}

function cartIdFromNotes(notes: string | null | undefined): string | null {
  const first = typeof notes === 'string' ? notes.split(';')[0] : null
  return first && first.startsWith('cart_id:') ? first.slice('cart_id:'.length) : null
}

export async function getOrderById(orderId: string) {
  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle()
  if (!order) return null
  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id)
  return { order, items: items ?? [] }
}

export async function getOrderForUser(orderId: string, userId: string) {
  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!order) return null

  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id)
  const { data: payments } = await supabase.from('payments').select('*').eq('order_id', order.id)

  return { order, items: items ?? [], payments: payments ?? [] }
}

export async function listOrdersForUser(userId: string) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/**
 * iyzico CF retrieve often omits conversationId. Resolve order via:
 * 1) conversationId (order UUID we sent at initialize)
 * 2) basketId (our order_number)
 * 3) CF token stored as payments.provider_payment_id at initialize
 */
export async function resolveOrderIdFromPaymentResult(input: {
  orderId?: string | null
  basketId?: string | null
  token?: string | null
  providerPaymentId?: string | null
}): Promise<string | null> {
  if (input.orderId) return input.orderId

  const supabase = getSupabaseAdmin()

  if (input.basketId) {
    const { data } = await supabase
      .from('orders')
      .select('id')
      .eq('order_number', input.basketId)
      .maybeSingle()
    if (data?.id) return data.id
  }

  const token = input.token || null
  if (token) {
    const { data } = await supabase
      .from('payments')
      .select('order_id')
      .eq('provider_payment_id', token)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.order_id) return data.order_id
  }

  return null
}

export { ORDER_STATUS_LABELS } from '@/lib/labels'
