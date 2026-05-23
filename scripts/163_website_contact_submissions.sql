-- 163_website_contact_submissions.sql
--
-- Stores submissions from the marketing site's general "Contact Us"
-- form (anything that ISN'T a full intake). Kept separate from
-- jotform_intake_submissions so the intake list stays clean — those
-- rows represent prospects ready for a discovery conversation, while
-- contact-form rows are the broader top-of-funnel ("got a question",
-- "lost my W-2", "newsletter inquiry").
--
-- Hub-first invariant still holds: we always create a Master Hub
-- Contact (per the user decision) and link to it via contact_id.
-- Karbon push is NOT auto-triggered here — these aren't necessarily
-- billable leads yet. A teammate decides whether to push from the
-- contact detail page using the existing PlatformLinksCard.

CREATE TABLE IF NOT EXISTS website_contact_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Submitter identity
  full_name text,
  email text,
  phone text,

  -- Free-form message body — the only required user-visible field.
  message text NOT NULL,

  -- Optional categorization. The website form can send a `topic` like
  -- "Tax Question", "New Engagement", "Existing Client Issue", etc.
  topic text,

  -- Hub linkage. Always populated when email/phone is present (per
  -- the "Always create a Hub contact" decision); null only when the
  -- contact creation itself failed (best-effort).
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  -- Tracking + audit
  ip_address text,
  user_agent text,
  page_url text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  raw_payload jsonb,

  -- Workflow state. 'new' on insert; teammates flip to 'replied' or
  -- 'closed' from the dashboard. Mirrors prospect_submissions.lead_status
  -- so the dashboard list can use the same Filter chip.
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'replied', 'closed', 'spam')),
  assigned_to_id uuid REFERENCES team_members(id) ON DELETE SET NULL,

  -- Notification tracking — set by the route after Resend confirms
  -- the team email went out. Null when the email failed.
  team_notified_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS website_contact_submissions_status_idx
  ON website_contact_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS website_contact_submissions_email_idx
  ON website_contact_submissions(lower(email));
CREATE INDEX IF NOT EXISTS website_contact_submissions_contact_idx
  ON website_contact_submissions(contact_id);

-- Updated-at trigger — same pattern as the rest of the schema.
CREATE OR REPLACE FUNCTION website_contact_submissions_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_contact_submissions_updated_at
  ON website_contact_submissions;
CREATE TRIGGER website_contact_submissions_updated_at
  BEFORE UPDATE ON website_contact_submissions
  FOR EACH ROW EXECUTE FUNCTION website_contact_submissions_set_updated_at();

COMMENT ON TABLE website_contact_submissions IS
  'Public contact-form submissions from motta.cpa. Always creates a Hub contact when email/phone present; Karbon push is manual.';
