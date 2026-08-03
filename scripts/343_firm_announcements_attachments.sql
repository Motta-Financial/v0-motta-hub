-- 343_firm_announcements_attachments.sql
-- Adds JSONB column for file attachments on firm-wide announcements.
-- Each element: { url, pathname, name, content_type, size_bytes, uploaded_at }

ALTER TABLE public.firm_announcements
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::JSONB;

COMMENT ON COLUMN public.firm_announcements.attachments IS
  'Array of file attachments. Each object: { url, pathname, name, content_type, size_bytes, uploaded_at }';
