-- =============================================================================
-- Karbon Work Items: derive period_start / period_end from title
-- =============================================================================
-- WHY: Karbon's /WorkItems list endpoint does NOT return PeriodStart or
--      PeriodEnd. Without those, the bookkeeping / payroll / tax dashboards
--      that filter `WHERE period_start BETWEEN $startOfMonth AND $endOfMonth`
--      always come up empty (3,303 / 3,303 rows had NULL period_start before
--      this migration).
--
-- SOLUTION: Titles consistently encode the period as a trailing suffix:
--    "ACCT | Bookkeeping | The Dat Cave LLC | Aug 2025"   -> Aug 2025
--    "ACCT | Bookkeeping | Acme | Q3 2024"                -> Jul-Sep 2024
--    "TAX | Individual (1040) | Smith, Jane | 2024"       -> 2024 calendar yr
--
-- We expose the parser as a stable SQL function so:
--   (a) the backfill UPDATE below uses it
--   (b) a BEFORE-INSERT/UPDATE trigger keeps period_start/period_end fresh
--       on every Karbon sync without needing to touch the API route code
--   (c) ad-hoc queries (e.g. "show me last quarter's bookkeeping work") can
--       call it directly: SELECT * FROM derive_work_item_period(title, start_date)
-- =============================================================================

CREATE OR REPLACE FUNCTION derive_work_item_period(p_title TEXT, p_start_date DATE)
RETURNS TABLE(period_start DATE, period_end DATE)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- Captured groups from the title (case-insensitive)
  v_match TEXT[];
  v_month_name TEXT;
  v_quarter INT;
  v_year INT;
  v_month_num INT;
BEGIN
  IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
    RETURN QUERY SELECT NULL::DATE, NULL::DATE;
    RETURN;
  END IF;

  -- Pattern 1: "| Mon YYYY" or "| Month YYYY" suffix (most common, monthly work)
  -- e.g. "| Aug 2025", "| August 2025", "| OCT 2025", "| Sept 2025 "
  v_match := regexp_match(
    p_title,
    '\|\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{4})\s*$',
    'i'
  );
  IF v_match IS NOT NULL THEN
    v_month_name := lower(substring(v_match[1] FROM 1 FOR 3));
    v_year := v_match[2]::INT;
    v_month_num := CASE v_month_name
      WHEN 'jan' THEN 1 WHEN 'feb' THEN 2 WHEN 'mar' THEN 3
      WHEN 'apr' THEN 4 WHEN 'may' THEN 5 WHEN 'jun' THEN 6
      WHEN 'jul' THEN 7 WHEN 'aug' THEN 8 WHEN 'sep' THEN 9
      WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dec' THEN 12
    END;
    RETURN QUERY SELECT
      make_date(v_year, v_month_num, 1),
      (make_date(v_year, v_month_num, 1) + INTERVAL '1 month - 1 day')::DATE;
    RETURN;
  END IF;

  -- Pattern 2: "| QN YYYY" suffix (quarterly bookkeeping / tax estimates)
  -- e.g. "| Q1 2025", "| Q4 2024"
  v_match := regexp_match(p_title, '\|\s*Q([1-4])\s+(\d{4})\s*$', 'i');
  IF v_match IS NOT NULL THEN
    v_quarter := v_match[1]::INT;
    v_year := v_match[2]::INT;
    v_month_num := (v_quarter - 1) * 3 + 1; -- Q1->1, Q2->4, Q3->7, Q4->10
    RETURN QUERY SELECT
      make_date(v_year, v_month_num, 1),
      (make_date(v_year, v_month_num, 1) + INTERVAL '3 months - 1 day')::DATE;
    RETURN;
  END IF;

  -- Pattern 3: "| QNYY" compact form (e.g. "| Q424" = Q4 2024)
  v_match := regexp_match(p_title, '\|\s*Q([1-4])(\d{2})\s*$', 'i');
  IF v_match IS NOT NULL THEN
    v_quarter := v_match[1]::INT;
    v_year := 2000 + v_match[2]::INT;
    v_month_num := (v_quarter - 1) * 3 + 1;
    RETURN QUERY SELECT
      make_date(v_year, v_month_num, 1),
      (make_date(v_year, v_month_num, 1) + INTERVAL '3 months - 1 day')::DATE;
    RETURN;
  END IF;

  -- Pattern 4: "| YYYY" suffix (annual work — tax returns, 1099s)
  v_match := regexp_match(p_title, '\|\s*(\d{4})\s*$');
  IF v_match IS NOT NULL THEN
    v_year := v_match[1]::INT;
    -- Sanity: don't accept "year" suffixes outside a reasonable window.
    IF v_year BETWEEN 2000 AND 2100 THEN
      RETURN QUERY SELECT
        make_date(v_year, 1, 1),
        make_date(v_year, 12, 31);
      RETURN;
    END IF;
  END IF;

  -- Pattern 5: "| FYYY" fiscal-year shorthand (e.g. "| FY24" = 2024)
  v_match := regexp_match(p_title, '\|\s*FY(\d{2})\s*$', 'i');
  IF v_match IS NOT NULL THEN
    v_year := 2000 + v_match[1]::INT;
    RETURN QUERY SELECT
      make_date(v_year, 1, 1),
      make_date(v_year, 12, 31);
    RETURN;
  END IF;

  -- Fallback: if the work item has a start_date on the 1st of a month, treat
  -- that as a one-month period. This covers monthly work whose title doesn't
  -- carry a suffix but whose StartDate is aligned to the period boundary.
  IF p_start_date IS NOT NULL AND extract(day FROM p_start_date) = 1 THEN
    RETURN QUERY SELECT
      p_start_date,
      (date_trunc('month', p_start_date) + INTERVAL '1 month - 1 day')::DATE;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::DATE, NULL::DATE;
