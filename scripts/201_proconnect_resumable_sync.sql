-- ════════════════════════════════════════════════════════════════════════════
-- Add resumable sync support to proconnect_sync_logs
-- ════════════════════════════════════════════════════════════════════════════

-- Add column to track the last client index for resumable syncs
ALTER TABLE proconnect_sync_logs 
ADD COLUMN IF NOT EXISTS last_client_index integer DEFAULT 0;

-- Add comment explaining the column
COMMENT ON COLUMN proconnect_sync_logs.last_client_index IS 
  'Index of the last client processed in this sync run. Used to resume partial syncs.';
