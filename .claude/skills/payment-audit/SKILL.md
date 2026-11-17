---
name: payment-audit
description: Ödeme akışı denetimi — iyzico provider, callback/webhook imza doğrulama, sipariş doğrulama, fiyat manipülasyonu, çift ödeme/idempotency, stok rezervasyonu ve iade süreci. "ödeme denetimi", "checkout güvenliği", "payment audit", "webhook", "iade" için kullan.
---

# Payment Audit (salt-okunur)

Kod değiştirme, `.env` okuma, gerçek ödeme/test çağrısı yapma.

## Okunacak dosyalar
`src/services/payment/{index,iyzico,types}.ts`, `src/services/orders/index.ts`, `src/services/coupons`, `src/services/returns`, `src/services/inventory`, `src/lib/order-token.ts`, `api/{checkout,payments/callback,payments/webhook,cron/release-stock,account/returns,app-admin/returns}`, `supabase/migrations/002, 006`, `scripts/test-iyzico-sig.mts` (yalnızca referans).

## Kontrol listesi
1. **Fiyat:** sunucu fiyatı DB/Payload'dan mı hesaplanıyor? İstemciden gelen price/total/indirim/kargo yok sayılıyor mu? Kupon sunucuda doğrulanıp tek kullanımlık "claim" ediliyor mu (006)?
2. **Sipariş sahipliği:** checkout ve sipariş okuma yetkisi; `order-token` (HMAC; callback ve `checkout/success` erişimi) imza/süre.
3. **Callback/Webhook:** imza/HMAC doğrulaması (timing-safe), provider'dan sunucu tarafı sorgu ile teyit, tutar+para birimi+orderId eşleşmesi, secret yoksa fail-closed.
4. **Idempotency/çift ödeme:** aynı callback/webhook tekrarında tek finalize; durum geçişleri atomik (DB transaction/`rpc`/koşullu update); race condition.
5. **Stok:** rezervasyon, ödeme başarısızlığında/timeout'ta serbest bırakma (cron `release-stock`), oversell.
6. **İade:** durum makinesi, yetki, iade tutarı ≤ ödenen, çift iade, provider refund çağrısı.
7. **Veri:** kart verisi saklanmıyor/loglanmıyor; hata/log'da secret yok.

## Çıktı
Bulgu: **Önem · Dosya:satır · Doğrulandı/Şüpheli · Saldırı senaryosu · Öneri**. Kısa, Türkçe.
