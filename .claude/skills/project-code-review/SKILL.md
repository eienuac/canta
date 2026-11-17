---
name: project-code-review
description: Proje kodu incelemesi — hatalar, kod kalitesi, performans, mimari tutarlılık, TypeScript tipleri ve olası regresyonlar. "kodu incele", "review", "PR kontrol", "regresyon" için kullan (yerleşik /code-review'dan ayrı, proje mimarisine özel). Güvenlik/ödeme/Supabase için özel skill'leri kullan.
---

# Code Review (salt-okunur)

Önce kapsamı belirle: `git diff` / branch / belirtilen dosyalar. Kapsam dışı dosyaları okuma. Kod değiştirme (düzeltme istenirse önce plan sun).

## Kontrol listesi
1. **Mimari:** route → `src/services/*` → `src/lib/*` katmanı korunmuş mu? İş mantığı route/component içine sızmış mı? Payload (içerik) vs Supabase (operasyon) sorumluluk ayrımı.
2. **Doğruluk:** null/undefined, async hata yakalama, race condition, durum geçişleri, edge case; zod şemaları ile gerçek tipler uyumlu mu.
3. **Next 16/React 19:** server vs client component sınırı (`'use client'`), caching/revalidate, `src/proxy.ts` kullanımı. Emin değilsen `node_modules/next/dist/docs/` oku.
4. **Tipler:** `any`, `as` zorlamaları; `src/types/database.ts` (elle yazılmış, migration ile senkron mu?) ve `src/payload-types.ts` (`npm run generate:types` ile üretilir, elle düzenlenmez) uyumu.
5. **Performans:** N+1 sorgu, gereksiz client JS, görsel optimizasyonu (`next/image`), gereksiz re-render, büyük bundle.
6. **Regresyon:** değişen fonksiyonun çağıranları (`grep`), migration ↔ kod uyumu, `scripts/` bağımlılıkları.
7. **Tutarlılık:** mevcut isimlendirme, `src/lib/errors.ts` hata kalıbı, UI için `src/components/ui/*`, Türkçe etiketler (`labels.ts`).
8. **Doğrulama:** `npm run lint`, `npx tsc --noEmit` yalnızca kullanıcı isterse.

## Çıktı
Önem sırasıyla: **Dosya:satır · Sorun · Neden · Öneri**. Doğrulanmamış varsayımı belirt. Kısa, Türkçe.
