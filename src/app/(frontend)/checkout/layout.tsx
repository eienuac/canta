import type { Metadata } from 'next'

// The page is a client component, so its tab title is set here.
// A string title here would drop the site-wide "| Seçkin Çanta" suffix for the nested
// success/failure pages, so the template is restated.
export const metadata: Metadata = {
  title: { default: 'Ödeme', template: '%s | Seçkin Çanta' },
  robots: { index: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children
}
