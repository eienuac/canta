export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Ödeme Bekleniyor',
  payment_review: 'Ödeme İnceleniyor',
  payment_received: 'Ödeme Alındı',
  preparing: 'Hazırlanıyor',
  shipped: 'Kargoya Verildi',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal Edildi',
  returned: 'İade Edildi',
}

export const RETURN_STATUS_LABELS: Record<string, string> = {
  requested: 'Talep oluşturuldu',
  reviewing: 'İnceleniyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  awaiting_shipment: 'Kargoya verilmesi bekleniyor',
  received: 'Ürün ulaştı',
  refunded: 'Ücret iade edildi',
}

/** Why a paid order is held in payment_review / flagged (admin panel). */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  AMOUNT_MISMATCH: 'Ödenen tutar sipariş tutarıyla uyuşmuyor',
  PAID_LESS_THAN_PRICE: 'Tahsil edilen tutar sepet tutarından düşük',
  CURRENCY_MISMATCH: 'Para birimi uyuşmuyor',
  LATE_PAYMENT: 'Ödeme, sipariş iptal edildikten sonra geldi',
  POSSIBLE_DUPLICATE_ORDER: 'Aynı sepet için başka bir ödenmiş sipariş var (olası çift ödeme)',
  DUPLICATE_PAYMENT: 'Sipariş için ikinci bir ödeme alındı — iade gerekli',
  STOCK: 'Ödeme sonrası stok düşülemedi',
  BACKFILL_NO_STOCK_COMMIT: 'Eski kayıt: stok düşümü bulunamadı',
}

export function reviewReasonLabel(reason: string | null | undefined): string {
  if (!reason) return ''
  const key = reason.startsWith('STOCK') ? 'STOCK' : reason.split(';').pop()!.trim()
  return REVIEW_REASON_LABELS[key] ?? reason
}
