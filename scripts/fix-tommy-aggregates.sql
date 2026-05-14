-- ─────────────────────────────────────────────────────────────────────────────
-- fix-tommy-aggregates.sql
--
-- Purpose:
--   • Replace the INSERT-only trigger on `tommy_award_ballots` with one that
--     also handles UPDATE and DELETE, so the aggregates stay correct when a
--     teammate amends or retracts a ballot.
--   • Backfill `tommy_award_points` and `tommy_award_yearly_totals` from the
--     existing `tommy_award_ballots` rows. Today the 2025 ballots (270 rows)
--     never made it into the aggregates because the trigger didn't exist at
--     import time. This script repopulates them.
--
-- Design notes:
--   • `tommy_award_points.total_points` is a GENERATED column, so we don't
--     write to it directly — Postgres recomputes it from the vote counts.
--   • Both aggregate tables have a UNIQUE constraint, so we can use
--     INSERT ... ON CONFLICT DO UPDATE. Re-running this script is safe.
--   • The trigger calls a single "recompute (member, week)" function. That's
--     more expensive than the old incremental approach, but it's correct for
--     all three event types (INSERT/UPDATE/DELETE) without branching on
--     OLD/NEW. With ~10-20 ballots per week and ~20 team members, this is a
--     handful of small queries — well under a millisecond.
--   • Yearly totals are recomputed at the end of every recompute call, then
--     ranks are recalculated for that year. This keeps the leaderboard
--     accurate without a separate cron job.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Drop the existing INSERT-only trigger + function so we can redefine them.
DROP TRIGGER IF EXISTS trigger_calculate_tommy_points ON public.tommy_award_ballots;
DROP TRIGGER IF EXISTS trigger_tommy_ballot_insert    ON public.tommy_award_ballots;
DROP TRIGGER IF EXISTS trigger_tommy_ballot_update    ON public.tommy_award_ballots;
DROP TRIGGER IF EXISTS trigger_tommy_ballot_delete    ON public.tommy_award_ballots;
DROP FUNCTION IF EXISTS public.calculate_tommy_award_points();
DROP FUNCTION IF EXISTS public.recompute_tommy_points_for_member_week(uuid, uuid);
DROP FUNCTION IF EXISTS public.recompute_tommy_yearly_totals_for_year(int);
DROP FUNCTION IF EXISTS public.tommy_ballots_aggregate_trigger();


-- 2) Recompute `tommy_award_points` for a single (team_member_id, week_id) pair.
--    Counts every appearance of the member across all ballots for the week.
CREATE OR REPLACE FUNCTION public.recompute_tommy_points_for_member_week(
  p_member_id uuid,
  p_week_id   uuid
) RETURNS void AS $$
DECLARE
  v_week_date  date;
  v_member_name text;
  v_first  int;
  v_second int;
  v_third  int;
  v_hm     int;
  v_partner int;
BEGIN
  IF p_member_id IS NULL OR p_week_id IS NULL THEN
    RETURN;
  END IF;

  SELECT week_date INTO v_week_date FROM public.tommy_award_weeks WHERE id = p_week_id;
  IF v_week_date IS NULL THEN RETURN; END IF;

  SELECT full_name INTO v_member_name FROM public.team_members WHERE id = p_member_id;

  SELECT
    COUNT(*) FILTER (WHERE first_place_id        = p_member_id),
    COUNT(*) FILTER (WHERE second_place_id       = p_member_id),
    COUNT(*) FILTER (WHERE third_place_id        = p_member_id),
    COUNT(*) FILTER (WHERE honorable_mention_id  = p_member_id),
    COUNT(*) FILTER (WHERE partner_vote_id       = p_member_id)
  INTO v_first, v_second, v_third, v_hm, v_partner
  FROM public.tommy_award_ballots
  WHERE week_id = p_week_id;

  -- If the member has zero appearances this week, remove the row entirely so
  -- the table doesn't accumulate "all-zeros" placeholders.
  IF (v_first + v_second + v_third + v_hm + v_partner) = 0 THEN
    DELETE FROM public.tommy_award_points
     WHERE team_member_id = p_member_id AND week_id = p_week_id;
    RETURN;
  END IF;

  INSERT INTO public.tommy_award_points (
    team_member_id, team_member_name, week_id, week_date,
    first_place_votes, second_place_votes, third_place_votes,
    honorable_mention_votes, partner_votes
  )
  VALUES (
    p_member_id, COALESCE(v_member_name, 'Unknown'), p_week_id, v_week_date,
    v_first, v_second, v_third, v_hm, v_partner
  )
  ON CONFLICT (team_member_id, week_id) DO UPDATE
  SET
    team_member_name        = EXCLUDED.team_member_name,
    week_date               = EXCLUDED.week_date,
    first_place_votes       = EXCLUDED.first_place_votes,
    second_place_votes      = EXCLUDED.second_place_votes,
    third_place_votes       = EXCLUDED.third_place_votes,
    honorable_mention_votes = EXCLUDED.honorable_mention_votes,
    partner_votes           = EXCLUDED.partner_votes,
    updated_at              = now();
