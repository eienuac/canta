import type { CollectionConfig } from 'payload'
import { slugField } from '@/fields/auto'

export const Collections: CollectionConfig = {
  slug: 'collections',
  labels: {
    singular: 'Koleksiyon',
    plural: 'Koleksiyonlar',
  },
  admin: {
    useAsTitle: 'name',
    group: 'Katalog',
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      label: 'Koleksiyon adı',
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
      name: 'isFeatured',
      type: 'checkbox',
      label: 'Öne çıkan',
      defaultValue: false,
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      admin: { hidden: true },
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'description', type: 'textarea', localized: true },
      ],
    },
  ],
}
