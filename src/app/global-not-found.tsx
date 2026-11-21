// 404 for URLs that match no route at all. The app has two root layouts (store and CMS), so
// this page renders on its own: it brings its own styles and fonts.
import './globals.css'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Cormorant_Garamond, Manrope } from 'next/font/google'

const display = Cormorant_Garamond({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-display',
})

const body = Manrope({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'Sayfa bulunamadı | Seçkin Çanta',
  robots: { index: false },
}

export default function GlobalNotFound() {
  return (
    <html lang="tr" className={`${display.variable} ${body.variable}`}>
      <body className="bg-cream antialiased">
        <main className="container-page flex min-h-[80vh] flex-col items-center justify-center text-center">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted">404</p>
          <h1 className="mt-3 font-display text-5xl text-espresso">Sayfa bulunamadı</h1>
          <p className="mt-4 max-w-md text-muted">
            Aradığınız sayfa taşınmış ya da hiç var olmamış olabilir.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center bg-espresso px-6 text-sm text-ivory transition hover:bg-brown-deep"
            >
              Ana sayfaya dön
            </Link>
            <Link
              href="/products"
              className="inline-flex h-11 items-center border border-border px-6 text-sm text-espresso transition hover:bg-ivory"
            >
              Koleksiyonu keşfet
            </Link>
          </div>
        </main>
      </body>
    </html>
  )
}
