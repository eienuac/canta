import type { CollectionConfig } from 'payload'
import { syncProductInventory } from '@/services/inventory/sync'
import { productSkuField, slugField, variantSkuField } from '@/fields/auto'

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'Ürün',
    plural: 'Ürünler',
  },
  admin: {
    useAsTitle: 'name',
    group: 'Katalog',
    defaultColumns: ['name', 'sku', 'price', 'stock', '_status', 'updatedAt'],
  },
  versions: {
    drafts: {
      autosave: {
        interval: 2000,
      },
    },
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      return {
        _status: {
          equals: 'published',
        },
      }
    },
  },
  hooks: {
    afterChange: [
      async ({ doc, req }) => {
        // Sync SKU + CMS stock → Supabase inventory (cart/checkout SoT for reservations)
        try {
          await syncProductInventory(doc)
        } catch (error) {
          req.payload.logger.error({
            msg: 'Inventory sync failed',
            err: error,
          })
        }
        return doc
      },
    ],
  },
  fields: [
    slugField('name'),
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Ürün Bilgileri',
          fields: [
            {
              name: 'name',
              type: 'text',
              label: 'Ürün adı',
              required: true,
              localized: true,
            },
            {
              name: 'shortDescription',
              type: 'textarea',
              label: 'Kısa açıklama',
              localized: true,
              maxLength: 300,
              admin: {
                description: 'Ürün kartında ve sayfanın üstünde görünür.',
              },
            },
            {
              name: 'description',
              type: 'richText',
              label: 'Açıklama',
              localized: true,
            },
            {
              name: 'brand',
              type: 'text',
              label: 'Marka',
              defaultValue: 'Seçkin Çanta',
              admin: { hidden: true },
            },
          ],
        },
        {
          label: 'Fiyat ve Stok',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'price',
                  type: 'number',
                  label: 'Fiyat (₺)',
                  required: true,
                  min: 0,
                },
                {
                  name: 'compareAtPrice',
                  type: 'number',
                  label: 'İndirim öncesi fiyat (₺)',
                  min: 0,
                  admin: {
                    description: 'Doluysa sitede üstü çizili gösterilir.',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'stock',
                  type: 'number',
                  label: 'Stok adedi',
                  required: true,
                  min: 0,
                  defaultValue: 0,
                  admin: {
                    description: 'Varyant eklediyseniz her varyantın kendi stoğu geçerlidir.',
                  },
                },
                productSkuField(),
              ],
            },
            {
              name: 'isActive',
              type: 'checkbox',
              label: 'Satışta',
              defaultValue: true,
            },
            {
              name: 'isFeatured',
              type: 'checkbox',
              label: 'Öne çıkan',
              defaultValue: false,
            },
            {
              name: 'isNew',
              type: 'checkbox',
              label: 'Yeni gelen',
              defaultValue: false,
            },
            {
              name: 'isBestSeller',
              type: 'checkbox',
              label: 'Çok satan',
              defaultValue: false,
            },
          ],
        },
        {
          label: 'Kategori',
          fields: [
            {
              name: 'category',
              type: 'relationship',
              relationTo: 'categories',
              label: 'Kategori',
              required: true,
            },
            {
              name: 'subCategory',
              type: 'relationship',
              relationTo: 'categories',
              label: 'Alt kategori',
            },
            {
              name: 'gender',
              type: 'select',
              label: 'Cinsiyet',
              options: [
                { label: 'Erkek', value: 'men' },
                { label: 'Kadın', value: 'women' },
                { label: 'Unisex', value: 'unisex' },
              ],
            },
            {
              name: 'collection',
              type: 'relationship',
              relationTo: 'collections',
              label: 'Koleksiyon',
            },
          ],
        },
        {
          label: 'Fotoğraflar',
          fields: [
            {
              name: 'images',
              type: 'array',
              label: 'Ürün fotoğrafları',
              minRows: 1,
              labels: {
                singular: 'Fotoğraf',
                plural: 'Fotoğraflar',
              },
              admin: {
                description: 'Sürükleyerek sıralayın. İlk fotoğraf veya “Ana fotoğraf” işaretli olan kapakta görünür.',
              },
              fields: [
                {
                  name: 'image',
                  type: 'upload',
                  relationTo: 'media',
                  required: true,
                  label: 'Fotoğraf',
                },
                {
                  name: 'alt',
                  type: 'text',
                  label: 'Alt metin',
                  admin: { hidden: true },
                },
                {
                  name: 'isPrimary',
                  type: 'checkbox',
                  label: 'Ana fotoğraf',
                  defaultValue: false,
                },
              ],
            },
          ],
        },
        {
          label: 'Özellikler',
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'leatherType', type: 'text', label: 'Deri türü' },
                { name: 'material', type: 'text', label: 'Malzeme' },
              ],
            },
            {
              name: 'colors',
              type: 'array',
              label: 'Renkler',
              labels: { singular: 'Renk', plural: 'Renkler' },
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'name', type: 'text', label: 'Renk adı', required: true },
                    {
                      name: 'hex',
                      type: 'text',
                      label: 'Renk kodu',
                      admin: { description: 'Örn. #2c5c4f (isteğe bağlı)' },
                    },
                  ],
                },
              ],
            },
            {
              name: 'dimensions',
              type: 'group',
              label: 'Ölçüler',
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'width', type: 'text', label: 'Genişlik' },
                    { name: 'height', type: 'text', label: 'Yükseklik' },
                    { name: 'depth', type: 'text', label: 'Derinlik' },
                  ],
                },
                { name: 'notes', type: 'textarea', label: 'Ölçü notu', admin: { hidden: true } },
              ],
            },
            { name: 'weight', type: 'text', label: 'Ağırlık' },
            {
              name: 'careInstructions',
              type: 'textarea',
              label: 'Bakım bilgisi',
              localized: true,
            },
            {
              name: 'shippingInfo',
              type: 'textarea',
              label: 'Kargo bilgisi',
              localized: true,
              admin: { hidden: true },
            },
            {
              name: 'returnInfo',
              type: 'textarea',
              label: 'İade bilgisi',
              localized: true,
              admin: { hidden: true },
            },
          ],
        },
        {
          label: 'Varyantlar',
          description: 'Aynı ürünün farklı renk/boyutları varsa ekleyin. Yoksa boş bırakın.',
          fields: [
            {
              name: 'variants',
              type: 'array',
              label: 'Varyantlar',
              labels: {
                singular: 'Varyant',
                plural: 'Varyantlar',
              },
              fields: [
                {
                  type: 'row',
                  fields: [
                    { name: 'color', type: 'text', label: 'Renk' },
                    { name: 'size', type: 'text', label: 'Boyut' },
                  ],
                },
                {
                  type: 'row',
                  fields: [
                    {
                      name: 'price',
                      type: 'number',
                      label: 'Fiyat (boşsa ürün fiyatı)',
                      min: 0,
                    },
                    {
                      name: 'stock',
                      type: 'number',
                      label: 'Stok adedi',
                      required: true,
                      min: 0,
                      defaultValue: 0,
                    },
                  ],
                },
                variantSkuField(),
              ],
            },
          ],
        },
      ],
    },
    {
      name: 'seo',
      type: 'group',
      label: 'SEO',
      admin: { hidden: true },
      fields: [
        { name: 'title', type: 'text', localized: true },
        { name: 'description', type: 'textarea', localized: true },
        { name: 'canonical', type: 'text' },
        { name: 'ogImage', type: 'upload', relationTo: 'media' },
      ],
    },
  ],
}
