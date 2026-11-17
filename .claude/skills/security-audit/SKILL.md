---
name: security-audit
description: Web uygulaması güvenlik denetimi — XSS, SQL Injection, CSRF, authentication, authorization (IDOR), API route güvenliği. Kullanıcı "güvenlik denetimi", "security audit", "açık var mı" dediğinde kullan.
---

# Security Audit (salt-okunur)

Kapsam belirt (verilmediyse sor): tek route, modül veya tüm uygulama. Kod değiştirme, `.env` okuma.

## Kontrol listesi
1. **Route envanteri:** `src/app/(frontend)/api/**/route.ts` — her handler için auth, rol, input validation (zod), rate limit (`src/lib/rate-limit.ts`) var mı?
2. **Authn/Authz:** `src/lib/supabase/server.ts` ile `getUser()` kullanımı (session'a körü körüne güvenme); `src/lib/admin.ts`; `app-admin/*` ve `api/app-admin/*` rol kontrolü; IDOR (`account/orders/[id]`, `returns`, `favorites`, `cart`).
3. **Service role:** `src/lib/supabase/admin.ts` kullanımı — kullanıcı girdisiyle filtre/sahiplik kontrolü atlanıyor mu? Client bundle'a sızıyor mu?
4. **Injection:** raw SQL/`rpc`/string birleştirme; `search/route.ts` filtre girdileri; `dangerouslySetInnerHTML` (Lexical/CMS içeriği, `pages/[slug]`).
5. **CSRF/CORS:** cookie tabanlı POST/DELETE route'lar, Origin kontrolü; `auth/callback` redirect (open redirect).
6. **Webhook/cron/sync:** `cron/release-stock`, `cms/sync` secret karşılaştırması (timing-safe, zorunlu mu?).
7. **Header/CSP:** `next.config.ts`, `src/proxy.ts`.
8. **Payload:** `access` kuralları (`src/collections/*`), upload (`Media.ts`, S3), GraphQL/REST açıklığı.
9. **Sızıntı:** hata mesajları (`src/lib/errors.ts`), loglama (`scripts/safe-log.mts` benzeri), PII.

## Çıktı
Bulgu başına: **Önem** (Kritik/Yüksek/Orta/Düşük) · **Dosya:satır** · **Doğrulama durumu** (Doğrulandı / Şüpheli) · **Senaryo** · **Öneri**. Doğrulanmayanı "Şüpheli" yaz. Kısa, Türkçe.
