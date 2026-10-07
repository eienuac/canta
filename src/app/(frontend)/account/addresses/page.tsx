'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { toast } from 'sonner'

type Address = {
  id: string
  title: string | null
  first_name: string
  last_name: string
  phone: string
  city: string
  address_line: string
  is_default: boolean
}

const FIELDS: Array<{ key: keyof typeof EMPTY_FORM; label: string; max: number }> = [
  { key: 'title', label: 'Adres başlığı', max: 60 },
  { key: 'first_name', label: 'Ad', max: 80 },
  { key: 'last_name', label: 'Soyad', max: 80 },
  { key: 'phone', label: 'Telefon', max: 24 },
  { key: 'city', label: 'Şehir', max: 80 },
  { key: 'address_line', label: 'Adres', max: 300 },
]

const EMPTY_FORM = {
  title: 'Ev',
  first_name: '',
  last_name: '',
  phone: '',
  city: '',
  address_line: '',
}

export default function AddressesPage() {
  const { user } = useAuth()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    if (!user) return
    const supabase = createClient()
    const { data } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
    setAddresses((data as Address[]) || [])
  }, [user])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load()
  }, [load])

  async function add() {
    if (!user) return
    const supabase = createClient()
    const { error } = await supabase.from('addresses').insert({
      user_id: user.id,
      ...form,
      is_default: addresses.length === 0,
    })
    if (error) {
      toast.error(
        error.message.includes('address limit')
          ? 'En fazla 10 adres kaydedebilirsiniz'
          : 'Adres kaydedilemedi. Alanları kontrol edin.'
      )
    } else {
      toast.success('Adres eklendi')
      setForm(EMPTY_FORM)
      void load()
    }
  }

  async function remove(id: string) {
    const supabase = createClient()
    const { error } = await supabase.from('addresses').delete().eq('id', id)
    if (error) toast.error('Adres silinemedi')
    else void load()
  }

  return (
    <div>
      <h2 className="font-display text-3xl text-espresso">Adresler</h2>
      <ul className="mt-6 space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="flex items-start justify-between gap-4 border border-border p-4 text-sm">
            <div>
              <p className="font-medium">
                {a.title} — {a.first_name} {a.last_name}
                {a.is_default ? ' (varsayılan)' : ''}
              </p>
              <p className="text-muted">
                {a.address_line}, {a.city} · {a.phone}
              </p>
            </div>
            <Button type="button" variant="secondary" onClick={() => remove(a.id)}>
              Sil
            </Button>
          </li>
        ))}
      </ul>

      <div className="mt-10 max-w-md space-y-3">
        <h3 className="font-display text-xl">Yeni adres</h3>
        {FIELDS.map((f) => (
          <div key={f.key}>
            <Label>{f.label}</Label>
            <Input
              value={form[f.key]}
              maxLength={f.max}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <Button type="button" onClick={add}>
          Kaydet
        </Button>
      </div>
    </div>
  )
}
