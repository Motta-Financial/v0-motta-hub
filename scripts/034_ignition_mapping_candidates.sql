-- =====================================================================
-- Ignition mapping engine: candidate suggestions + manual override RPC
-- =====================================================================
-- The base auto-matcher (match_ignition_client_to_supabase) returns the
-- single best candidate. The admin UI needs richer behavior:
--   1. Show the TOP N candidates ranked by confidence so a user can pick.
--   2. Apply a manual override (mark a client as belonging to a specific
--      contact OR organization), recording who/why for audit.
--   3. Surface a queue of unmatched clients ordered by review priority.
--
-- All idempotent. Safe to re-run.
-- =====================================================================

-- 1. Top-N candidate suggester ----------------------------------------
-- CASCADE because unmatched_ignition_clients view (defined below) references
-- this function via LATERAL — re-running this migration recreates both.
DROP FUNCTION IF EXISTS suggest_ignition_client_candidates(TEXT, INT) CASCADE;

CREATE OR REPLACE FUNCTION suggest_ignition_client_candidates(
  p_ignition_client_id TEXT,
  p_limit              INT DEFAULT 5
)
RETURNS TABLE (
  match_kind     TEXT,           -- 'contact' | 'organization'
  matched_id     UUID,
  matched_name   TEXT,
  matched_email  TEXT,
  confidence     NUMERIC,
  method         TEXT            -- 'email_exact' | 'name_fuzzy' | 'business_fuzzy'
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  ic RECORD;
BEGIN
  SELECT * INTO ic FROM ignition_clients WHERE ignition_client_id = p_ignition_client_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Collect all plausible candidates into a temp result, then rank globally.
  -- Internal CTE columns are prefixed with `_` so they don't collide with
  -- the outer RETURNS TABLE column names (PL/pgSQL would otherwise error
  -- with "column reference is ambiguous" inside DISTINCT ON / ORDER BY).
  RETURN QUERY
  WITH candidates AS (
    -- Email-exact matches against contacts
    SELECT 'contact'::TEXT     AS _match_kind,
           c.id                AS _matched_id,
           c.full_name         AS _matched_name,
           c.primary_email     AS _matched_email,
           1.0::NUMERIC        AS _confidence,
           'email_exact'::TEXT AS _method
    FROM contacts c
    WHERE ic.email IS NOT NULL
      AND (LOWER(c.primary_email) = LOWER(ic.email)
        OR LOWER(c.secondary_email) = LOWER(ic.email))

    UNION ALL

    SELECT 'organization'::TEXT, o.id, o.name, o.primary_email,
           1.0::NUMERIC, 'email_exact'::TEXT
    FROM organizations o
    WHERE ic.email IS NOT NULL
      AND LOWER(o.primary_email) = LOWER(ic.email)

    UNION ALL

    -- Business-name fuzzy: threshold 0.45 intentionally lower than the
    -- auto-matcher's 0.6 because this is a *suggestion* shown to a human.
    SELECT 'organization'::TEXT, o.id, o.name, o.primary_email,
           similarity(o.name, COALESCE(ic.business_name, ic.name))::NUMERIC,
           'business_fuzzy'::TEXT
    FROM organizations o
    WHERE COALESCE(ic.business_name, ic.name) IS NOT NULL
      AND similarity(o.name, COALESCE(ic.business_name, ic.name)) >= 0.45

    UNION ALL

    SELECT 'contact'::TEXT, c.id, c.full_name, c.primary_email,
           similarity(c.full_name, ic.name)::NUMERIC,
           'name_fuzzy'::TEXT
    FROM contacts c
    WHERE ic.name IS NOT NULL
      AND similarity(c.full_name, ic.name) >= 0.5
  ),
  -- De-dupe: same target can match by both email and name. Keep the
  -- highest-confidence row per (kind, id).
  ranked AS (
    SELECT DISTINCT ON (_match_kind, _matched_id)
      _match_kind, _matched_id, _matched_name, _matched_email, _confidence, _method
    FROM candidates
    ORDER BY _match_kind, _matched_id, _confidence DESC
  )
  SELECT _match_kind, _matched_id, _matched_name, _matched_email, _confidence, _method
  FROM ranked
  ORDER BY _confidence DESC, _matched_name ASC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION suggest_ignition_client_candidates IS
  'Returns the top N contact/organization candidates for an Ignition client, ranked by confidence. Used by the admin mapping UI.';

-- 2. Manual override RPC ----------------------------------------------
DROP FUNCTION IF EXISTS apply_ignition_client_match(TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION apply_ignition_client_match(
  p_ignition_client_id TEXT,
  p_match_kind         TEXT,        -- 'contact' | 'organization' | 'no_match'
  p_matched_id         UUID,        -- NULL when match_kind = 'no_match'
  p_notes              TEXT DEFAULT NULL
)
RETURNS TABLE (
  ignition_client_id  TEXT,
  match_status        TEXT,
  contact_id          UUID,
  organization_id     UUID
)
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_match_kind NOT IN ('contact', 'organization', 'no_match') THEN
    RAISE EXCEPTION 'invalid match_kind: %, expected contact|organization|no_match', p_match_kind;
  END IF;

  IF p_match_kind IN ('contact', 'organization') AND p_matched_id IS NULL THEN
    RAISE EXCEPTION 'matched_id required when match_kind = %', p_match_kind;
  END IF;

  -- Validate the FK target exists so we never write a dangling reference.
  IF p_match_kind = 'contact'
     AND NOT EXISTS (SELECT 1 FROM contacts WHERE id = p_matched_id) THEN
    RAISE EXCEPTION 'contact % does not exist', p_matched_id;
  END IF;
  IF p_match_kind = 'organization'
     AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_matched_id) THEN
    RAISE EXCEPTION 'organization % does not exist', p_matched_id;
  END IF;

  UPDATE ignition_clients
  SET
    contact_id       = CASE WHEN p_match_kind = 'contact'      THEN p_matched_id ELSE NULL END,
    organization_id  = CASE WHEN p_match_kind = 'organization' THEN p_matched_id ELSE NULL END,
    match_status     = CASE WHEN p_match_kind = 'no_match'     THEN 'no_match' ELSE 'manual_matched' END,
    match_method     = 'manual',
    match_confidence = CASE WHEN p_match_kind = 'no_match' THEN NULL ELSE 1.0 END,
    match_notes      = p_notes,
    updated_at       = NOW()
  WHERE ignition_clients.ignition_client_id = p_ignition_client_id;

  -- Cascade the match into proposals/invoices/payments so downstream
  -- queries don't have to keep joining through ignition_clients.
  UPDATE ignition_proposals p
  SET contact_id      = ic.contact_id,
      organization_id = ic.organization_id,
      updated_at      = NOW()
  FROM ignition_clients ic
  WHERE ic.ignition_client_id = p.ignition_client_id
    AND ic.ignition_client_id = p_ignition_client_id;

  UPDATE ignition_invoices i
  SET contact_id      = ic.contact_id,
      organization_id = ic.organization_id,
      updated_at      = NOW()
  FROM ignition_clients ic
  WHERE ic.ignition_client_id = i.ignition_client_id
    AND ic.ignition_client_id = p_ignition_client_id;

  UPDATE ignition_payments pm
  SET contact_id      = ic.contact_id,
      organization_id = ic.organization_id,
      updated_at      = NOW()
  FROM ignition_clients ic
  WHERE ic.ignition_client_id = pm.ignition_client_id
    AND ic.ignition_client_id = p_ignition_client_id;

  RETURN QUERY
  SELECT ic.ignition_client_id, ic.match_status, ic.contact_id, ic.organization_id
  FROM ignition_clients ic
  WHERE ic.ignition_client_id = p_ignition_client_id;
END;
$$;

COMMENT ON FUNCTION apply_ignition_client_match IS
  'Manually link an Ignition client to a Motta contact or organization (or mark no_match). Cascades the FK to proposals, invoices, and payments.';

-- 3. Unmatched-clients review queue view ------------------------------
-- Each row is an Ignition client that needs human attention, paired with
-- its best candidate match (if any) so the UI can render an approve/reject
-- workflow without a per-row RPC fan-out.
CREATE OR REPLACE VIEW unmatched_ignition_clients AS
SELECT
  ic.ignition_client_id,
  ic.name,
  ic.business_name,
  ic.email,
  ic.phone,
  ic.client_type,
  ic.match_status,
  ic.match_confidence,
  ic.match_method,
  ic.match_notes,
  ic.last_event_at,
  ic.created_at,
  -- Inline the top candidate via LATERAL so we get one row per client.
  top.match_kind     AS top_match_kind,
  top.matched_id     AS top_match_id,
  top.matched_name   AS top_match_name,
  top.matched_email  AS top_match_email,
  top.confidence     AS top_match_confidence,
  top.method         AS top_match_method,
  -- Counts so the UI can prioritize: a client with $50k of accepted
  -- proposals matters more than one with a single draft.
  COALESCE((SELECT COUNT(*) FROM ignition_proposals p WHERE p.ignition_client_id = ic.ignition_client_id), 0) AS proposal_count,
  COALESCE((SELECT SUM(amount) FROM ignition_proposals p WHERE p.ignition_client_id = ic.ignition_client_id), 0) AS total_proposal_value
FROM ignition_clients ic
LEFT JOIN LATERAL (
  SELECT match_kind, matched_id, matched_name, matched_email, confidence, method
  FROM suggest_ignition_client_candidates(ic.ignition_client_id, 1)
) top ON TRUE
WHERE ic.match_status IN ('unmatched', 'manual_review')
  AND ic.archived_at IS NULL;

COMMENT ON VIEW unmatched_ignition_clients IS
  'Review queue: every Ignition client awaiting a contact/org link, with its best candidate inlined. Order by total_proposal_value DESC for highest-impact-first triage.';
