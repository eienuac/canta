import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/account'
  if (raw.startsWith('/app-admin')) return '/account'
  return raw
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNextPath(searchParams.get('next'))
  const oauthError = searchParams.get('error_description') || searchParams.get('error')

  if (oauthError) {
    const login = new URL('/auth/login', origin)
    login.searchParams.set('error', oauthError)
    return NextResponse.redirect(login)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      const login = new URL('/auth/login', origin)
      login.searchParams.set('error', error.message)
      return NextResponse.redirect(login)
    }
  }

  return NextResponse.redirect(`${origin}${next}`)
}