END;
$$;

COMMENT ON FUNCTION derive_work_item_period(TEXT, DATE) IS
  'Parses the trailing period suffix from a Karbon work item title (e.g. "| Aug 2025", "| Q1 2025", "| 2024", "| FY24") and returns matching period_start/period_end. Falls back to start_date when start_date is on the 1st of a month.';

-- -----------------------------------------------------------------------------
-- Trigger: keep period_start / period_end fresh on every sync upsert.
-- Only writes when the column is NULL or the title changed, so manual overrides
-- (if any) are preserved.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION work_items_derive_period_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_period RECORD;
BEGIN
  -- Skip if the title is unchanged AND a period is already populated — avoids
  -- thrashing the search_vector index for no benefit on every sync upsert.
  IF TG_OP = 'UPDATE'
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.period_start IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Always re-derive on insert, or when title changes, or when missing.
  SELECT * INTO v_period FROM derive_work_item_period(NEW.title, NEW.start_date);

  IF v_period.period_start IS NOT NULL THEN
    NEW.period_start := v_period.period_start;
    NEW.period_end := v_period.period_end;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_items_derive_period ON work_items;

CREATE TRIGGER work_items_derive_period
  BEFORE INSERT OR UPDATE OF title, start_date ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION work_items_derive_period_trigger();

-- -----------------------------------------------------------------------------
-- Backfill: populate period_start / period_end on every existing row that
-- doesn't have one. The trigger handles new rows from this point on.
-- -----------------------------------------------------------------------------
-- CTE first: invoking a TABLE-returning function inline in UPDATE...FROM
-- needs the row decomposed via (func()).*  inside a SELECT.
WITH derived AS (
  SELECT
    id,
    (derive_work_item_period(title, start_date)).*
  FROM work_items
  WHERE period_start IS NULL
)
UPDATE work_items wi
SET
  period_start = d.period_start,
  period_end = d.period_end
FROM derived d
WHERE wi.id = d.id
  AND d.period_start IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Index: speed up the period filter used by the bookkeeping / payroll / tax
-- trackers (`WHERE period_start BETWEEN $start AND $end`).
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_items_period_start
  ON work_items (period_start)
  WHERE deleted_in_karbon_at IS NULL;
