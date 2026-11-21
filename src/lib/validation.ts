/**
 * Shared input rules for customer-facing forms and their server-side schemas.
 * Names: letters (incl. Turkish), spaces, apostrophe, dot, hyphen. Phones: digits only
 * (an optional leading + and spaces are tolerated, then stripped).
 */

const NAME_RE = /^\p{L}[\p{L}\s'.-]*$/u

/** Removes characters a name may not contain (used while typing). */
export function sanitizeName(value: string): string {
  return value.replace(/[^\p{L}\s'.-]/gu, '')
}

export function isValidName(value: string): boolean {
  const v = value.trim()
  return v.length >= 2 && v.length <= 80 && NAME_RE.test(v)
}

/** Keeps digits, a single leading + and spaces (used while typing). */
export function sanitizePhone(value: string): string {
  const plus = value.trimStart().startsWith('+') ? '+' : ''
  return plus + value.replace(/[^\d ]/g, '').slice(0, 20)
}

/** Turkish mobile/landline: 10 digits (5xx… / 2xx… / 3xx…) with optional 0, 90 or +90 prefix. */
export function isValidPhone(value: string): boolean {
  if (/[^\d\s+()-]/.test(value)) return false
  const digits = value.replace(/\D/g, '')
  const local = digits.startsWith('90') && digits.length === 12 ? digits.slice(2) : digits.replace(/^0/, '')
  return /^[2-5]\d{9}$/.test(local)
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'parola', 'parola123', 'sifre', 'sifre123', 'şifre123',
  'qwerty', 'qwerty123', 'qwertyui', 'asdfghjk', 'abc12345', 'abcd1234', 'a1b2c3d4', 'iloveyou',
  'admin123', 'welcome1', 'letmein1', 'galatasaray', 'fenerbahce', 'besiktas', 'trabzonspor',
  'seckin123', 'seckincanta', 'canta123', 'turkiye1', 'ankara06', 'istanbul34',
])

function isSequential(s: string): boolean {
  const lower = s.toLowerCase()
  const rows = ['0123456789', '9876543210', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
  return rows.some((row) => row.includes(lower))
}

/**
 * Returns a Turkish message when the password is too weak, otherwise null.
 * Rules: ≥ 8 chars, letters and digits, not a repeated/sequential run, not a common password,
 * not the e-mail's name part.
 */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 8) return 'Şifre en az 8 karakter olmalı.'
  if (password.length > 72) return 'Şifre en fazla 72 karakter olabilir.'
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'Şifre hem harf hem rakam içermeli.'
  if (/^(.)\1+$/u.test(password)) return 'Şifre aynı karakterin tekrarı olamaz.'
  const core = password.toLowerCase().replace(/\d+$/, '')
  if (isSequential(password) || (core.length >= 4 && isSequential(core))) {
    return 'Şifre "12345678", "abcdefgh", "qwerty" gibi sıralı karakterlerden oluşamaz.'
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'Bu şifre çok yaygın, başka bir şifre seçin.'
  const local = email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
    return 'Şifre e-posta adınızı içermemeli.'
  }
  return null
}
