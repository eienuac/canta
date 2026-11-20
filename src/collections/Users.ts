import type { CollectionConfig } from 'payload'
import { adminOnly, adminOnlyField, adminOrSelf, isStaffUser } from './access'

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
  // Accounts without a role cannot open the admin panel at all.
  access: {
    admin: ({ req }) => isStaffUser(req),
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
