-- Add karbon_modified_at column to track Karbon's LastModifiedDateTime for incremental sync

-- Add to work_items if not exists
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS karbon_modified_at timestamptz;

-- Add to contacts if not exists  
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS karbon_modified_at timestamptz;

-- Add to organizations if not exists
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS karbon_modified_at timestamptz;

-- Create indexes for efficient querying during incremental sync
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_modified_at ON work_items(karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_modified_at ON contacts(karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_modified_at ON organizations(karbon_modified_at DESC) WHERE karbon_modified_at IS NOT NULL;
