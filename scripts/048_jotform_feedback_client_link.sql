-- 048_jotform_feedback_client_link.sql
--
-- Adds link-provenance columns to jotform_feedback_submissions so
-- the auto-matcher can run against feedback the same way it runs
-- against intake. Migration 046 already created contact_id /
-- organization_id FK columns; this adds the audit metadata that
-- distinguishes a heuristic match from a manual pin.
--
-- The CHECK and partial indexes mirror the intake table's migration
-- 047 so any tooling that operates over both tables can use the
-- same column names + index shapes.

ALTER TABLE public.jotform_feedback_submissions
  ADD COLUMN IF NOT EXISTS link_method text,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

-- Provenance values:
--   auto_email          - matched on submitter_email = contact/org email
--   auto_name           - matched on full name (no business name on feedback)
--   manual              - pinned by a human via /sales/feedback admin queue
--   NULL                - unlinked
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'jotform_feedback_submissions'
      AND constraint_name = 'jotform_feedback_submissions_link_method_check'
  ) THEN
    ALTER TABLE public.jotform_feedback_submissions
      ADD CONSTRAINT jotform_feedback_submissions_link_method_check
      CHECK (link_method IS NULL OR link_method IN ('auto_email', 'auto_name', 'manual'));
  END IF;
END$$;

-- Partial indexes for the "recent feedback for this client" query
-- pattern used on the client profile.
CREATE INDEX IF NOT EXISTS jotform_feedback_submissions_contact_id_idx
  ON public.jotform_feedback_submissions (contact_id, jotform_created_at DESC)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jotform_feedback_submissions_organization_id_idx
  ON public.jotform_feedback_submissions (organization_id, jotform_created_at DESC)
  WHERE organization_id IS NOT NULL;

-- Index on link_method so the admin queue's "show unlinked" filter
-- stays fast even at 10k+ feedback rows.
CREATE INDEX IF NOT EXISTS jotform_feedback_submissions_link_method_idx
  ON public.jotform_feedback_submissions (link_method);
