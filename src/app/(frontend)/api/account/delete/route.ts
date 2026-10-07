import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`account-delete:${user.id}:${await clientIp()}`, 5, 15 * 60_000))) {
    return NextResponse.json({ error: 'Çok fazla deneme' }, { status: 429 })
  }

  // Re-authentication: a stolen/left-open session alone must not be able to delete the account.
  const providers = (user.app_metadata?.providers as string[] | undefined) ?? []
  if (providers.includes('email')) {
    const body = (await request.json().catch(() => ({}))) as { password?: string }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!body.password || !user.email || !url || !anon) {
      return NextResponse.json({ error: 'Şifre doğrulaması gerekli' }, { status: 400 })
    }
    // Stateless client so this check never touches the caller's session cookies
    const verifier = createSupabaseClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await verifier.auth.signInWithPassword({
      email: user.email,
      password: body.password,
    })
    if (error) return NextResponse.json({ error: 'Şifre hatalı' }, { status: 403 })
  }

  const admin = getSupabaseAdmin()
  // Soft-delete profile data; auth user deletion requires service role
  await admin
    .from('profiles')
    .update({ email: null, phone: null, first_name: 'Silindi', last_name: '' })
    .eq('id', user.id)
  await admin.auth.admin.deleteUser(user.id)
  await supabase.auth.signOut()

  return NextResponse.json({ ok: true })
}
