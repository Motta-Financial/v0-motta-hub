-- Migration: Add karbon_entity_type to help distinguish Organizations (Business) from Contacts (Individuals)
-- This aligns with Karbon API which uses different endpoints for each entity type

-- 1. Add karbon_entity_type column to contacts table (Individual clients)
-- This explicitly marks all records as 'Contact' for Karbon API queries
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS karbon_entity_type TEXT DEFAULT 'Contact';

-- Update existing contacts to have the correct entity type
UPDATE contacts 
SET karbon_entity_type = 'Contact' 
WHERE karbon_entity_type IS NULL OR karbon_entity_type = '';

-- Add comment for documentation
COMMENT ON COLUMN contacts.karbon_entity_type IS 'Karbon entity type - always "Contact" for individual clients. Used to determine which Karbon API endpoint to query.';

-- 2. Add karbon_entity_type column to organizations table (Business clients)
-- This explicitly marks all records as 'Organization' for Karbon API queries
ALTER TABLE organizations 
ADD COLUMN IF NOT EXISTS karbon_entity_type TEXT DEFAULT 'Organization';

-- Update existing organizations to have the correct entity type
UPDATE organizations 
SET karbon_entity_type = 'Organization' 
WHERE karbon_entity_type IS NULL OR karbon_entity_type = '';

-- Add comment for documentation
COMMENT ON COLUMN organizations.karbon_entity_type IS 'Karbon entity type - always "Organization" for business clients. Used to determine which Karbon API endpoint to query.';

-- 3. Create a unified view that combines both contacts and organizations with their Karbon keys
-- This makes it easy to look up any client by their Karbon key and know which API to use
CREATE OR REPLACE VIEW karbon_clients AS
SELECT 
    id,
    karbon_contact_key AS karbon_key,
    'Contact' AS karbon_entity_type,
    full_name AS name,
    primary_email AS email,
    entity_type,
    status,
    avatar_url,
    created_at,
    updated_at
FROM contacts
WHERE karbon_contact_key IS NOT NULL

UNION ALL

SELECT 
    id,
    karbon_organization_key AS karbon_key,
    'Organization' AS karbon_entity_type,
    name,
    primary_email AS email,
    entity_type,
    NULL AS status,
    NULL AS avatar_url,
    created_at,
    updated_at
FROM organizations
WHERE karbon_organization_key IS NOT NULL;

-- Add comment for the view
COMMENT ON VIEW karbon_clients IS 'Unified view of all Karbon clients (both Contacts and Organizations) with their entity types for API routing.';

-- 4. Create an index on the karbon keys for faster lookups
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_key ON contacts(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_key ON organizations(karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;

-- 5. Create a function to look up a client by Karbon key and return entity type
CREATE OR REPLACE FUNCTION get_karbon_entity_type(karbon_key TEXT)
RETURNS TABLE (
    id UUID,
    entity_type TEXT,
    name TEXT
) AS $$
BEGIN
    -- First check contacts
    RETURN QUERY
    SELECT c.id, 'Contact'::TEXT AS entity_type, c.full_name AS name
    FROM contacts c
    WHERE c.karbon_contact_key = karbon_key
    LIMIT 1;
    
    IF NOT FOUND THEN
        -- Then check organizations
        RETURN QUERY
        SELECT o.id, 'Organization'::TEXT AS entity_type, o.name
        FROM organizations o
        WHERE o.karbon_organization_key = karbon_key
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_karbon_entity_type IS 'Look up a Karbon client by key and return their entity type (Contact or Organization) for API routing.';
