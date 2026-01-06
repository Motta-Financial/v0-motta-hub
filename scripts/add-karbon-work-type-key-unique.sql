-- Add unique constraint to karbon_work_type_key if not exists
-- This enables upsert functionality for work types sync

-- First, check if there are any duplicates and clean them up
DELETE FROM work_types a
USING work_types b
WHERE a.id > b.id 
  AND a.karbon_work_type_key = b.karbon_work_type_key
  AND a.karbon_work_type_key IS NOT NULL;

-- Add unique constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'work_types_karbon_work_type_key_key'
  ) THEN
    ALTER TABLE work_types 
    ADD CONSTRAINT work_types_karbon_work_type_key_key 
    UNIQUE (karbon_work_type_key);
  END IF;
END $$;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_work_types_karbon_key 
ON work_types(karbon_work_type_key);

-- Also ensure work_status has unique constraint on karbon_status_key
DELETE FROM work_status a
USING work_status b
WHERE a.id > b.id 
  AND a.karbon_status_key = b.karbon_status_key
  AND a.karbon_status_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'work_status_karbon_status_key_key'
  ) THEN
    ALTER TABLE work_status 
    ADD CONSTRAINT work_status_karbon_status_key_key 
    UNIQUE (karbon_status_key);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_status_karbon_key 
ON work_status(karbon_status_key);
