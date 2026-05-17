-- ════════════════════════════════════════════════════════════════════════════
--  Migration 101 — Link the referral side of an intake submission to a client
-- ════════════════════════════════════════════════════════════════════════════
--
--  Background
--  ----------
--  Migration 100 promoted the Jotform "Who sent you our way?" answer into a
--  denormalized `referral_source TEXT` column so the Intake list could
--  filter on it without parsing `raw_answers` per row.
--
--  The next step (this migration) is to make that referral *itself* a first-
--  class link into the Hub. A referral is almost always a real client — the
--  prospect literally types another client's name — so resolving that
--  string to a `contacts.id` (or `organizations.id`) lets the UI:
--
--    • deep-link the Referral cell to the referrer's client profile,
--    • count "Top referrers" on the Sales overview,
--    • auto-thank the referrer when the prospect converts (future).
--
--  Schema change
--  -------------
--  Mirrors the existing prospect-side pair (`contact_id`, `organization_id`)
--  with a `referral_*` prefix. Both nullable because:
--
--    • the prospect may have skipped the referral question entirely,
--    • we may have a free-text answer that doesn't match any client yet,
--    • or the resolver may legitimately match an organization for one
--      submission and a contact for another.
--
--  RLS — `jotform_intake_submissions` is currently access-controlled at the
--  Postgres role level (admin client in the API routes), not via RLS, so no
--  policy changes are needed.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS referral_contact_id      UUID REFERENCES contacts(id)      ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Indexes power the "Top referrers" query and any per-client "intakes that
-- named us" lookups. Partial indexes keep them tiny — most submissions
-- never resolve a referral, so we don't want to bloat the btree with
-- millions of NULLs.
CREATE INDEX IF NOT EXISTS jotform_intake_submissions_referral_contact_idx
  ON jotform_intake_submissions(referral_contact_id)
  WHERE referral_contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS jotform_intake_submissions_referral_organization_idx
  ON jotform_intake_submissions(referral_organization_id)
  WHERE referral_organization_id IS NOT NULL;

COMMENT ON COLUMN jotform_intake_submissions.referral_contact_id IS
  'Resolved FK to contacts.id when referral_source matches a known contact. '
  'Auto-populated by the ingest pipeline (best-effort name match) and '
  'manually settable by triagers via the Intake detail sheet.';

COMMENT ON COLUMN jotform_intake_submissions.referral_organization_id IS
  'Resolved FK to organizations.id when referral_source matches a known '
  'organization. Same auto + manual flow as referral_contact_id; both can '
  'be NULL even when referral_source is set.';
