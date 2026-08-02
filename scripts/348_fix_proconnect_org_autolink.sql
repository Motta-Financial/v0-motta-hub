-- 348: Fix the organization branch of the ProConnect auto-link trigger.
--
-- The trigger (scripts/151_proconnect_auto_link_hub.sql) matches
-- client_type = 'BUSINESS', but every sync path writes 'ORGANIZATION'
-- (see proconnect-sync-clients edge function and lib/proconnect/sync.ts
-- mapClientRow, both of which uppercase to the CHECK-constraint values
-- PERSON / ORGANIZATION). The organization auto-link branch has
-- therefore never fired — as of 2026-07, 569 ORGANIZATION clients
-- existed and only the fuzzy matcher had linked any of them.
--
-- Accept both spellings so the trigger works regardless of which sync
-- wrote the row.

CREATE OR REPLACE FUNCTION public.auto_link_proconnect_to_hub()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  matched_contact_id uuid;
  matched_org_id uuid;
BEGIN
  -- Only attempt linking if not already linked
  IF NEW.hub_contact_id IS NOT NULL OR NEW.hub_organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- For PERSON clients: match against contacts
  IF NEW.client_type = 'PERSON' THEN
    -- Try email first (most reliable)
    IF NEW.email IS NOT NULL THEN
      SELECT id INTO matched_contact_id
      FROM contacts
      WHERE LOWER(primary_email) = LOWER(NEW.email)
      LIMIT 1;
    END IF;

    -- Fall back to first + last name match
    IF matched_contact_id IS NULL AND NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL THEN
      SELECT id INTO matched_contact_id
      FROM contacts
      WHERE LOWER(first_name) = LOWER(NEW.first_name)
        AND LOWER(last_name) = LOWER(NEW.last_name)
      LIMIT 1;
    END IF;

    IF matched_contact_id IS NOT NULL THEN
      NEW.hub_contact_id := matched_contact_id;
    END IF;
  END IF;

  -- For organization clients: match against organizations.
  -- Sync writes 'ORGANIZATION'; 'BUSINESS' kept for any legacy rows.
  IF NEW.client_type IN ('ORGANIZATION', 'BUSINESS') THEN
    -- Try email first
    IF NEW.email IS NOT NULL THEN
      SELECT id INTO matched_org_id
      FROM organizations
      WHERE LOWER(primary_email) = LOWER(NEW.email)
      LIMIT 1;
    END IF;

    -- Fall back to business name match
    IF matched_org_id IS NULL AND NEW.business_name IS NOT NULL THEN
      SELECT id INTO matched_org_id
      FROM organizations
      WHERE LOWER(name) = LOWER(NEW.business_name)
      LIMIT 1;
    END IF;

    IF matched_org_id IS NOT NULL THEN
      NEW.hub_organization_id := matched_org_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
