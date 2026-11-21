import { NextResponse } from 'next/server'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  if (!(await rateLimit(`newsletter:${await clientIp()}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Çok fazla deneme yaptınız. Lütfen biraz sonra tekrar deneyin.' }, { status: 429 })
  }

  const form = await request.formData()
  const email = String(form.get('email') || '')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Geçersiz e-posta' }, { status: 400 })
  }
  return NextResponse.redirect(new URL('/?newsletter=1', request.url), 303)
}
