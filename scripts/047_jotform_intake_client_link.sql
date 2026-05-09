-- ─────────────────────────────────────────────────────────────────
-- Migration 047 — Provenance for intake↔client links.
--
-- The base schema (045) already has `contact_id`, `organization_id`,
-- and `lead_id` FK columns on jotform_intake_submissions. This migration
-- only adds metadata columns so the auto-matcher and the manual-link
-- paths can coexist safely:
--
--   link_method     text     'auto_email' | 'auto_business_name'
--                            | 'manual'   | NULL (unlinked)
--   linked_at       timestamptz   when the link was last set
--
-- Why this matters: the auto-matcher runs on every webhook delivery
-- and on demand via the backfill script. Without provenance there's
-- no safe way to know whether an existing link came from a fuzzy
-- email match (re-runnable, low confidence) or a human pinning the
-- record (must not be overwritten). With this column the matcher's
-- update predicate becomes a one-liner: only touch rows where
-- link_method IS NULL OR link_method LIKE 'auto_%'.
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS link_method text,
  ADD COLUMN IF NOT EXISTS linked_at   timestamptz;

-- Constrain values so a typo in application code can't smuggle in
-- a value the matcher won't recognize. NULL is allowed for unlinked
-- rows.
ALTER TABLE public.jotform_intake_submissions
  DROP CONSTRAINT IF EXISTS jotform_intake_submissions_link_method_check;

ALTER TABLE public.jotform_intake_submissions
  ADD CONSTRAINT jotform_intake_submissions_link_method_check
  CHECK (link_method IS NULL OR link_method IN (
    'auto_email',
    'auto_business_name',
    'auto_name',
    'manual'
  ));

-- Index that supports the most common profile-side query:
--   "all intake submissions for this contact, newest first"
-- We already index contact_id + organization_id from migration 045;
-- this index just adds the descending-date secondary key so the
-- profile API doesn't have to sort in memory.
CREATE INDEX IF NOT EXISTS jotform_intake_submissions_contact_recent_idx
  ON public.jotform_intake_submissions (contact_id, jotform_created_at DESC NULLS LAST)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jotform_intake_submissions_org_recent_idx
  ON public.jotform_intake_submissions (organization_id, jotform_created_at DESC NULLS LAST)
  WHERE organization_id IS NOT NULL;
