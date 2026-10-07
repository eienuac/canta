'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export default function SecurityPage() {
  const { user } = useAuth()
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')

  // Accounts created only through Google have no password to re-enter.
  const providers = (user?.app_metadata?.providers as string[] | undefined) ?? []
  const hasPassword = providers.includes('email')

  async function reauthenticate(pw: string) {
    if (!user?.email) return false
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: pw })
    return !error
  }

  async function changePassword() {
    if (password.length < 8) {
      toast.error('Yeni şifre en az 8 karakter olmalı')
      return
    }
    if (hasPassword && !(await reauthenticate(currentPassword))) {
      toast.error('Mevcut şifre hatalı')
      return
    }
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) toast.error(error.message)
    else {
      toast.success('Şifre güncellendi')
      setPassword('')
      setCurrentPassword('')
    }
  }

  async function deleteAccount() {
    if (hasPassword && !deletePassword) {
      toast.error('Hesabı silmek için şifrenizi girin')
      return
    }
    if (!confirm('Hesabınızı silmek istediğinize emin misiniz?')) return
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: deletePassword || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) toast.error(data.error || 'Silinemedi')
    else {
      toast.success('Hesap silindi')
      router.push('/')
    }
  }

  return (
    <div>
      <h2 className="font-display text-3xl text-espresso">Güvenlik</h2>
      <p className="mt-2 text-sm text-muted">{user?.email}</p>
      <div className="mt-8 max-w-md space-y-3">
        {hasPassword && (
          <div>
            <Label>Mevcut şifre</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        )}
        <div>
          <Label>Yeni şifre</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="button" onClick={changePassword}>
          Şifreyi değiştir
        </Button>
        <div className="space-y-3 border-t border-border pt-6">
          {hasPassword && (
            <div>
              <Label>Hesabı silmek için şifreniz</Label>
              <Input
                type="password"
                autoComplete="current-password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
              />
            </div>
          )}
          <Button type="button" variant="danger" onClick={deleteAccount}>
            Hesabı sil
          </Button>
        </div>
      </div>
    </div>
  )
}
