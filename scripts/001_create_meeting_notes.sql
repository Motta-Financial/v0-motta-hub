-- Create meeting_notes table for storing Airtable "Meeting Notes & Debriefs" data
CREATE TABLE IF NOT EXISTS meeting_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  airtable_id TEXT UNIQUE,
  client_name TEXT,
  meeting_date DATE,
  meeting_type TEXT,
  attendees TEXT[],
  agenda TEXT,
  notes TEXT,
  action_items TEXT[],
  follow_up_date DATE,
  status TEXT DEFAULT 'active',
  karbon_client_key TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_meeting_notes_client ON meeting_notes(client_name);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_date ON meeting_notes(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_notes_karbon ON meeting_notes(karbon_client_key);

-- Enable RLS
ALTER TABLE meeting_notes ENABLE ROW LEVEL SECURITY;

-- Since this is internal data without user auth, allow all operations
-- In production, you'd want proper RLS policies based on user roles
CREATE POLICY "Allow all operations on meeting_notes" ON meeting_notes
  FOR ALL USING (true) WITH CHECK (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_meeting_notes_updated_at
  BEFORE UPDATE ON meeting_notes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
