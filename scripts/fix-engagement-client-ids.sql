-- Migration: Fix proconnect_engagements.proconnect_client_id
-- 
-- The sync was storing the wrong client ID. It used the clientId we QUERIED
-- instead of the engagement's actual clientId from the API response.
-- The correct value is preserved in raw_json->>'clientId'.
--
-- Run this ONCE to fix existing data, then run a fresh full sync.

-- 1. Update proconnect_client_id from raw_json where available
UPDATE proconnect_engagements 
SET proconnect_client_id = (raw_json->>'clientId')
WHERE raw_json->>'clientId' IS NOT NULL
  AND proconnect_client_id != (raw_json->>'clientId');

-- 2. Drop the broken composite unique constraint if it exists
-- (The sync code was using onConflict: "proconnect_client_id,tax_year,return_type"
-- but return_type is often NULL, causing overwrites)
DO $$ 
BEGIN
  -- Check if the constraint exists before trying to drop
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'proconnect_engagements_proconnect_client_id_tax_year_return_key'
  ) THEN
    ALTER TABLE proconnect_engagements 
    DROP CONSTRAINT proconnect_engagements_proconnect_client_id_tax_year_return_key;
  END IF;
END $$;

-- 3. Ensure engagement_id has a unique constraint (should already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'proconnect_engagements_engagement_id_key'
  ) THEN
    ALTER TABLE proconnect_engagements 
    ADD CONSTRAINT proconnect_engagements_engagement_id_key UNIQUE (engagement_id);
  END IF;
END $$;

-- 4. Verify the fix
SELECT 
  'Before: ' || COUNT(DISTINCT proconnect_client_id) || ' unique client IDs' as status
FROM proconnect_engagements;

-- After running, the count should be closer to 180 (your actual client count)
-- instead of 29 (the broken state)
