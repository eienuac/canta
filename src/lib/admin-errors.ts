import { PublicError } from '@/lib/errors'

/**
 * Database rules (triggers / RPCs, migrations 008–010) reject invalid admin operations with
 * English messages. Map them to clear Turkish messages for the admin panel; anything unknown
 * is logged and replaced by `fallback`.
 */
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
  [/exceeds the refundable amount/i, 'İade tutarı, bu ödemeden iade edilebilecek tutarı aşıyor.'],
  [/already recorded/i, 'Bu iade referansı zaten kaydedilmiş.'],
  [/return cannot be marked refunded/i, 'Önce siparişin ödeme iadesini kaydedin; sonra iade talebi "Ücret iade edildi" yapılabilir.'],
]

export function adminError(error: { message?: string } | null | undefined, fallback: string): PublicError {
  const message = error?.message ?? ''
  const match = ADMIN_ERROR_MESSAGES.find(([re]) => re.test(message))
  if (!match) console.error('[orders.admin]', message)
  return new PublicError(match ? match[1] : fallback)
}
