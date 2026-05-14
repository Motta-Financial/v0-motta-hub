-- Migration: Add hero_profile_slug to team_members table
-- This links team members to their Motta Alliance hero profiles
-- Run this in Supabase SQL Editor

-- Step 1: Add the hero_profile_slug column
ALTER TABLE public.team_members
ADD COLUMN IF NOT EXISTS hero_profile_slug TEXT;

-- Step 2: Add a comment explaining the column
COMMENT ON COLUMN public.team_members.hero_profile_slug IS 
'Slug linking to a hero profile in HERO_PROFILES array (lib/motta-alliance/hero-profiles.ts). NULL means no hero profile assigned.';

-- Step 3: Create the initial mapping based on known team member names
-- These match the slugs defined in hero-profiles.ts

-- Dat Le → The Captain
UPDATE public.team_members 
SET hero_profile_slug = 'dat-le' 
WHERE LOWER(full_name) = 'dat le';

-- Mark Dwyer → The Stabilizer
UPDATE public.team_members 
SET hero_profile_slug = 'mark-dwyer' 
WHERE LOWER(full_name) = 'mark dwyer';

-- Caleb Long → The Financial Optimizer
UPDATE public.team_members 
SET hero_profile_slug = 'caleb-long' 
WHERE LOWER(full_name) = 'caleb long';

-- Amy Sparaco → The Ledger Oracle
UPDATE public.team_members 
SET hero_profile_slug = 'amy-sparaco' 
WHERE LOWER(full_name) = 'amy sparaco';

-- Micaela Palacios → The Emerging Force
UPDATE public.team_members 
SET hero_profile_slug = 'micaela-palacios' 
WHERE LOWER(full_name) = 'micaela palacios';

-- Andrew Gianares → OCP — The Work Crusher
UPDATE public.team_members 
SET hero_profile_slug = 'ocp-andrew-gianares' 
WHERE LOWER(full_name) LIKE '%andrew%gianares%' 
   OR LOWER(full_name) LIKE '%ocp%';

-- Samprina Zekio → The Code Keeper
UPDATE public.team_members 
SET hero_profile_slug = 'samprina-zekio' 
WHERE LOWER(full_name) = 'samprina zekio';

-- P24 Shadow Task Force (Ganesh & Thameem) - special case, multiple people
-- These may need manual assignment since they're a team

-- Step 4: Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_team_members_hero_profile_slug 
ON public.team_members(hero_profile_slug) 
WHERE hero_profile_slug IS NOT NULL;

-- Step 5: Verify the mapping
SELECT id, full_name, email, hero_profile_slug, is_active
FROM public.team_members
WHERE hero_profile_slug IS NOT NULL
ORDER BY full_name;
