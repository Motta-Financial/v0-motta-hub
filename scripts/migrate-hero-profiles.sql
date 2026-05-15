-- ============================================================================
-- Migration: Link Hero Profiles to Team Members
-- ============================================================================
-- Run this SQL in Supabase SQL Editor to add proper linkage between
-- team_members and their Motta Alliance hero profiles.
--
-- This replaces the fragile name-based matching with direct slug references.
-- ============================================================================

-- Step 1: Add the hero_profile_slug column (if it doesn't exist)
ALTER TABLE public.team_members
ADD COLUMN IF NOT EXISTS hero_profile_slug TEXT;

-- Add a comment explaining the column
COMMENT ON COLUMN public.team_members.hero_profile_slug IS 
'Slug linking to a hero profile in HERO_PROFILES array (lib/motta-alliance/hero-profiles.ts). NULL means no hero profile assigned.';

-- Step 2: Map existing heroes to team members by name
-- These slugs match those defined in hero-profiles.ts

-- Dat Le → The Captain
UPDATE public.team_members 
SET hero_profile_slug = 'dat-le' 
WHERE LOWER(full_name) = 'dat le'
  AND hero_profile_slug IS NULL;

-- Mark Dwyer → The Stabilizer
UPDATE public.team_members 
SET hero_profile_slug = 'mark-dwyer' 
WHERE LOWER(full_name) = 'mark dwyer'
  AND hero_profile_slug IS NULL;

-- Caleb Long → The Financial Optimizer
UPDATE public.team_members 
SET hero_profile_slug = 'caleb-long' 
WHERE LOWER(full_name) = 'caleb long'
  AND hero_profile_slug IS NULL;

-- Amy Sparaco → The Ledger Oracle
UPDATE public.team_members 
SET hero_profile_slug = 'amy-sparaco' 
WHERE LOWER(full_name) = 'amy sparaco'
  AND hero_profile_slug IS NULL;

-- Micaela Palacios → The Emerging Force
UPDATE public.team_members 
SET hero_profile_slug = 'micaela-palacios' 
WHERE LOWER(full_name) = 'micaela palacios'
  AND hero_profile_slug IS NULL;

-- Andrew Gianares → OCP — The Work Crusher
UPDATE public.team_members 
SET hero_profile_slug = 'ocp-andrew-gianares' 
WHERE (LOWER(full_name) LIKE '%andrew%gianares%' OR LOWER(full_name) LIKE '%ocp%')
  AND hero_profile_slug IS NULL;

-- Samprina Zekio → The Code Keeper
UPDATE public.team_members 
SET hero_profile_slug = 'samprina-zekio' 
WHERE LOWER(full_name) = 'samprina zekio'
  AND hero_profile_slug IS NULL;

-- P24 Shadow Task Force - shared by Ganesh & Thameem
-- Uncomment and adjust these if you want to assign the shared hero profile:
-- UPDATE public.team_members SET hero_profile_slug = 'p24-shadow-task-force' WHERE LOWER(full_name) LIKE '%ganesh%';
-- UPDATE public.team_members SET hero_profile_slug = 'p24-shadow-task-force' WHERE LOWER(full_name) LIKE '%thameem%';

-- Step 3: Create an index for faster lookups
CREATE INDEX IF NOT EXISTS idx_team_members_hero_profile_slug 
ON public.team_members(hero_profile_slug) 
WHERE hero_profile_slug IS NOT NULL;

-- Step 4: Verify the mapping
SELECT 
  full_name,
  hero_profile_slug,
  email,
  is_active
FROM public.team_members
WHERE hero_profile_slug IS NOT NULL
ORDER BY full_name;
