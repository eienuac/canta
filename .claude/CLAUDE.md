# Seçkin Çanta — Çalışma Talimatları

## Stack (gerçek dosyalardan)
- Next.js 16 (App Router) + React 19 + TypeScript, Tailwind 4, `src/proxy.ts` (middleware yerine)
- Payload CMS 3.90 (`src/payload.config.ts`, `src/collections`, `src/globals`) — katalog/içerik, `@payloadcms/db-postgres`, `storage-s3`
- Supabase (Postgres + Auth, `@supabase/ssr`) — kullanıcı, sepet, sipariş, stok, kupon, iade, yorum. Migration: `supabase/migrations/001–006`
- Ödeme: iyzico (`src/services/payment/*`), `api/payments/{callback,webhook}`
- Katman: `src/app/(frontend)/api/*` route'lar → `src/services/*` → `src/lib/supabase/*`
- Doğrulama: zod. Rate limit: `src/lib/rate-limit.ts`. Admin yetkisi: `src/lib/admin.ts`

## Kurallar
- Mevcut mimariyi koru (route → service → lib).
- Gereksiz dosya oluşturma.
- Görevle ilgisi olmayan dosyaları okuma; aynı dosyaları tekrar inceleme.
- Kod değiştirmeden önce ilgili yapıyı analiz et.
- Önemli değişikliklerden önce plan sun.
- Kullanıcı onayı olmadan veritabanı silme/değiştirme (migration, `scripts/apply-*`, SQL) yapma.
- `.env*` dosyalarını okuma, gizli bilgileri gösterme (`.env.example` yalnızca anahtar adları için).
- Güvenlik açıklarını doğrulamadan kesin bulgu olarak sunma; kanıt (dosya:satır) ve exploit senaryosu ver.
- Next.js API'leri bildiğinden farklı olabilir; kod yazmadan önce `node_modules/next/dist/docs/` oku (AGENTS.md).
- Yanıtlar kısa, anlaşılır, Türkçe; teknik terimler İngilizce kalır.

## Skills (`/security-audit`, `/payment-audit`, `/supabase-audit`, `/code-review`)
Denetim skill'leri varsayılan olarak salt-okunurdur; kaynak kodu değiştirmez.
