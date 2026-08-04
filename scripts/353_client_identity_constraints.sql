-- 353: Database-level backstops for client identity convergence.
-- Applied to live DB 2026-07-26 (migration client_identity_constraints),
-- after running hub_merge_email_duplicates('contacts', false) which merged
-- the 8 true duplicate contacts (same email + same name). The 6 remaining
-- shared-email pairs are spouses/partners — legitimate, hence the
-- composite key below rather than unique-on-email-alone.

CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_name_uniq
  ON contacts (lower(primary_email), lower(coalesce(first_name,'')), lower(coalesce(last_name,'')))
  WHERE primary_email IS NOT NULL;

-- client_mapping: each external system record belongs to at most ONE
-- internal client. (Internal-side grain intentionally not constrained
-- yet -- multiple rows per internal client are currently by design;
-- promoting client_mapping to a canonical keyed table is the next-tier
-- roadmap item.)
CREATE UNIQUE INDEX IF NOT EXISTS client_mapping_karbon_uniq
  ON client_mapping (karbon_client_id) WHERE karbon_client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_mapping_proconnect_uniq
  ON client_mapping (proconnect_client_id) WHERE proconnect_client_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS client_mapping_ignition_uniq
  ON client_mapping (ignition_client_id) WHERE ignition_client_id IS NOT NULL;
