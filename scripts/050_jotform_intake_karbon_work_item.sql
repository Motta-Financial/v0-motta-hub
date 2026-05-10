-- Tracks the Karbon Work Item created from an intake submission.
--
-- The work-item-creation flow on the intake detail sheet (button:
-- "Create Karbon Work Item") is intentionally idempotent — once a row
-- has `karbon_work_item_key` set, the API route refuses to create a
-- second one and the UI swaps the button for a "View in Karbon" link.
-- The other three columns are display-only so we can render the
-- success state without re-fetching from Karbon every time the sheet
-- opens.
--
-- All four columns are nullable so existing rows are untouched; the
-- value is populated only when a teammate explicitly clicks the
-- button (prospect intakes that never convert won't have one).

ALTER TABLE public.jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS karbon_work_item_key        TEXT,
  ADD COLUMN IF NOT EXISTS karbon_work_item_title      TEXT,
  ADD COLUMN IF NOT EXISTS karbon_work_item_url        TEXT,
  ADD COLUMN IF NOT EXISTS karbon_work_item_created_at TIMESTAMPTZ;

-- Lookup index for the "has this submission already produced a work
-- item?" check in the API route. Not unique because some legitimate
-- support flows could re-use a key, but we still want the fast scan.
CREATE INDEX IF NOT EXISTS idx_jotform_intake_karbon_work_item_key
  ON public.jotform_intake_submissions (karbon_work_item_key)
  WHERE karbon_work_item_key IS NOT NULL;

COMMENT ON COLUMN public.jotform_intake_submissions.karbon_work_item_key IS
  'Karbon WorkItemKey returned by POST /v3/WorkItems when a teammate clicks "Create Karbon Work Item" on the intake detail sheet. Null until the action has been performed. Acts as the idempotency guard for the action.';
COMMENT ON COLUMN public.jotform_intake_submissions.karbon_work_item_title IS
  'Title posted to Karbon (e.g. "TAX | Individual (1040) | Le, Dat | 2026"). Stored for display so the sheet can show the result without re-fetching Karbon.';
COMMENT ON COLUMN public.jotform_intake_submissions.karbon_work_item_url IS
  'Deep link into the Karbon tenant for the created work item.';
COMMENT ON COLUMN public.jotform_intake_submissions.karbon_work_item_created_at IS
  'Timestamp the work item was created from Motta Hub (NOT the StartDate posted to Karbon).';
