-- Tommy Award Ballot Audit History Table
-- Tracks changes when ballots are amended

CREATE TABLE IF NOT EXISTS tommy_award_ballot_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ballot_id UUID NOT NULL REFERENCES tommy_award_ballots(id) ON DELETE CASCADE,
  
  -- Who made the change
  changed_by_id UUID REFERENCES team_members(id),
  changed_by_name TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Change type
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'amended')),
  
  -- Snapshot of ballot at time of change
  first_place_id UUID,
  first_place_name TEXT,
  first_place_notes TEXT,
  second_place_id UUID,
  second_place_name TEXT,
  second_place_notes TEXT,
  third_place_id UUID,
  third_place_name TEXT,
  third_place_notes TEXT,
  honorable_mention_id UUID,
  honorable_mention_name TEXT,
  honorable_mention_notes TEXT,
  partner_vote_id UUID,
  partner_vote_name TEXT,
  partner_vote_notes TEXT,
  
  -- Summary of what changed (for display)
  change_summary JSONB
);

-- Index for efficient lookup by ballot
CREATE INDEX IF NOT EXISTS idx_ballot_history_ballot_id ON tommy_award_ballot_history(ballot_id);
CREATE INDEX IF NOT EXISTS idx_ballot_history_changed_at ON tommy_award_ballot_history(changed_at DESC);

-- RLS Policy
ALTER TABLE tommy_award_ballot_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on tommy_award_ballot_history" ON tommy_award_ballot_history;
CREATE POLICY "Allow all on tommy_award_ballot_history" ON tommy_award_ballot_history FOR ALL USING (true);

COMMENT ON TABLE tommy_award_ballot_history IS 'Audit trail for Tommy Award ballot amendments';
