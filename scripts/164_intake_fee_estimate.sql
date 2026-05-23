-- Adds the `fee_estimate` column to `jotform_intake_submissions` so
-- ALFRED's fee-estimate pass (lib/jotform/fee-estimate.ts) can persist
-- a structured estimate alongside `enrichment` and `question_research`.
--
-- Shape of the JSONB blob (kept loose so iterations don't need a
-- migration):
--   {
--     "low": 1500,
--     "high": 3500,
--     "currency": "USD",
--     "annual_recurring": { "low": 12000, "high": 24000 },
--     "rationale": "<one-paragraph explanation, partner-facing>",
--     "line_items": [
--       { "label": "1040 prep", "low": 750, "high": 1500, "cadence": "annual" }
--     ],
--     "confidence": "low" | "medium" | "high",
--     "model": "anthropic/claude-sonnet-4.6",
--     "generated_at": "2026-..."
--   }
--
-- We also stamp the column comment so the next person browsing the
-- table in psql / Supabase Studio knows what's in it.

ALTER TABLE public.jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS fee_estimate jsonb;

COMMENT ON COLUMN public.jotform_intake_submissions.fee_estimate IS
  'ALFRED-generated structured fee estimate. See lib/jotform/fee-estimate.ts for shape.';
