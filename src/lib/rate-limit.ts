import { randomInt } from 'node:crypto'
import { headers } from 'next/headers'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Rate limiter shared by every serverless instance (state lives in Supabase `rate_limits`).
 * Falls back to a per-instance in-memory bucket if the database is unreachable, so an outage
 * never blocks customers but also never leaves the endpoint completely unprotected.
 */
const memory = new Map<string, { count: number; resetAt: number }>()

function memoryLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (entry.count >= limit) return false
  entry.count += 1
  return true
}

export async function rateLimit(key: string, limit = 20, windowMs = 60_000): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase.rpc('rate_limit_hit', {
      p_key: key,
      p_limit: limit,
      p_window_seconds: Math.max(1, Math.ceil(windowMs / 1000)),
    })
    if (error) throw error

    // Opportunistic cleanup of stale buckets (≈1% of calls).
    if (randomInt(100) === 0) {
      void supabase
        .from('rate_limits')
        .delete()
        .lt('reset_at', new Date(Date.now() - 86_400_000).toISOString())
        .then(() => null)
    }
    return Boolean(data)
  } catch (err) {
    console.error('[rateLimit] db unavailable, using memory fallback:', err instanceof Error ? err.message : err)
    return memoryLimit(key, limit, windowMs)
  }
}

/** Best-effort client IP. Vercel overwrites x-forwarded-for, so the first hop is trustworthy there. */
export async function clientIp(): Promise<string> {
  const h = await headers()
  return (
    h.get('x-real-ip')?.trim() ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  )
}
