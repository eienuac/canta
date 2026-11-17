-- Payment security audit — quick fixes found by the production checks.
-- Safe to re-run (idempotent).

-- 1) Variant SKUs must be unique. The Payload field is declared `unique: true`, but this
--    project runs Payload with push:false, so the index was never created
--    (payload.products.sku already has products_sku_idx). Verified: 0 duplicates before apply.
create unique index if not exists products_variants_sku_idx
  on payload.products_variants using btree (sku);

-- 2) Data minimisation: provider responses stored in payments.raw_response must not keep
--    card metadata or the rendered checkout form. Only these top-level keys exist today.
update public.payments
set raw_response = raw_response
      - 'binNumber' - 'lastFourDigits' - 'cardAssociation' - 'cardFamily' - 'cardType'
      - 'cardUserKey' - 'cardToken' - 'checkoutFormContent',
    updated_at = now()
where raw_response ?| array[
  'binNumber', 'lastFourDigits', 'cardAssociation', 'cardFamily', 'cardType',
  'cardUserKey', 'cardToken', 'checkoutFormContent'
];
