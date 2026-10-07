import type { CollectionConfig } from 'payload'
import { slugField } from '@/fields/auto'

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: {
    singular: 'Kategori',
    plural: 'Kategoriler',
  },
  admin: {
    useAsTitle: 'name',
    group: 'Katalog',
    defaultColumns: ['name', 'slug', 'parentCategory', 'updatedAt'],
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Kategori adı',
      required: true,
      localized: true,
    },
    slugField('name'),
    {
      name: 'description',
      type: 'textarea',
      label: 'Açıklama',
      localized: true,
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      label: 'Görsel',
    },
    {
      name: 'parentCategory',
      type: 'relationship',
      relationTo: 'categories',
      label: 'Üst kategori',
      admin: {
        position: 'sidebar',
        description: 'Alt kategori ise seçin, değilse boş bırakın.',
      },
    },
    {
      name: 'navOrder',
      type: 'number',
      label: 'Menü sırası',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'showInHeader',
      type: 'checkbox',
      label: 'Üst menüde göster',
      defaultValue: true,
      admin: {
        position: 'sidebar',
      },
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      admin: { hidden: true },
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'description', type: 'textarea', localized: true },
        { name: 'ogImage', type: 'upload', relationTo: 'media' },
      ],
    },
  ],
}
