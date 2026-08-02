-- 351: One-scan facet aggregation for /api/tax/returns + missing indexes.
--
-- The returns endpoint previously issued ~19 count queries per request
-- (7 per-form counts, up to 10 per-year counts, a 10k-row tax_year scan)
-- and computed the status strip by fetching every matching enriched row
-- and tallying in JS — silently wrong past PostgREST's 1,000-row cap.
-- This RPC returns all facets in one round trip with correct counts.
--
-- Filter semantics preserved from the route:
--   total/efiled/by_status : filtered by BOTH form types and tax year
--   by_form                : filtered by tax year only
--   by_year/years          : filtered by form types only

CREATE OR REPLACE FUNCTION tax_return_facets(
  p_form_types text[] DEFAULT NULL,
  p_tax_year int DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
WITH base AS (
  SELECT
    e.form_type,
    e.tax_year,
    e.raw_json->>'customStatus' AS custom_status,
    s.name  AS status_name,
    s.color AS status_color
  FROM proconnect_engagements e
  LEFT JOIN proconnect_custom_statuses s ON s.status_id = e.user_defined_status_id
)
SELECT jsonb_build_object(
  'total', (
    SELECT count(*) FROM base
    WHERE (p_form_types IS NULL OR form_type = ANY(p_form_types))
      AND (p_tax_year IS NULL OR tax_year = p_tax_year)
  ),
  'efiled', (
    SELECT count(*) FROM base
    WHERE custom_status = 'E-Filed'
      AND (p_form_types IS NULL OR form_type = ANY(p_form_types))
      AND (p_tax_year IS NULL OR tax_year = p_tax_year)
  ),
  'by_form', (
    SELECT coalesce(jsonb_object_agg(form_type, cnt), '{}'::jsonb)
    FROM (
      SELECT form_type, count(*) AS cnt FROM base
      WHERE form_type IS NOT NULL
        AND (p_tax_year IS NULL OR tax_year = p_tax_year)
      GROUP BY form_type
    ) f
  ),
  'by_year', (
    SELECT coalesce(jsonb_object_agg(tax_year::text, cnt), '{}'::jsonb)
    FROM (
      SELECT tax_year, count(*) AS cnt FROM base
      WHERE tax_year IS NOT NULL
        AND (p_form_types IS NULL OR form_type = ANY(p_form_types))
      GROUP BY tax_year
    ) y
  ),
  'by_status', (
    SELECT coalesce(
      jsonb_agg(jsonb_build_object('name', status_name, 'color', status_color, 'count', cnt)),
      '[]'::jsonb
    )
    FROM (
      SELECT status_name, status_color, count(*) AS cnt FROM base
      WHERE (p_form_types IS NULL OR form_type = ANY(p_form_types))
        AND (p_tax_year IS NULL OR tax_year = p_tax_year)
      GROUP BY status_name, status_color
    ) s
  ),
  'years', (
    SELECT coalesce(jsonb_agg(y ORDER BY y DESC), '[]'::jsonb)
    FROM (
      SELECT DISTINCT tax_year AS y FROM base
      WHERE tax_year IS NOT NULL
        AND (p_form_types IS NULL OR form_type = ANY(p_form_types))
    ) yy
  )
);
$$;

-- Hot-path indexes the returns/overview queries were missing:
-- form_type is filtered on nearly every query; proconnect_modified_at is
-- the table sort; the customStatus expression backs the E-Filed count
-- (the existing jsonb_ops GIN cannot serve `->>` equality).
CREATE INDEX IF NOT EXISTS idx_proconnect_engagements_form_type
  ON proconnect_engagements (form_type);
CREATE INDEX IF NOT EXISTS idx_proconnect_engagements_modified_at
  ON proconnect_engagements (proconnect_modified_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_proconnect_engagements_custom_status
  ON proconnect_engagements ((raw_json->>'customStatus'));
