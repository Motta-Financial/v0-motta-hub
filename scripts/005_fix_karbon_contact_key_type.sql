-- Fix karbon_contact_key column type from uuid to text
-- Karbon uses string keys like "21ncFBDvtQjP", not UUIDs

-- Drop the existing constraint if any
ALTER TABLE contacts 
DROP CONSTRAINT IF EXISTS contacts_karbon_contact_key_key;

-- Change the column type from uuid to text
ALTER TABLE contacts 
ALTER COLUMN karbon_contact_key TYPE text USING karbon_contact_key::text;

-- Add back the unique constraint
ALTER TABLE contacts 
ADD CONSTRAINT contacts_karbon_contact_key_key UNIQUE (karbon_contact_key);
