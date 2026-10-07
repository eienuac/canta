import type { CollectionConfig } from 'payload'

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
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editör', value: 'editor' },
      ],
    },
  ],
}
