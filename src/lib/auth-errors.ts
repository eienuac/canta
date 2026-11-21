/** Turkish messages for Supabase Auth errors shown to customers (login, sign-up, password). */
const BY_CODE: Record<string, string> = {
  invalid_credentials: 'E-posta veya şifre hatalı.',
  user_already_exists: 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin.',
  email_exists: 'Bu e-posta adresiyle zaten bir hesap var. Giriş yapmayı deneyin.',
  weak_password: 'Şifre yeterince güçlü değil. En az 8 karakter, harf ve rakam kullanın.',
  same_password: 'Yeni şifre eskisiyle aynı olamaz.',
  email_address_invalid: 'Geçerli bir e-posta adresi girin.',
  email_not_confirmed: 'E-posta adresiniz henüz doğrulanmadı.',
  over_request_rate_limit: 'Çok fazla deneme yaptınız. Lütfen birkaç dakika sonra tekrar deneyin.',
  over_email_send_rate_limit: 'Çok fazla e-posta isteği gönderildi. Lütfen biraz sonra tekrar deneyin.',
  signup_disabled: 'Şu anda yeni üyelik alınmıyor.',
  user_banned: 'Bu hesap kullanıma kapatılmış.',
  session_expired: 'Oturumunuzun süresi doldu. Lütfen tekrar giriş yapın.',
  reauthentication_needed: 'Bu işlem için tekrar giriş yapmanız gerekiyor.',
  validation_failed: 'Girilen bilgileri kontrol edin.',
}

const BY_MESSAGE: Array<[RegExp, string]> = [
  [/invalid login credentials/i, BY_CODE.invalid_credentials],
  [/already registered|already exists/i, BY_CODE.user_already_exists],
  [/password should be at least|password is too weak|weak password/i, BY_CODE.weak_password],
  [/different from the old password/i, BY_CODE.same_password],
  [/rate limit|too many requests/i, BY_CODE.over_request_rate_limit],
  [/email not confirmed/i, BY_CODE.email_not_confirmed],
  [/invalid.*email|email.*invalid/i, BY_CODE.email_address_invalid],
  [/network|failed to fetch/i, 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.'],
]

export function authErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') return fallback
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof code === 'string' && BY_CODE[code]) return BY_CODE[code]
  if (typeof message === 'string') {
    for (const [re, text] of BY_MESSAGE) if (re.test(message)) return text
  }
  return fallback
}
