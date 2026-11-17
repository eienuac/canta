import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  profile: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.profile }) }) }),
    }),
  }),
}))

import { isEligibleAdminUser, requireAppAdmin } from '@/lib/admin'

const confirmed = '2026-01-01T00:00:00Z'
const future = () => new Date(Date.now() + 86_400_000).toISOString()

describe('requireAppAdmin', () => {
  beforeEach(() => {
    state.user = null
    state.profile = null
    delete process.env.ADMIN_EMAILS
  })

  it('denies anonymous requests', async () => {
    expect(await requireAppAdmin()).toBeNull()
  })

  it('denies customers', async () => {
    state.user = { id: 'u1', email: 'c@test.local', email_confirmed_at: confirmed }
    state.profile = { role: 'customer' }
    expect(await requireAppAdmin()).toBeNull()
  })

  it('ignores ADMIN_EMAILS (env-based admin access was removed)', async () => {
    process.env.ADMIN_EMAILS = 'attacker@test.local'
    state.user = { id: 'u2', email: 'attacker@test.local', email_confirmed_at: confirmed }
    state.profile = { role: 'customer' }
    expect(await requireAppAdmin()).toBeNull()
  })

  it('allows a verified profiles.role = admin account', async () => {
    state.user = { id: 'u3', email: 'owner@test.local', email_confirmed_at: confirmed }
    state.profile = { role: 'admin' }
    expect(await requireAppAdmin()).not.toBeNull()
  })

  it('denies an admin whose e-mail is not verified', async () => {
    state.user = { id: 'u3', email: 'owner@test.local', email_confirmed_at: null }
    state.profile = { role: 'admin' }
    expect(await requireAppAdmin()).toBeNull()
  })

  it('denies a banned admin', async () => {
    state.user = { id: 'u3', email: 'owner@test.local', email_confirmed_at: confirmed, banned_until: future() }
    state.profile = { role: 'admin' }
    expect(await requireAppAdmin()).toBeNull()
  })
})

describe('isEligibleAdminUser', () => {
  it('accepts an expired ban', () => {
    expect(
      isEligibleAdminUser({ email_confirmed_at: confirmed, banned_until: '2000-01-01T00:00:00Z' } as never)
    ).toBe(true)
  })
})
