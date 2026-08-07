-- 390 — Retire the legacy Jotform intake form (242306172162144)
--
-- Gated on `scripts/test-intake-parity.mjs`, which proves the Hub's
-- native wizard reaches every column the Jotform populated — including
-- the three consent answers (migration 389) that carried real variance:
-- 47 of 230 declined data storage, 38 declined marketing contact.
--
-- ── Retire ≠ reject ─────────────────────────────────────────────────
-- `retired_at` stops the form being *offered*; it deliberately does NOT
-- stop the webhook ingesting. The Jotform URL may still be live in an
-- email signature, a QR code, an old brochure or a search result, and a
-- prospect who fills it in is a real prospect. Silently 401ing them
-- would be a worse failure than the duplication we're removing.
--
-- So: submissions still land, still resolve a contact, still email the
-- team — and now also log loudly and surface a "still receiving traffic"
-- warning on /intake, so the team can chase down whatever is still
-- pointing at it.
--
-- The FEEDBACK form (240915444941155) is untouched. It is a different
-- form with a different pipeline and is not being retired.
--
-- Remaining manual step, outside the Hub: unpublish or redirect the form
-- in the Jotform account itself. Nothing here can do that.

ALTER TABLE public.jotform_forms
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_reason text;

COMMENT ON COLUMN public.jotform_forms.retired_at IS
  'Set when a form is superseded. Submissions are still ingested (a stale link must never drop a real prospect) but the form is flagged as retired in the UI.';

UPDATE public.jotform_forms
SET
  retired_at = now(),
  retired_reason =
    'Superseded by the Hub native intake wizard at /embed/intake. Field parity verified by scripts/test-intake-parity.mjs, including the terms / data-storage / marketing consent answers.',
  -- Stop advertising the webhook as an active integration. The receiver
  -- still accepts deliveries; this flag drives the status card.
  webhook_subscribed = false
WHERE jotform_form_id = '242306172162144'
  AND retired_at IS NULL;
