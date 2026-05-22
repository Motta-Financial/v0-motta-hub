-- ProConnect Auto-Link Trigger
-- Automatically links newly synced ProConnect clients to Hub contacts/organizations
-- by matching on email, name, or phone

CREATE OR REPLACE FUNCTION auto_link_proconnect_to_hub()
RETURNS TRIGGER AS $$
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

  -- For BUSINESS clients: match against organizations
  IF NEW.client_type = 'BUSINESS' THEN
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_proconnect_auto_link_hub ON proconnect_clients;

CREATE TRIGGER trg_proconnect_auto_link_hub
  BEFORE INSERT OR UPDATE ON proconnect_clients
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_proconnect_to_hub();

COMMENT ON FUNCTION auto_link_proconnect_to_hub IS
  'Auto-links new/updated ProConnect clients to Hub contacts (PERSON) or organizations (BUSINESS) by email or name match. Only runs when hub link is not already set.';
