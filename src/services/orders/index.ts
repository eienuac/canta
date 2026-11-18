import { nanoid } from 'nanoid'
import { PublicError } from '@/lib/errors'
import type { OrderStatus } from '@/types/database'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { assertCartAccess, getCartWithProducts } from '@/services/cart'
import { validateCoupon } from '@/services/coupons'
import { releaseStock, reserveStock } from '@/services/inventory/sync'
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
  shippingMethod: z.literal('standard').default('standard'),
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
      throw new PublicError('Geçersiz sipariş isteği')
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
      // Every initialize is its own attempt with its own token. Earlier tokens are kept
      // (marked superseded) so a payment completed on an older page is still matched,
      // recorded and — if the order was already paid — flagged for refund.
      if (paymentInit.providerPaymentId) {
        const now = new Date().toISOString()
        await supabase
          .from('payments')
          .update({ superseded_at: now, updated_at: now })
          .eq('order_id', existing.id)
          .eq('status', 'pending')
        const { error: attemptError } = await supabase.from('payments').insert({
          order_id: existing.id,
          provider: provider.name,
          provider_payment_id: paymentInit.providerPaymentId,
          amount: Number(existing.total),
          currency: 'TRY',
          status: 'pending',
          raw_response: (paymentInit.raw as import('@/types/database').Json) ?? null,
          idempotency_key: `${data.idempotencyKey}:payment:${nanoid(10)}`,
        })
        if (attemptError) throw attemptError
      }
      return { order: existing, payment: paymentInit, reused: true as const }
    }
    return { order: existing, payment: null, reused: true as const }
  }

  // A new attempt replaces any earlier unpaid attempt for this cart (frees its reservation).
  await cancelPendingOrdersForCart(data.cartId)

  const cart = await getCartWithProducts(data.cartId)
  if (!cart.items.length) {
    throw new PublicError('Sepet boş')
  }
  if (cart.checkoutBlocked || cart.hasStockIssues) {
    const bad = cart.items.filter((i) => i.stockStatus !== 'ok').map((i) => i.name)
    throw new PublicError(
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
        throw new PublicError(`${item.name} için yeterli stok yok`)
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
      if (!coupon.valid) throw new PublicError(coupon.error)
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

    if (error || !order) throw error || new PublicError('Sipariş oluşturulamadı')
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
      if (!claimOk) throw new PublicError('Kupon kullanım limitine ulaşıldı')
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

/** Throws unless `token` is a checkout token we issued for this order. */
async function assertTokenBelongsToOrder(orderId: string, token: string) {
  const supabase = getSupabaseAdmin()
  const { data: tokenRow } = await supabase
    .from('payments')
    .select('id')
    .eq('order_id', orderId)
    .eq('provider_payment_id', token)
    .limit(1)
    .maybeSingle()
  if (!tokenRow) throw new Error('Payment token mismatch')
}

/** The order a checkout token was issued for, or null if we never issued it. */
export async function findOrderIdByCheckoutToken(token: string): Promise<string | null> {
  if (!token) return null
  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('payments')
    .select('order_id')
    .eq('provider_payment_id', token)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.order_id ?? null
}

export type CheckoutFormOutcome =
  | { kind: 'unknown_token' }
  | { kind: 'unverified'; orderId: string }
  | { kind: 'mismatch'; orderId: string }
  | { kind: 'paid'; orderId: string }
  | { kind: 'review'; orderId: string }
  | { kind: 'failed'; orderId: string }
  | { kind: 'pending'; orderId: string }

/**
 * Single entry point for an iyzico Checkout Form result (browser callback or webhook).
 * 1) the token must be one WE issued → that fixes the order (caller input is never trusted)
 * 2) the result is retrieved from iyzico (unknown tokens never cause a provider call)
 * 3) the provider's conversationId / basketId, when present, must match that order
 * Only then is the order finalized or marked failed.
 */
export async function processCheckoutFormToken(token: string): Promise<CheckoutFormOutcome> {
  const orderId = await findOrderIdByCheckoutToken(token)
  if (!orderId) return { kind: 'unknown_token' }

  const verified = await getPaymentProvider().verifyWebhook(new Headers(), JSON.stringify({ token }))
  if (!verified.valid) return { kind: 'unverified', orderId }

  const supabase = getSupabaseAdmin()
  const { data: order } = await supabase
    .from('orders')
    .select('id, order_number')
    .eq('id', orderId)
    .maybeSingle()
  if (!order) return { kind: 'unverified', orderId }
  if (
    (verified.orderId && verified.orderId !== order.id) ||
    (verified.basketId && verified.basketId !== order.order_number)
  ) {
    console.error('[processCheckoutFormToken] provider result does not match token order', { orderId })
    return { kind: 'mismatch', orderId }
  }

  if (verified.status === 'paid') {
    const result = await finalizePaidOrder({
      orderId,
      token,
      providerPaymentId: verified.providerPaymentId,
      amount: verified.amount,
      price: verified.price,
      installment: verified.installment,
      currency: verified.currency,
      raw: verified.raw,
    })
    // The customer has paid in every case below; 'review' means we hold the order for a
    // manual check (amount, late or duplicate payment, stock) instead of completing it.
    return result.result === 'review' ? { kind: 'review', orderId } : { kind: 'paid', orderId }
  }

  if (verified.status === 'failed') {
    await markOrderPaymentFailed({
      orderId,
      token,
      providerPaymentId: verified.providerPaymentId,
      raw: verified.raw,
    })
    return { kind: 'failed', orderId }
  }

  return { kind: 'pending', orderId }
}

export async function markOrderPaymentFailed(params: {
  orderId: string
  /** iyzico checkout-form token; when given it must belong to this order */
  token?: string
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

  const now = new Date().toISOString()
  if (params.token) {
    await assertTokenBelongsToOrder(order.id, params.token)
    const { data: attempt } = await supabase
      .from('payments')
      .select('id, superseded_at')
      .eq('order_id', order.id)
      .eq('provider_payment_id', params.token)
      .limit(1)
      .maybeSingle()
    // A failed OLD attempt must not cancel the order while a newer attempt is open.
    if (attempt?.superseded_at) {
      await supabase
        .from('payments')
        .update({
          status: 'failed',
          raw_response: (params.raw as import('@/types/database').Json) ?? null,
          updated_at: now,
        })
        .eq('id', attempt.id)
        .eq('status', 'pending')
      return { ok: true, duplicate: false, supersededAttempt: true as const }
    }
  }

  const cancelled = await cancelPendingOrder(order.id)

  // Keep the checkout token in provider_payment_id so a late successful payment
  // can still be matched and verified.
  await supabase
    .from('payments')
    .update({
      status: 'failed',
      raw_response: (params.raw as import('@/types/database').Json) ?? null,
      updated_at: now,
    })
    .eq('order_id', order.id)
    .eq('status', 'pending')

  return { ok: true, duplicate: !cancelled }
}

export type FinalizeResult = {
  ok: true
  result: 'paid' | 'duplicate' | 'duplicate_payment' | 'review'
  reason?: string
  /** @deprecated kept for existing callers; true when nothing new was recorded */
  duplicate: boolean
}

/**
 * Records a verified payment and completes the order in ONE database transaction
 * (public.finalize_paid_order, migration 008): payment row, inventory commit, Payload CMS
 * stock, coupon usage and cart cleanup. Inconsistent payments (amount, currency, late or
 * duplicate payment, stock shortage) are kept and the order is put in `payment_review`.
 */
export async function finalizePaidOrder(params: {
  orderId: string
  /** iyzico checkout-form token we issued (required except for signed webhooks) */
  token?: string
  /** provider payment id */
  providerPaymentId?: string
  /** amount charged (paidPrice; may include installment interest) */
  amount?: number
  /** basket price reported by the provider; defaults to `amount` when the provider omits it */
  price?: number
  installment?: number
  currency?: string
  raw?: unknown
  /** @deprecated idempotency is enforced in the database function */
  webhookIdempotencyKey?: string
}): Promise<FinalizeResult> {
  const supabase = getSupabaseAdmin()
  const num = (v: number | undefined) => (v != null && Number.isFinite(v) ? v : null)

  const { data, error } = await supabase.rpc('finalize_paid_order', {
    p_order_id: params.orderId,
    p_token: params.token ?? null,
    p_provider_reference: params.providerPaymentId ?? null,
    p_price: num(params.price ?? params.amount),
    p_paid_price: num(params.amount),
    p_currency: params.currency ?? null,
    p_installment: num(params.installment),
    p_summary: (params.raw as import('@/types/database').Json) ?? {},
  })
  if (error) throw new Error(`finalize_paid_order failed: ${error.message}`)

  const outcome = (data ?? {}) as { result?: FinalizeResult['result']; reason?: string }
  const result = outcome.result ?? 'paid'
  if (result === 'review' || result === 'duplicate_payment') {
    console.error('[finalizePaidOrder] payment needs review', {
      orderId: params.orderId,
      result,
      reason: outcome.reason,
    })
  }
  return { ok: true, result, reason: outcome.reason, duplicate: result === 'duplicate' }
}

// ---------------------------------------------------------------------------
// Admin operations (order transitions are enforced by the orders_transition_guard trigger)
// ---------------------------------------------------------------------------

const ADMIN_ERROR_MESSAGES: Array<[RegExp, string]> = [
  [/invalid order status transition/i, 'Bu durum geçişine izin verilmiyor.'],
  [/invalid payment_status transition/i, 'Bu ödeme durumu geçişine izin verilmiyor.'],
  [/paid with stock committed/i, 'Ödemesi alınmamış veya stoğu düşülmemiş sipariş bu duruma geçirilemez.'],
  [/only be cancelled after a refund/i, 'Ödenmiş sipariş, iadesi kaydedilmeden iptal edilemez.'],
  [/must be refunded first/i, '"İade edildi" durumu için önce ödeme iadesi kaydedilmelidir.'],
  [/without a completed refund/i, 'Tamamlanmış bir iade kaydı olmadan sipariş iade edildi yapılamaz.'],
  [/not awaiting payment review/i, 'Sipariş ödeme incelemesinde değil.'],
  [/insufficient|cannot commit stock|CMS/i, 'Stok yetersiz; sipariş onaylanamadı. Ödemeyi iade edip siparişi iptal edin.'],
  [/reference is required/i, 'iyzico iade referansı zorunludur.'],
  [/not refundable/i, 'Bu ödeme iade edilebilir durumda değil.'],
]

function adminError(error: { message?: string } | null | undefined, fallback: string): PublicError {
  const message = error?.message ?? ''
  const match = ADMIN_ERROR_MESSAGES.find(([re]) => re.test(message))
  if (!match) console.error('[orders.admin]', message)
  return new PublicError(match ? match[1] : fallback)
}

export async function adminUpdateOrderStatus(params: {
  orderId: string
  status: OrderStatus
  trackingNumber?: string | null
}) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('orders')
    .update({
      status: params.status,
      tracking_number: params.trackingNumber || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.orderId)
  if (error) throw adminError(error, 'Sipariş güncellenemedi.')
}

/** Completes a `payment_review` order: commits stock (or fails without changing anything). */
export async function approvePaymentReview(orderId: string, adminId: string, note?: string) {
  const { error } = await getSupabaseAdmin().rpc('approve_payment_review', {
    p_order_id: orderId,
    p_admin_id: adminId,
    p_note: note?.trim() || null,
  })
  if (error) throw adminError(error, 'Sipariş onaylanamadı.')
}

/** Records a refund that was made manually in the iyzico panel (full refund of one payment). */
export async function recordManualRefund(paymentId: string, adminId: string, reference: string) {
  const { data, error } = await getSupabaseAdmin().rpc('record_manual_refund', {
    p_payment_id: paymentId,
    p_admin_id: adminId,
    p_reference: reference,
  })
  if (error) throw adminError(error, 'İade kaydedilemedi.')
  return data as { result: string; order_fully_refunded: boolean }
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

  if (input.token) return findOrderIdByCheckoutToken(input.token)

  return null
}

export { ORDER_STATUS_LABELS } from '@/lib/labels'
