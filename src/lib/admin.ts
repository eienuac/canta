import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

function parseAdminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function requireAppAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const adminEmails = parseAdminEmails()
  const email = user.email?.toLowerCase() || ''

  // Fast path: ADMIN_EMAILS — does not require service role key
  if (email && adminEmails.includes(email)) {
    return { user, profile: null }
  }

  // Fallback: profiles.role = admin
  try {
    const admin = getSupabaseAdmin()
    const { data: profile } = await admin
      .from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.role === 'admin') {
      return { user, profile }
    }
  } catch (error) {
    console.error('[requireAppAdmin] profile lookup failed:', error)
  }

  return null
}
