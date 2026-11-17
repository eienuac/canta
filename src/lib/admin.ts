import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * A user may only ever be an app admin when their e-mail address is verified and the
 * account is not banned. Applied to every admin check (and to role grants), so no path
 * can make an unverified account an admin.
 */
export function isEligibleAdminUser(user: { email_confirmed_at?: string | null }): boolean {
  if (!user.email_confirmed_at) return false
  const bannedUntil = (user as { banned_until?: string | null }).banned_until
  if (bannedUntil && new Date(bannedUntil).getTime() > Date.now()) return false
  return true
}

/**
 * App admin = server-verified user (getUser) + eligible account + profiles.role = 'admin'.
 * Roles can only be changed server-side (profiles_prevent_role_change trigger).
 */
export async function requireAppAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || !isEligibleAdminUser(user)) return null

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
    console.error('[requireAppAdmin] profile lookup failed:', error instanceof Error ? error.message : 'unknown')
  }

  return null
}
