import type { CollectionConfig } from 'payload'
import { slugField } from '@/fields/auto'
import { publishedOrStaff, staffWrite } from './access'

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: 'Sayfa',
    plural: 'Sayfalar',
  },
  admin: {
    useAsTitle: 'title',
    group: 'İçerik',
  },
  versions: {
    drafts: true,
  },
  access: {
    read: publishedOrStaff,
    ...staffWrite,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      label: 'Başlık',
      required: true,
      localized: true,
    },
    slugField('title'),
    {
      name: 'content',
      type: 'richText',
      label: 'İçerik',
      localized: true,
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