END;
$$ LANGUAGE plpgsql;


-- 3) Recompute `tommy_award_yearly_totals` (and ranks) for a given year.
--    Pulls from `tommy_award_points` which is now the source of truth.
CREATE OR REPLACE FUNCTION public.recompute_tommy_yearly_totals_for_year(
  p_year int
) RETURNS void AS $$
BEGIN
  -- Upsert one row per member who scored in the year.
  INSERT INTO public.tommy_award_yearly_totals (
    team_member_id, team_member_name, year,
    total_first_place_votes, total_second_place_votes, total_third_place_votes,
    total_honorable_mention_votes, total_partner_votes,
    total_points, weeks_participated, current_rank
  )
  SELECT
    p.team_member_id,
    COALESCE(MAX(p.team_member_name), 'Unknown'),
    p_year,
    SUM(p.first_place_votes)::int,
    SUM(p.second_place_votes)::int,
    SUM(p.third_place_votes)::int,
    SUM(p.honorable_mention_votes)::int,
    SUM(p.partner_votes)::int,
    SUM(p.total_points),
    COUNT(*)::int,
    NULL  -- rank is filled in below
  FROM public.tommy_award_points p
  WHERE EXTRACT(YEAR FROM p.week_date)::int = p_year
    AND p.team_member_id IS NOT NULL
  GROUP BY p.team_member_id
  ON CONFLICT (team_member_id, year) DO UPDATE
  SET
    team_member_name              = EXCLUDED.team_member_name,
    total_first_place_votes       = EXCLUDED.total_first_place_votes,
    total_second_place_votes      = EXCLUDED.total_second_place_votes,
    total_third_place_votes       = EXCLUDED.total_third_place_votes,
    total_honorable_mention_votes = EXCLUDED.total_honorable_mention_votes,
    total_partner_votes           = EXCLUDED.total_partner_votes,
    total_points                  = EXCLUDED.total_points,
    weeks_participated            = EXCLUDED.weeks_participated,
    updated_at                    = now();

  -- Zero-out any rows that no longer have backing points data (e.g. all
  -- the year's ballots were deleted). We keep the row so the rank column
  -- doesn't break FKs elsewhere, but mark it inactive.
  UPDATE public.tommy_award_yearly_totals y
     SET total_first_place_votes = 0, total_second_place_votes = 0,
         total_third_place_votes = 0, total_honorable_mention_votes = 0,
         total_partner_votes = 0, total_points = 0, weeks_participated = 0,
         current_rank = NULL, updated_at = now()
   WHERE y.year = p_year
     AND NOT EXISTS (
       SELECT 1 FROM public.tommy_award_points p
       WHERE p.team_member_id = y.team_member_id
         AND EXTRACT(YEAR FROM p.week_date)::int = p_year
     );

  -- Recompute current_rank for the year. DENSE_RANK so ties share a rank
  -- and we don't skip numbers — feels more intuitive on a small team.
  WITH ranked AS (
    SELECT team_member_id,
           DENSE_RANK() OVER (ORDER BY total_points DESC) AS rk
    FROM public.tommy_award_yearly_totals
    WHERE year = p_year AND total_points > 0
  )
  UPDATE public.tommy_award_yearly_totals y
     SET current_rank = r.rk, updated_at = now()
    FROM ranked r
   WHERE y.year = p_year AND y.team_member_id = r.team_member_id;
END;
$$ LANGUAGE plpgsql;


-- 4) Trigger function: recomputes the affected members + the year's rollup.
--    Handles INSERT (NEW), UPDATE (OLD and NEW — they may differ), DELETE (OLD).
CREATE OR REPLACE FUNCTION public.tommy_ballots_aggregate_trigger()
RETURNS trigger AS $$
DECLARE
  v_year int;
  v_member uuid;
