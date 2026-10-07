import type { Access, CollectionConfig, FieldAccess } from 'payload'

type RoleUser = { id?: number | string; role?: string | null } | null | undefined

const isAdmin = (user: RoleUser) => user?.role === 'admin'

const adminOnly: Access = ({ req }) => isAdmin(req.user as RoleUser)

const adminOrSelf: Access = ({ req }) => {
  const user = req.user as RoleUser
  if (!user) return false
  if (isAdmin(user)) return true
  return { id: { equals: user.id as number | string } }
}

const adminOnlyField: FieldAccess = ({ req }) => isAdmin(req.user as RoleUser)

export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: 'Yönetici',
    plural: 'Yöneticiler',
  },
  auth: true,
  admin: {
    useAsTitle: 'email',
    group: 'Sistem',
  },
  // Editors may only see/update their own account; only admins manage other accounts.
  access: {
    read: adminOrSelf,
    update: adminOrSelf,
    create: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Ad Soyad',
    },
    {
      name: 'role',
      type: 'select',
      label: 'Yetki',
      defaultValue: 'editor',
      // Prevents an editor from promoting themselves to admin.
      access: {
        create: adminOnlyField,
        update: adminOnlyField,
      },
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editör', value: 'editor' },
      ],
    },
  ],
}
