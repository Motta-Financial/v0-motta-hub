-- Create debrief_comments table for commenting on debriefs
CREATE TABLE IF NOT EXISTS debrief_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  debrief_id UUID NOT NULL REFERENCES debriefs(id) ON DELETE CASCADE,
  author_id UUID REFERENCES team_members(id),
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_debrief_comments_debrief_id ON debrief_comments(debrief_id);
CREATE INDEX IF NOT EXISTS idx_debrief_comments_author_id ON debrief_comments(author_id);

-- Enable RLS
ALTER TABLE debrief_comments ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations for authenticated users
CREATE POLICY "Allow all on debrief_comments" ON debrief_comments FOR ALL USING (true) WITH CHECK (true);

-- Add indexes to notifications table for better performance
CREATE INDEX IF NOT EXISTS idx_notifications_team_member_id ON notifications(team_member_id);
CREATE INDEX IF NOT EXISTS idx_notifications_entity_type ON notifications(entity_type);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
