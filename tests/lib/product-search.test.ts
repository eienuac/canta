/** Product search matches Turkish words typed without Turkish characters ("canta" → "çanta"). */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payload', () => import('../helpers/mocks/payload'))

import { textSearch } from '@/services/products'

const slugTerm = (q: string) => textSearch(q).find((c) => 'slug' in c)?.slug

describe('product text search', () => {
  it.each([
    ['canta', 'canta'],
    ['çanta', 'canta'],
    ['Sırt Çantası', 'sirt-cantasi'],
    ['sirt', 'sirt'],
    ['cüzdan', 'cuzdan'],
  ])('%s also matches slugs containing "%s"', (q, expected) => {
    expect(slugTerm(q)).toEqual({ contains: expected })
  })

  it('still searches name, description and SKU with the raw query', () => {
    expect(textSearch('çanta').slice(0, 3)).toEqual([
      { name: { contains: 'çanta' } },
      { shortDescription: { contains: 'çanta' } },
      { sku: { contains: 'çanta' } },
    ])
  })

  it('skips the slug condition when nothing searchable is left', () => {
    expect(slugTerm('!!')).toBeUndefined()
  })
})
