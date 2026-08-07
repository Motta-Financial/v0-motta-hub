-- 389 — Intake field parity with the legacy Jotform form
--
-- Prerequisite for retiring Jotform form 242306172162144. An audit of all
-- 220 real submissions found fields the Jotform collected that the Hub's
-- native wizard did not — and three of them are consent answers with
-- real, honored variance:
--
--   typeA   "Terms and Conditions"                     220/220 Accepted
--   canWe49 "Can we store your data?"                  175 accept / 45 DON'T
--   canWe   "Can we contact you about our products?"   183 accept / 37 DON'T
--
-- Those 45 and 37 are people who said no. Retiring the form without
-- carrying the questions over would silently drop a documented consent
-- record and start treating every new prospect as opted in. That is the
-- one genuinely blocking gap; the rest below are informational fields
-- the parser already knew about but no form asked for.
--
-- Stored as text rather than boolean on purpose: the Jotform answers are
-- "I accept" / "I don't accept" / "Accepted", and 230 historical rows use
-- that vocabulary. Coercing to boolean would either lose the distinction
-- between "declined" and "never asked" (both false) or require a
-- three-state nullable boolean, which reads worse than the words.

ALTER TABLE public.jotform_intake_submissions
  -- Consent / legal
  ADD COLUMN IF NOT EXISTS terms_accepted text,
  ADD COLUMN IF NOT EXISTS consent_store_data text,
  ADD COLUMN IF NOT EXISTS consent_marketing_contact text,
  -- Informational fields the parser mapped but no form collected
  ADD COLUMN IF NOT EXISTS business_street_address text;

COMMENT ON COLUMN public.jotform_intake_submissions.terms_accepted IS
  'Terms & Conditions acceptance. Jotform field `typeA` ("Accepted"); the Hub wizard writes "Accepted".';
COMMENT ON COLUMN public.jotform_intake_submissions.consent_store_data IS
  'Consent to store the prospect''s data. Jotform field `canWe49` ("I accept" / "I don''t accept").';
COMMENT ON COLUMN public.jotform_intake_submissions.consent_marketing_contact IS
  'Consent to marketing contact. Jotform field `canWe` ("I accept" / "I don''t accept"). 37 of 220 historical submitters declined.';

-- Backfill the three consent columns from the raw Jotform payloads so the
-- historical record is queryable rather than buried in `raw_answers`.
-- Without this, "who opted out of marketing?" stays a JSON scan and the
-- new columns look like they start from zero.
UPDATE public.jotform_intake_submissions s
SET
  terms_accepted = COALESCE(s.terms_accepted, x.terms),
  consent_store_data = COALESCE(s.consent_store_data, x.store),
  consent_marketing_contact = COALESCE(s.consent_marketing_contact, x.marketing)
FROM (
  SELECT
    i.id,
    MAX(CASE WHEN a.value->>'name' = 'typeA'   THEN NULLIF(a.value->>'answer','') END) AS terms,
    MAX(CASE WHEN a.value->>'name' = 'canWe49' THEN NULLIF(a.value->>'answer','') END) AS store,
    MAX(CASE WHEN a.value->>'name' = 'canWe'   THEN NULLIF(a.value->>'answer','') END) AS marketing
  FROM public.jotform_intake_submissions i
  CROSS JOIN LATERAL jsonb_each(COALESCE(i.raw_answers, '{}'::jsonb)) AS a(qid, value)
  WHERE jsonb_typeof(i.raw_answers) = 'object'
  GROUP BY i.id
) x
WHERE s.id = x.id
  AND (x.terms IS NOT NULL OR x.store IS NOT NULL OR x.marketing IS NOT NULL);

-- Marketing-consent lookups are the ones that will actually be run
-- ("who can we email?"), so index the declines — the smaller side.
CREATE INDEX IF NOT EXISTS idx_intake_marketing_declined
  ON public.jotform_intake_submissions (jotform_created_at DESC)
  WHERE consent_marketing_contact IS NOT NULL
    AND consent_marketing_contact NOT ILIKE 'I accept%';
