import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { getPayloadClient } from '@/lib/payload'
import type { Page } from '@/payload-types'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  try {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pages',
      where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
      limit: 1,
    })
    const page = result.docs[0] as Page | undefined
    if (!page) return { title: FALLBACK[slug]?.title || 'Sayfa' }
    return {
      title: page.seo?.title || page.title,
      description: page.seo?.description || undefined,
    }
  } catch {
    return { title: FALLBACK[slug]?.title || 'Sayfa' }
  }
}

const PENDING = 'Bu sayfanın içeriği hazırlanıyor ve en kısa sürede yayınlanacak.'

const FALLBACK: Record<string, { title: string; body: string }> = {
  hakkimizda: {
    title: 'Hakkımızda',
    body: 'Seçkin Çanta, 1967’den bu yana gerçek deri ve zamansız tasarım anlayışıyla çanta ve cüzdan üretir.',
  },
  iletisim: { title: 'İletişim', body: PENDING },
  magazalar: { title: 'Mağazalar', body: PENDING },
  'kargo-ve-teslimat': {
    title: 'Kargo ve Teslimat',
    body: 'Siparişler 2-4 iş günü içinde kargoya verilir. 1.500 TL ve üzeri siparişlerde kargo ücretsizdir, altındaki siparişlerde kargo ücreti 150 TL’dir.',
  },
  'iade-ve-degisim': {
    title: 'İade ve Değişim',
    body: 'Teslimattan itibaren 14 gün içinde iade talebi oluşturabilirsiniz.',
  },
  sss: { title: 'Sıkça Sorulan Sorular', body: PENDING },
  kvkk: { title: 'KVKK Aydınlatma Metni', body: PENDING },
  'gizlilik-politikasi': { title: 'Gizlilik Politikası', body: PENDING },
  'cerez-politikasi': { title: 'Çerez Politikası', body: PENDING },
  'kullanim-kosullari': { title: 'Kullanım Koşulları', body: PENDING },
  'mesafeli-satis-sozlesmesi': { title: 'Mesafeli Satış Sözleşmesi', body: PENDING },
  'on-bilgilendirme-formu': { title: 'Ön Bilgilendirme Formu', body: PENDING },
}

const CONTENT_CLASS =
  'mt-8 space-y-4 leading-relaxed text-muted [&_a]:text-espresso [&_a]:underline [&_h2]:mt-10 [&_h2]:font-display [&_h2]:text-2xl [&_h2]:text-espresso [&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-xl [&_h3]:text-espresso [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_strong]:text-espresso [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6'

export default async function CmsPage({ params }: Props) {
  const { slug } = await params

  let page: Page | undefined
  try {
    const payload = await getPayloadClient()
    const result = await payload.find({
      collection: 'pages',
      where: { and: [{ slug: { equals: slug } }, { _status: { equals: 'published' } }] },
      limit: 1,
    })
    page = result.docs[0] as Page | undefined
  } catch {
    // fall through to static fallbacks
  }

  const fallback = FALLBACK[slug]
  if (!page && !fallback) notFound()

  return (
    <article className="container-page max-w-3xl py-14">
      <h1 className="font-display text-4xl text-espresso">{page?.title || fallback?.title}</h1>
      {page && hasRichText(page.content) ? (
        <RichText data={page.content} className={CONTENT_CLASS} />
      ) : (
        <p className="mt-8 leading-relaxed text-muted">{fallback?.body || PENDING}</p>
      )}
    </article>
  )
}

function hasRichText(value: unknown): value is SerializedEditorState {
  const children = (value as SerializedEditorState | null)?.root?.children
  if (!Array.isArray(children)) return false
  return children.some((node) => {
    const nodeChildren = (node as { children?: unknown }).children
    return Array.isArray(nodeChildren) && nodeChildren.length > 0
  })
}
