-- Meeting Notes & Debriefs table from Airtable (actually a contacts/clients table)
-- Run this in Supabase SQL Editor before migrating

CREATE TABLE IF NOT EXISTS meeting_notes_debriefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Identity fields
  key TEXT,
  first_name TEXT,
  last_name TEXT,
  middle_name TEXT,
  preferred_name TEXT,
  
  -- Contact info
  primary_email TEXT,
  email_2 TEXT,
  phone_1 TEXT,
  phone_2 TEXT,
  phone_3 TEXT,
  more_phone_numbers TEXT,
  
  -- Address fields
  physical_address TEXT,
  mailing_address TEXT,
  home_address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  country TEXT,
  
  -- Client/Contact classification
  client_name TEXT,
  client_number TEXT,
  client_type TEXT,
  contact_type TEXT,
  role TEXT,
  organization TEXT,
  
  -- Personal details
  date_of_birth TEXT,
  social_security_number TEXT,
  employer_id_ein TEXT,
  
  -- Karbon integration
  karbon_client_id TEXT,
  karbon_contact_url TEXT,
  
  -- Related records (Airtable linked records stored as JSON)
  motta_meeting_debriefs_2 TEXT,
  motta_meeting_debriefs_4 TEXT,
  acct_bookkeeping_clients TEXT,
  tax_individual_1040 TEXT
);

-- Enable Row Level Security
ALTER TABLE meeting_notes_debriefs ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust based on your auth requirements)
CREATE POLICY "Allow all operations on meeting_notes_debriefs" ON meeting_notes_debriefs
  FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_meeting_notes_debriefs_karbon_id ON meeting_notes_debriefs(karbon_client_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_debriefs_email ON meeting_notes_debriefs(primary_email);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_debriefs_client_number ON meeting_notes_debriefs(client_number);
