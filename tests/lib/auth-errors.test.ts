import { describe, expect, it } from 'vitest'
import { authErrorMessage } from '@/lib/auth-errors'

describe('authErrorMessage', () => {
  it('maps Supabase error codes', () => {
    expect(authErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 'x')).toBe('E-posta veya şifre hatalı.')
    expect(authErrorMessage({ code: 'user_already_exists' }, 'x')).toMatch(/zaten bir hesap/)
  })
  it('falls back to message patterns', () => {
    expect(authErrorMessage({ message: 'Password should be at least 8 characters.' }, 'x')).toMatch(/güçlü değil/)
    expect(authErrorMessage(new Error('Email rate limit exceeded'), 'x')).toMatch(/Çok fazla/)
  })
  it('never shows an unknown English message', () => {
    expect(authErrorMessage(new Error('Some unexpected upstream failure'), 'Giriş başarısız')).toBe('Giriş başarısız')
    expect(authErrorMessage(null, 'Giriş başarısız')).toBe('Giriş başarısız')
  })
})
