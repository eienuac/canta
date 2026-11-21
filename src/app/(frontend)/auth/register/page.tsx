'use client'

import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from 'sonner'
import { mergeGuestCartAfterAuth } from '@/hooks/use-cart'
import { safeRedirectPath } from '@/lib/utils'
import { isValidName, passwordProblem, sanitizeName } from '@/lib/validation'

function safeNextPath(raw: string | null): string {
  return safeRedirectPath(raw, '/products')
}

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const nextPath = safeNextPath(searchParams.get('next'))
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidName(form.firstName) || !isValidName(form.lastName)) {
      toast.error('Ad ve soyad yalnızca harf içermeli (en az 2 harf).')
      return
    }
    const weak = passwordProblem(form.password, form.email)
    if (weak) {
      toast.error(weak)
      return
    }
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            first_name: form.firstName,
            last_name: form.lastName,
          },
        },
      })
      if (error) throw error
      await mergeGuestCartAfterAuth()
      toast.success('Kayıt başarılı')
      router.push(nextPath === '/products' ? '/account' : nextPath)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Kayıt başarısız')
    } finally {
      setLoading(false)
    }
  }

  async function google() {
    setGoogleLoading(true)
    try {
      const supabase = createClient()
      const redirectTo = new URL('/auth/callback', window.location.origin)
      redirectTo.searchParams.set('next', nextPath === '/products' ? '/account' : nextPath)
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectTo.toString(),
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      })
      if (error) throw error
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error('Google giriş başlatılamadı')
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Google ile giriş açılamadı. Supabase’de Google provider açık mı?'
      )
      setGoogleLoading(false)
    }
  }

  function continueAsGuest() {
    toast.message('Misafir olarak devam ediyorsunuz', {
      description: 'Sepet ve favoriler bu cihazda saklanır.',
    })
    router.push(nextPath.startsWith('/app-admin') ? '/products' : nextPath)
  }

  return (
    <form onSubmit={onSubmit} className="w-full max-w-md space-y-4 border border-border bg-ivory p-8">
      <h1 className="font-display text-3xl text-espresso">Kayıt Ol</h1>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Ad</Label>
          <Input
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: sanitizeName(e.target.value) })}
          />
        </div>
        <div>
          <Label>Soyad</Label>
          <Input
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: sanitizeName(e.target.value) })}
          />
        </div>
      </div>
      <div>
        <Label>E-posta</Label>
        <Input
          type="email"
          required
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>
      <div>
        <Label>Şifre</Label>
        <Input
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <p className="mt-1 text-xs text-muted">
          En az 8 karakter; harf ve rakam içermeli. 12345678 gibi sıralı ya da yaygın şifreler kabul edilmez.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={loading || googleLoading}>
        {loading ? 'Kaydediliyor…' : 'Kayıt Ol'}
      </Button>

      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-[11px] uppercase tracking-[0.16em]">
          <span className="bg-ivory px-3 text-muted">veya</span>
        </div>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={google}
        disabled={googleLoading || loading}
      >
        {googleLoading ? 'Google’a yönlendiriliyor…' : 'Google ile devam et'}
      </Button>

      <Button type="button" variant="secondary" className="w-full" onClick={continueAsGuest}>
        Müşteri olmadan devam et
      </Button>

      <p className="text-center text-sm text-muted">
        Zaten hesabınız var mı?{' '}
        <Link href="/auth/login" className="text-espresso underline">
          Giriş yapın
        </Link>
      </p>
    </form>
  )
}

export default function RegisterPage() {
  return (
    <div className="container-page flex justify-center py-20">
      <Suspense fallback={<div className="skeleton h-96 w-full max-w-md" />}>
        <RegisterForm />
      </Suspense>
    </div>
  )
}
