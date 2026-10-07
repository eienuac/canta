'use client'

import Link from 'next/link'

/** Payload CMS sidebar links → storefront and operations dashboard (orders, returns, etc.) */
export function AdminAppLink() {
  return (
    <div className="nav-group" style={{ marginTop: '0.75rem', padding: '0 0.5rem' }}>
      <a
        href="/"
        style={{
          display: 'block',
          padding: '0.4rem 0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--theme-elevation-800)',
          textDecoration: 'none',
        }}
      >
        ← Siteye dön
      </a>
      <Link
        href="/app-admin"
        style={{
          display: 'block',
          padding: '0.4rem 0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          color: 'var(--theme-elevation-800)',
          textDecoration: 'none',
        }}
      >
        → Operasyon / Siparişler
      </Link>
      <p
        style={{
          margin: '0.15rem 0.75rem 0',
          fontSize: '0.7rem',
          color: 'var(--theme-elevation-500)',
        }}
      >
        Sipariş, stok, kupon, iade, yorum
      </p>
    </div>
  )
}

/** Payload CMS header action — always visible, even when the sidebar is collapsed. */
export function SiteLinkAction() {
  return (
    <a
      href="/"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.3rem 0.75rem',
        fontSize: '0.8rem',
        fontWeight: 600,
        color: '#fff',
        background: '#2c5c4f',
        borderRadius: '4px',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      ← Siteye dön
    </a>
  )
}

export default AdminAppLink
