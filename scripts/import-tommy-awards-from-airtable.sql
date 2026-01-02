-- =====================================================
-- TOMMY AWARDS DATA IMPORT SCRIPT
-- =====================================================
-- This script is a template for importing Tommy Award data
-- from Airtable. You'll need to populate the VALUES with
-- your actual Airtable data.
--
-- Instructions:
-- 1. Export your Airtable data to CSV
-- 2. Transform the data to match the format below
-- 3. Run this script to import the data
-- =====================================================

-- Step 1: Create weeks for all unique dates
-- Replace with your actual dates from Airtable
INSERT INTO tommy_award_weeks (week_date, week_name, is_active)
VALUES
  -- Example format - replace with your actual dates
  ('2024-01-05', 'Week of January 5, 2024', false),
  ('2024-01-12', 'Week of January 12, 2024', false),
  ('2024-01-19', 'Week of January 19, 2024', false),
  ('2024-01-26', 'Week of January 26, 2024', false)
  -- Add more weeks as needed from your Airtable data
ON CONFLICT (week_date) DO NOTHING;

-- Step 2: Import ballots
-- Match team member names to IDs where possible
-- The trigger will automatically calculate points

-- Example ballot import format:
/*
INSERT INTO tommy_award_ballots (
  week_id,
  week_date,
  voter_name,
  first_place_name,
  first_place_notes,
  second_place_name,
  second_place_notes,
  third_place_name,
  third_place_notes,
  honorable_mention_name,
  honorable_mention_notes
)
SELECT
  w.id,
  '2024-01-05'::date,
  'John Smith',           -- VOTER from Airtable
  'Jane Doe',             -- FIRST from Airtable
  'Great work on...',     -- FIRST (Notes) from Airtable
  'Bob Johnson',          -- SECOND from Airtable
  'Helped with...',       -- SECOND (Notes) from Airtable
  'Alice Williams',       -- THIRD from Airtable
  'Always reliable...',   -- THIRD (Notes) from Airtable
  'Tom Brown',            -- HONORABLE MENTION from Airtable
  'Shout out for...'      -- HONORABLE MENTION (Notes) from Airtable
FROM tommy_award_weeks w
WHERE w.week_date = '2024-01-05';
*/

-- Step 3: Update yearly totals after import
-- This aggregates all points for each team member by year

DO $$
DECLARE
  member_record RECORD;
  year_val INTEGER;
BEGIN
  -- Get current year
  year_val := EXTRACT(YEAR FROM CURRENT_DATE);
  
  -- For each team member who received votes
  FOR member_record IN 
    SELECT DISTINCT team_member_name 
    FROM tommy_award_points 
    WHERE EXTRACT(YEAR FROM week_date) = year_val
  LOOP
    INSERT INTO tommy_award_yearly_totals (
      team_member_name,
      year,
      total_first_place_votes,
      total_second_place_votes,
      total_third_place_votes,
      total_honorable_mention_votes,
      total_partner_votes,
      total_points,
      weeks_participated
    )
    SELECT 
      member_record.team_member_name,
      year_val,
      COALESCE(SUM(first_place_votes), 0),
      COALESCE(SUM(second_place_votes), 0),
      COALESCE(SUM(third_place_votes), 0),
      COALESCE(SUM(honorable_mention_votes), 0),
      COALESCE(SUM(partner_votes), 0),
      COALESCE(SUM(total_points), 0),
      COUNT(DISTINCT week_id)
    FROM tommy_award_points
    WHERE team_member_name = member_record.team_member_name
      AND EXTRACT(YEAR FROM week_date) = year_val
    GROUP BY team_member_name
    ON CONFLICT (team_member_id, year) 
    DO UPDATE SET
      total_first_place_votes = EXCLUDED.total_first_place_votes,
      total_second_place_votes = EXCLUDED.total_second_place_votes,
      total_third_place_votes = EXCLUDED.total_third_place_votes,
      total_honorable_mention_votes = EXCLUDED.total_honorable_mention_votes,
      total_partner_votes = EXCLUDED.total_partner_votes,
      total_points = EXCLUDED.total_points,
      weeks_participated = EXCLUDED.weeks_participated,
      updated_at = NOW();
  END LOOP;
  
  -- Update rankings
  UPDATE tommy_award_yearly_totals t
  SET current_rank = ranked.rank
  FROM (
    SELECT id, ROW_NUMBER() OVER (ORDER BY total_points DESC) as rank
    FROM tommy_award_yearly_totals
    WHERE year = year_val
  ) ranked
  WHERE t.id = ranked.id;
END $$;

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check imported weeks
-- SELECT * FROM tommy_award_weeks ORDER BY week_date;

-- Check ballot count per week
-- SELECT w.week_date, w.week_name, COUNT(b.id) as ballot_count
-- FROM tommy_award_weeks w
-- LEFT JOIN tommy_award_ballots b ON w.id = b.week_id
-- GROUP BY w.id
-- ORDER BY w.week_date;

-- Check points calculation
-- SELECT * FROM tommy_award_points ORDER BY week_date, total_points DESC;

-- Check yearly totals
-- SELECT * FROM tommy_award_yearly_totals ORDER BY total_points DESC;
