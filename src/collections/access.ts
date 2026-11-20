import type { Access, FieldAccess, PayloadRequest } from 'payload'

/**
 * CMS roles. Only these may use the admin panel or change content; a CMS account whose role
 * is cleared ("yetkisiz") keeps its login but loses every permission.
 * Server code reads content through the Local API with overrideAccess, so the storefront is
 * not affected by these rules.
 */
export const CMS_ROLES = ['admin', 'editor'] as const

type RoleUser = { id?: number | string; role?: string | null } | null | undefined

const roleOf = (req: PayloadRequest) => (req.user as RoleUser)?.role ?? null

export const isAdminUser = (req: PayloadRequest) => roleOf(req) === 'admin'
export const isStaffUser = (req: PayloadRequest) =>
  (CMS_ROLES as readonly string[]).includes(roleOf(req) ?? '')

export const adminOnly: Access = ({ req }) => isAdminUser(req)
export const staffOnly: Access = ({ req }) => isStaffUser(req)
export const adminOnlyField: FieldAccess = ({ req }) => isAdminUser(req)
export const staffOnlyField: FieldAccess = ({ req }) => isStaffUser(req)

/** Staff see drafts; everyone else only published documents. */
export const publishedOrStaff: Access = ({ req }) =>
  isStaffUser(req) ? true : { _status: { equals: 'published' } }

/** Admins manage every CMS account; editors only their own. */
export const adminOrSelf: Access = ({ req }) => {
  if (isAdminUser(req)) return true
  if (!isStaffUser(req)) return false
  return { id: { equals: (req.user as RoleUser)!.id as number | string } }
}

/** Write access for content collections. */
export const staffWrite = { create: staffOnly, update: staffOnly, delete: staffOnly }
