import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const MAX_REQUESTS_PER_ORDER = 3

/** Only images we host ourselves (Supabase storage) are accepted as evidence photos. */
function isOwnStorageUrl(value: string) {
  try {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) return false
    const u = new URL(value)
    return u.protocol === 'https:' && u.host === new URL(base).host
  } catch {
    return false
  }
}

export const createReturnSchema = z.object({
  orderId: z.string().uuid(),
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        orderItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(100),
        photoUrls: z
          .array(
            z
              .string()
              .url()
              .max(500)
              .refine(isOwnStorageUrl, 'Geçersiz fotoğraf adresi')
          )
          .max(5)
          .optional(),
      })
    )
    .min(1)
    .max(20),
})

export async function createReturnRequest(input: z.infer<typeof createReturnSchema>) {
  const data = createReturnSchema.parse(input)
  const supabase = getSupabaseAdmin()

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', data.orderId)
    .eq('user_id', data.userId)
    .single()

  if (!order) throw new Error('Sipariş bulunamadı')
  if (order.status !== 'delivered') {
    throw new Error('Yalnızca teslim edilmiş siparişler için iade açılabilir')
  }

  // Each order item may appear once, must belong to this order and the requested
  // quantity must not exceed what was bought minus what is already being returned.
  const ids = data.items.map((i) => i.orderItemId)
  if (new Set(ids).size !== ids.length) throw new Error('Aynı ürün birden fazla kez eklenemez')

  const { data: orderItems } = await supabase
    .from('order_items')
    .select('id, quantity')
    .eq('order_id', data.orderId)
  const bought = new Map((orderItems ?? []).map((oi) => [oi.id, oi.quantity]))
  for (const item of data.items) {
    if (!bought.has(item.orderItemId)) throw new Error('Geçersiz sipariş kalemi')
  }

  const { data: priorRequests } = await supabase
    .from('return_requests')
    .select('id, status')
    .eq('order_id', data.orderId)
  if ((priorRequests ?? []).length >= MAX_REQUESTS_PER_ORDER) {
    throw new Error('Bu sipariş için iade talebi sınırına ulaşıldı')
  }

  const activeIds = (priorRequests ?? []).filter((r) => r.status !== 'rejected').map((r) => r.id)
  const alreadyReturned = new Map<string, number>()
  if (activeIds.length) {
    const { data: priorItems } = await supabase
      .from('return_items')
      .select('order_item_id, quantity')
      .in('return_request_id', activeIds)
    for (const pi of priorItems ?? []) {
      alreadyReturned.set(pi.order_item_id, (alreadyReturned.get(pi.order_item_id) ?? 0) + pi.quantity)
    }
  }
  for (const item of data.items) {
    const left = (bought.get(item.orderItemId) ?? 0) - (alreadyReturned.get(item.orderItemId) ?? 0)
    if (item.quantity > left) throw new Error('İade miktarı satın alınan miktarı aşıyor')
  }

  const { data: request, error } = await supabase
    .from('return_requests')
    .insert({
      order_id: data.orderId,
      user_id: data.userId,
      reason: data.reason,
      description: data.description ?? null,
      status: 'requested',
    })
    .select('*')
    .single()

  if (error || !request) throw error || new Error('İade talebi oluşturulamadı')

  const items = data.items.map((item) => ({
    return_request_id: request.id,
    order_item_id: item.orderItemId,
    quantity: item.quantity,
    photo_urls: item.photoUrls ?? [],
  }))

  const { error: itemsError } = await supabase.from('return_items').insert(items)
  if (itemsError) {
    // Do not leave an empty request behind
    await supabase.from('return_requests').delete().eq('id', request.id)
    throw itemsError
  }

  return request
}

export async function updateReturnStatus(
  returnId: string,
  status: string,
  adminNotes?: string
) {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('return_requests')
    .update({
      status: status as never,
      admin_notes: adminNotes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', returnId)
    .select('*')
    .single()
  if (error) throw error
  return data
}

export { RETURN_STATUS_LABELS } from '@/lib/labels'
