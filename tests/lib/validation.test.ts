import { describe, expect, it } from 'vitest'
import { isValidName, isValidPhone, passwordProblem, sanitizeName, sanitizePhone } from '@/lib/validation'

describe('passwordProblem', () => {
  it.each(['12345678', '123456789', 'abcdefgh', 'qwertyui', '11111111', 'aaaaaaaa', 'password', 'Parola123', 'qwerty123', 'abcd1234', 'Abc12'])(
    'rejects weak password %s',
    (pw) => expect(passwordProblem(pw)).not.toBeNull()
  )
  it.each(['Deri.Canta.1967', 'kahve42ceviz', 'Ulus2026Hisar'])('accepts %s', (pw) => expect(passwordProblem(pw)).toBeNull())
  it('rejects passwords containing the e-mail name', () => {
    expect(passwordProblem('ayseyilmaz99', 'ayseyilmaz@example.com')).not.toBeNull()
  })
})

describe('names', () => {
  it.each(['Ayşe', 'Çağrı Öz', "O'Neil", 'Ali-Selim'])('accepts %s', (n) => expect(isValidName(n)).toBe(true))
  it.each(['Ali1', '123', 'A', 'Ayşe!'])('rejects %s', (n) => expect(isValidName(n)).toBe(false))
  it('strips digits while typing', () => expect(sanitizeName('Ay5şe 2')).toBe('Ayşe '))
})

describe('phones', () => {
  it.each(['05551112233', '5551112233', '+90 555 111 22 33', '0312 311 55 11', '905551112233'])('accepts %s', (p) =>
    expect(isValidPhone(p)).toBe(true)
  )
  it.each(['0555abc2233', '12345', '0155511122', '05551112233444'])('rejects %s', (p) => expect(isValidPhone(p)).toBe(false))
  it('strips letters while typing', () => expect(sanitizePhone('+90 5a5b5')).toBe('+90 555'))
})