BEGIN
  -- Collect every member affected by this ballot change. Using a temp set
  -- via UNION lets us dedupe before iterating.
  FOR v_member IN
    SELECT DISTINCT m FROM (
      VALUES
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.first_place_id        END),
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.second_place_id       END),
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.third_place_id        END),
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.honorable_mention_id  END),
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.partner_vote_id       END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.first_place_id        END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.second_place_id       END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.third_place_id        END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.honorable_mention_id  END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.partner_vote_id       END)
    ) AS t(m)
    WHERE m IS NOT NULL
  LOOP
    PERFORM public.recompute_tommy_points_for_member_week(
      v_member,
      COALESCE(
        CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN NEW.week_id END,
        CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.week_id END
      )
    );

    -- If the ballot moved between weeks (rare, but possible on UPDATE),
    -- the OLD week_id needs recompute too.
    IF TG_OP = 'UPDATE' AND OLD.week_id IS DISTINCT FROM NEW.week_id THEN
      PERFORM public.recompute_tommy_points_for_member_week(v_member, OLD.week_id);
    END IF;
  END LOOP;

  -- Recompute the year rollup for every year touched by this ballot change.
  -- Usually just one year, but a cross-year update could touch two.
  FOR v_year IN
    SELECT DISTINCT y FROM (
      VALUES
        (CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN EXTRACT(YEAR FROM NEW.week_date)::int END),
        (CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN EXTRACT(YEAR FROM OLD.week_date)::int END)
    ) AS t(y)
    WHERE y IS NOT NULL
  LOOP
    PERFORM public.recompute_tommy_yearly_totals_for_year(v_year);
  END LOOP;

  RETURN NULL; -- AFTER trigger, return value is ignored
END;
$$ LANGUAGE plpgsql;


-- 5) Attach the trigger.
CREATE TRIGGER trigger_tommy_ballot_changes
AFTER INSERT OR UPDATE OR DELETE ON public.tommy_award_ballots
FOR EACH ROW EXECUTE FUNCTION public.tommy_ballots_aggregate_trigger();


-- 6) BACKFILL ────────────────────────────────────────────────────────────────
--    Recompute every (member, week) pair that has any ballot reference,
--    then recompute yearly totals for every distinct year.

DO $$
DECLARE
  r record;
BEGIN
  -- All (member, week) combos referenced anywhere in the ballots table.
  FOR r IN
    SELECT DISTINCT member_id AS team_member_id, week_id
    FROM public.tommy_award_ballots,
         LATERAL (VALUES
           (first_place_id),
           (second_place_id),
           (third_place_id),
           (honorable_mention_id),
           (partner_vote_id)
         ) AS t(member_id)
    WHERE member_id IS NOT NULL AND week_id IS NOT NULL
  LOOP
    PERFORM public.recompute_tommy_points_for_member_week(r.team_member_id, r.week_id);
  END LOOP;

  FOR r IN
    SELECT DISTINCT EXTRACT(YEAR FROM week_date)::int AS yr
    FROM public.tommy_award_ballots
    WHERE week_date IS NOT NULL
  LOOP
    PERFORM public.recompute_tommy_yearly_totals_for_year(r.yr);
  END LOOP;
END $$;

COMMIT;

-- 7) Verification queries (read-only; safe outside transaction).
SELECT 'tommy_award_points by year' AS report,
       EXTRACT(YEAR FROM week_date)::int AS year,
       COUNT(*) AS rows,
       COUNT(DISTINCT team_member_id) AS members
FROM public.tommy_award_points
GROUP BY 2 ORDER BY 2;

SELECT 'tommy_award_yearly_totals by year' AS report,
       year, COUNT(*) AS members, SUM(total_points)::numeric(12,1) AS total_points
FROM public.tommy_award_yearly_totals
GROUP BY year ORDER BY year;
