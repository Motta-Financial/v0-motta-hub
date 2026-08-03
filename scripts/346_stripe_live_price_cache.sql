-- 346_stripe_live_price_cache.sql
-- Make the Stripe Product/Price cache on service_packages mode-aware.
--
-- WHY: Stripe Products and Prices are environment-specific. A Price created
-- with a test key (price_…) does NOT exist in the live account, and vice
-- versa. The original schema (345) cached a single stripe_product_id /
-- stripe_price_id, which were populated while we built in TEST mode. If we
-- reused those ids after switching to live keys, checkout.sessions.create
-- would fail with "No such price".
--
-- FIX: keep the existing columns as the TEST cache and add parallel *_live
-- columns. lib/payments/catalog.ts selects the correct pair based on
-- STRIPE_LIVE_MODE, so flipping to live keys mints fresh live objects on first
-- use instead of reusing stale test ids. Additive + idempotent.

alter table public.service_packages
  add column if not exists stripe_product_id_live text,
  add column if not exists stripe_price_id_live text;

comment on column public.service_packages.stripe_product_id is
  'Cached Stripe Product id for the TEST account (sk_test_…).';
comment on column public.service_packages.stripe_price_id is
  'Cached Stripe Price id for the TEST account (sk_test_…).';
comment on column public.service_packages.stripe_product_id_live is
  'Cached Stripe Product id for the LIVE account (sk_live_…).';
comment on column public.service_packages.stripe_price_id_live is
  'Cached Stripe Price id for the LIVE account (sk_live_…).';
