-- ─────────────────────────────────────────────────────────────────
-- 211_karbon_proconnect_suggester.sql
--
-- ProConnect's API does NOT include preparer name/email for the 13
-- staff profile GUIDs that show up on every engagement. The Hub has
-- to derive who's behind each GUID from co-occurrence: when both
-- ProConnect AND Karbon agree they did a return for the same client
-- in the same tax year, the Karbon assignee is the strongest signal
-- we have for who that ProConnect profile_id maps to.
--
-- This RPC returns, per ProConnect profile_id, every Karbon
-- assignee_full_name that overlaps it on a (client, tax_year) tuple,
-- along with the match count and the profile's total
-- co-occurrence rows. The `lib/tax/proconnect-karbon-suggester.ts`
-- module turns those rows into UI candidates with a confidence score.
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.proconnect_profile_karbon_candidates()
RETURNS TABLE (
  assignee_profile_id text,
  karbon_assignee_name text,
  match_count bigint,
  profile_total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH pc AS (
    SELECT
      e.assignee_profile_id,
      e.tax_year,
      lower(c.display_name) AS pc_client
    FROM public.proconnect_engagements e
    JOIN public.proconnect_clients   c
      ON c.proconnect_client_id = e.proconnect_client_id
    WHERE e.assignee_profile_id IS NOT NULL
      AND c.display_name IS NOT NULL
  ),
  matches AS (
    SELECT
      pc.assignee_profile_id,
      w.assignee_full_name,
      count(*) AS match_ct
    FROM pc
    JOIN public.work_items_enriched w
      ON (
        -- Match year if both sides have it; otherwise allow null
        -- to avoid losing the join when Karbon's tax_year is unset.
        (w.tax_year = pc.tax_year)
        OR w.tax_year IS NULL
        OR pc.tax_year IS NULL
      )
     AND lower(coalesce(w.client_name, w.contact_full_name, w.org_name))
         = pc.pc_client
    WHERE w.assignee_full_name IS NOT NULL
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT
      m.*,
      sum(m.match_ct) OVER (PARTITION BY m.assignee_profile_id) AS profile_total,
      rank() OVER (
        PARTITION BY m.assignee_profile_id
        ORDER BY m.match_ct DESC
      ) AS rk
    FROM matches m
  )
  SELECT
    assignee_profile_id::text,
    assignee_full_name::text   AS karbon_assignee_name,
    match_ct::bigint           AS match_count,
    profile_total::bigint      AS profile_total
  FROM ranked
  -- Take the top 3 candidates per profile so the operator sees more
  -- than one option when results are close (e.g., a profile with a
  -- 50/50 split between two preparers across years).
  WHERE rk <= 3
  ORDER BY assignee_profile_id, rk;
$$;

-- Allow the Supabase service role + authenticated users to call this.
REVOKE ALL ON FUNCTION public.proconnect_profile_karbon_candidates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.proconnect_profile_karbon_candidates()
  TO service_role, authenticated;

COMMENT ON FUNCTION public.proconnect_profile_karbon_candidates() IS
  'Returns top-3 Karbon teammate co-occurrence candidates per ProConnect '
  'profile_id, used by /api/tax/proconnect-profiles to seed UI suggestions '
  'when ProConnect itself does not ship preparer names.';
