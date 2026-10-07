import type { Field, TextField } from 'payload'
import slugify from 'slugify'

export function toSlug(input: string) {
  return slugify(input, { lower: true, strict: true, locale: 'tr', trim: true })
}

function randomCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/** URL slug, filled from `sourceField` when left empty. */
export function slugField(sourceField: string, overrides: Partial<TextField> = {}): Field {
  return {
    name: 'slug',
    type: 'text',
    label: 'URL adı',
    unique: true,
    index: true,
    admin: {
      position: 'sidebar',
      description: 'Boş bırakırsanız addan otomatik oluşturulur.',
    },
    hooks: {
      beforeValidate: [
        ({ value, data, originalDoc }) => {
          if (typeof value === 'string' && value.trim()) return toSlug(value)
          const source = data?.[sourceField] ?? originalDoc?.[sourceField]
          return typeof source === 'string' && source.trim() ? toSlug(source) : value
        },
      ],
    },
    ...overrides,
  } as Field
}

/** Product SKU, generated once when left empty. Never rewritten afterwards — inventory is keyed on it. */
export function productSkuField(): Field {
  return {
    name: 'sku',
    type: 'text',
    label: 'Stok kodu (SKU)',
    unique: true,
    index: true,
    admin: {
      description: 'Boş bırakırsanız otomatik oluşturulur. Kaydettikten sonra değiştirmeyin.',
    },
    hooks: {
      beforeValidate: [
        ({ value, originalDoc }) => {
          if (typeof value === 'string' && value.trim()) return value.trim()
          if (originalDoc?.sku) return originalDoc.sku
          return `SC-${randomCode()}`
        },
      ],
    },
  }
}

export function variantSkuField(): Field {
  return {
    name: 'sku',
    type: 'text',
    label: 'Varyant stok kodu',
    admin: {
      description: 'Boş bırakırsanız otomatik oluşturulur.',
    },
    hooks: {
      beforeValidate: [
        ({ value, data }) => {
          if (typeof value === 'string' && value.trim()) return value.trim()
          const parent = typeof data?.sku === 'string' && data.sku ? data.sku : 'SC'
          return `${parent}-${randomCode(6)}`
        },
      ],
    },
  }
}
