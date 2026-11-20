/**
 * Payload CMS access rules: a CMS account without a role keeps its login but may not open
 * the admin panel or change any content; editors manage content but not other accounts.
 */
import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { Users } from '@/collections/Users'
import { Products } from '@/collections/Products'
import { Pages } from '@/collections/Pages'
import { Media } from '@/collections/Media'
import { Categories } from '@/collections/Categories'
import { Collections } from '@/collections/Collections'
import { Homepage } from '@/globals/Homepage'
import { SiteSettings } from '@/globals/SiteSettings'

type Fn = (args: { req: PayloadRequest }) => unknown
const req = (user: Record<string, unknown> | null) => ({ user }) as unknown as PayloadRequest
const call = (fn: unknown, user: Record<string, unknown> | null) => (fn as Fn)({ req: req(user) })

const admin = { id: 1, role: 'admin' }
const editor = { id: 2, role: 'editor' }
const noRole = { id: 3, role: null }

const contentCollections = [Products, Pages, Media, Categories, Collections]

describe('CMS access', () => {
  it('only admins and editors may open the admin panel', () => {
    expect(call(Users.access!.admin, admin)).toBe(true)
    expect(call(Users.access!.admin, editor)).toBe(true)
    expect(call(Users.access!.admin, noRole)).toBe(false)
    expect(call(Users.access!.admin, null)).toBe(false)
  })

  it.each(contentCollections.map((c) => [c.slug, c] as const))(
    '%s: a role-less account cannot create, update or delete',
    (_slug, collection) => {
      for (const op of ['create', 'update', 'delete'] as const) {
        expect(call(collection.access![op], noRole)).toBe(false)
        expect(call(collection.access![op], null)).toBe(false)
        expect(call(collection.access![op], editor)).toBe(true)
        expect(call(collection.access![op], admin)).toBe(true)
      }
    }
  )

  it.each([Homepage, SiteSettings].map((g) => [g.slug, g] as const))(
    '%s global: only staff may update',
    (_slug, global) => {
      expect(call(global.access!.update, noRole)).toBe(false)
      expect(call(global.access!.update, null)).toBe(false)
      expect(call(global.access!.update, editor)).toBe(true)
    }
  )

  it('drafts are visible to staff only', () => {
    const published = { _status: { equals: 'published' } }
    for (const c of [Products, Pages]) {
      expect(call(c.access!.read, editor)).toBe(true)
      expect(call(c.access!.read, noRole)).toEqual(published)
      expect(call(c.access!.read, null)).toEqual(published)
    }
  })

  it('accounts: admins manage all, editors only themselves, role-less nobody', () => {
    expect(call(Users.access!.update, admin)).toBe(true)
    expect(call(Users.access!.update, editor)).toEqual({ id: { equals: 2 } })
    expect(call(Users.access!.update, noRole)).toBe(false)
    expect(call(Users.access!.create, editor)).toBe(false)
    expect(call(Users.access!.delete, editor)).toBe(false)
  })
})
