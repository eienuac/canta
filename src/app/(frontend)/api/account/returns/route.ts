import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createReturnRequest } from '@/services/returns'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { z } from 'zod'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = getSupabaseAdmin()
  const { data } = await admin
    .from('return_requests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ returns: data || [] })
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    if (!(await rateLimit(`returns:${user.id}`, 5, 60_000))) {
      return NextResponse.json({ error: 'Çok fazla istek' }, { status: 429 })
    }

    const body = await request.json()
    const result = await createReturnRequest({ ...body, userId: user.id })
    return NextResponse.json({ return: result })
  } catch (e) {
    const message =
      e instanceof z.ZodError
        ? e.issues[0]?.message || 'Geçersiz istek'
        : e instanceof Error
          ? e.message
          : 'Failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
