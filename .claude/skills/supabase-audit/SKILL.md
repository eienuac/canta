---
name: supabase-audit
description: Supabase denetimi — RLS, policies, Auth, Storage, tablo/fonksiyon izinleri (GRANT), SECURITY DEFINER fonksiyonlar ve veri güvenliği. "RLS kontrol", "supabase güvenliği", "policy audit", "RLS", "GRANT" için kullan.
---

# Supabase Audit (salt-okunur)

Canlı veritabanına bağlanma, migration/script çalıştırma, `.env` okuma yok. Kaynak: repo içi SQL ve client kullanımı.

## Okunacak dosyalar
`supabase/migrations/001–006`, `src/types/database.ts`, `src/lib/supabase/{admin,client,server,middleware}.ts`, `src/proxy.ts`, `src/services/*`, `scripts/apply-*.mts` yalnızca okunur, çalıştırılmaz. `scripts/` içinde migration dışı şema değişiklikleri olabilir — **en son durumu** çıkar.

## Kontrol listesi
1. Her `public` tablo için: RLS enable mı? Policy var mı? `USING`/`WITH CHECK` sahiplik (`auth.uid()`) içeriyor mu? `anon`/`authenticated` GRANT'leri gereğinden geniş mi?
2. Kullanıcı kendi `profiles.role`/stok/fiyat/sipariş durumunu güncelleyebiliyor mu (privilege escalation)?
3. `SECURITY DEFINER` fonksiyonlar: `search_path` sabit mi, EXECUTE yetkisi kısıtlı mı, yetki kontrolü içeride var mı, `rpc` ile dışarıdan çağrılabilir mi?
4. Service role: `src/lib/supabase/admin.ts` yalnızca server'da mı; çağıran route yetkiyi önce doğruluyor mu?
5. Auth: `getUser()` vs `getSession()`, cookie/proxy yenileme, `auth/callback` redirect, e-posta doğrulama, `ADMIN_EMAILS` ve `profiles.role` mantığı, hesap silme (`account/delete`).
6. Storage: `storage.buckets` ayarları (003), policy'ler; medya Payload S3 (`storage-s3`) üzerinden — ayrı not et.
7. View/trigger, PII (adres, telefon, e-posta) erişimi, anon key ile okunabilirlik, Payload ile aynı DB'yi paylaşıyorsa Payload tablolarının RLS durumu.

## Çıktı
Tablo başına özet (RLS / policy / GRANT) + bulgular: **Önem · Dosya:satır · Doğrulandı/Şüpheli · Senaryo · Önerilen SQL (uygulama, sadece öner)**. Kısa, Türkçe.
