-- Add Calendly sync columns to meetings table if they don't exist
-- and create a calendly_events table for storing raw Calendly data

-- Add additional columns to meetings table for better Calendly integration
ALTER TABLE meetings 
ADD COLUMN IF NOT EXISTS calendly_invitee_email TEXT,
ADD COLUMN IF NOT EXISTS calendly_invitee_name TEXT,
ADD COLUMN IF NOT EXISTS calendly_event_type TEXT,
ADD COLUMN IF NOT EXISTS calendly_location_type TEXT,
ADD COLUMN IF NOT EXISTS calendly_join_url TEXT,
ADD COLUMN IF NOT EXISTS calendly_cancel_url TEXT,
ADD COLUMN IF NOT EXISTS calendly_reschedule_url TEXT,
ADD COLUMN IF NOT EXISTS calendly_questions_answers JSONB,
ADD COLUMN IF NOT EXISTS calendly_synced_at TIMESTAMP WITH TIME ZONE;

-- Create calendly_events table for raw event storage
CREATE TABLE IF NOT EXISTS calendly_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_uri TEXT UNIQUE NOT NULL,
  event_type_uri TEXT,
  event_type_name TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE NOT NULL,
  location_type TEXT,
  location_details TEXT,
  join_url TEXT,
  invitees_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  calendly_created_at TIMESTAMP WITH TIME ZONE,
  calendly_updated_at TIMESTAMP WITH TIME ZONE,
  raw_data JSONB
);

-- Create calendly_invitees table
CREATE TABLE IF NOT EXISTS calendly_invitees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_uri TEXT UNIQUE NOT NULL,
  calendly_event_id UUID REFERENCES calendly_events(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  status TEXT DEFAULT 'active',
  timezone TEXT,
  cancel_url TEXT,
  reschedule_url TEXT,
  questions_answers JSONB,
  rescheduled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  calendly_created_at TIMESTAMP WITH TIME ZONE,
  raw_data JSONB,
  -- Link to contacts table if email matches
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_calendly_events_start_time ON calendly_events(start_time);
CREATE INDEX IF NOT EXISTS idx_calendly_events_status ON calendly_events(status);
CREATE INDEX IF NOT EXISTS idx_calendly_invitees_email ON calendly_invitees(email);
CREATE INDEX IF NOT EXISTS idx_calendly_invitees_event_id ON calendly_invitees(calendly_event_id);
CREATE INDEX IF NOT EXISTS idx_meetings_calendly_event_id ON meetings(calendly_event_id);

-- Enable RLS
ALTER TABLE calendly_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendly_invitees ENABLE ROW LEVEL SECURITY;

-- Create permissive policies
CREATE POLICY "Allow all on calendly_events" ON calendly_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on calendly_invitees" ON calendly_invitees FOR ALL USING (true) WITH CHECK (true);

-- Create function to auto-link invitees to contacts
CREATE OR REPLACE FUNCTION link_calendly_invitee_to_contact()
RETURNS TRIGGER AS $$
BEGIN
  -- Try to find a matching contact by email
  NEW.contact_id := (
    SELECT id FROM contacts 
    WHERE primary_email = NEW.email 
    OR secondary_email = NEW.email
    LIMIT 1
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-link on insert/update
DROP TRIGGER IF EXISTS link_invitee_contact ON calendly_invitees;
CREATE TRIGGER link_invitee_contact
  BEFORE INSERT OR UPDATE ON calendly_invitees
  FOR EACH ROW
  EXECUTE FUNCTION link_calendly_invitee_to_contact();
