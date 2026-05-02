-- Adds a `status` column to `organizations` so we can soft-archive rows that
-- no longer appear in the Karbon source-of-truth export. Mirrors the column
-- already present on `contacts` (added in earlier migrations) so the scrub
-- script can apply the same archive pattern across both tables.
--
-- Default 'active' so existing rows are unaffected.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS organizations_status_idx
  ON public.organizations (status)
  WHERE status <> 'active';

COMMENT ON COLUMN public.organizations.status IS
  'Lifecycle status. ''active'' for live records, ''archived'' for rows soft-flagged because they were removed from Karbon.';
