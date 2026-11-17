import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isEligibleAdminUser, requireAppAdmin } from '@/lib/admin'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export async function PATCH(request: Request) {
  const admin = await requireAppAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = z
    .object({
      userId: z.string().uuid(),
      role: z.enum(['customer', 'admin']),
    })
    .parse(await request.json())

  // Prevent locking yourself out accidentally
  if (body.userId === admin.user.id && body.role !== 'admin') {
    return NextResponse.json(
      { error: 'Kendi admin rolünüzü kaldıramazsınız' },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  if (body.role === 'admin') {
    const { data: target, error: targetError } = await supabase.auth.admin.getUserById(body.userId)
    if (targetError || !target?.user) {
      return NextResponse.json({ error: 'Kullanıcı bulunamadı' }, { status: 404 })
    }
    if (!isEligibleAdminUser(target.user)) {
      return NextResponse.json(
        { error: 'E-posta adresi doğrulanmamış veya hesabı askıya alınmış kullanıcı admin yapılamaz' },
        { status: 400 }
      )
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ role: body.role, updated_at: new Date().toISOString() })
    .eq('id', body.userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
