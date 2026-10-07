import type { CollectionConfig } from 'payload'

function altFromFilename(filename: unknown) {
  if (typeof filename !== 'string' || !filename) return null
  const base = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim()
  return base || null
}

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: 'Görsel',
    plural: 'Görseller',
  },
  access: {
    read: () => true,
  },
  admin: {
    group: 'İçerik',
  },
  upload: {
    staticDir: 'media',
    // Explicit list: `image/*` would also allow SVG (script-capable) uploads.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'],
    imageSizes: [
      { name: 'thumbnail', width: 300, height: 300, position: 'centre' },
      { name: 'card', width: 800, height: 1000, position: 'centre' },
      { name: 'hero', width: 1920, height: 1080, position: 'centre' },
      { name: 'og', width: 1200, height: 630, position: 'centre' },
    ],
  },
  fields: [
    {
      // DB column is NOT NULL — always filled from the filename when left empty.
      name: 'alt',
      type: 'text',
      label: 'Alt metin',
      admin: { hidden: true },
      hooks: {
        beforeValidate: [
          ({ value, data, originalDoc, req }) => {
            if (typeof value === 'string' && value.trim()) return value
            return (
              altFromFilename(data?.filename) ||
              altFromFilename(originalDoc?.filename) ||
              altFromFilename(req.file?.name) ||
              'Görsel'
            )
          },
        ],
      },
    },
  ],
}
