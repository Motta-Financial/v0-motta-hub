-- 386 — Intake → booking attribution + link-failure observability
--
-- Two problems this migration supports fixing, both identified in
-- docs/INTAKE_AUTOMATION_REVIEW.md:
--
--  1. Nothing durably connects an intake submission to the Calendly
--     booking it produced. Attribution was an implicit join on
--     contact_id, which only works when the prospect books with the
--     same email they typed on the form. We now carry the intake row's
--     UUID through Calendly's `tracking.salesforce_uuid` field and
--     write the resulting event straight back onto the intake row.
--
--  2. When client-linking failed, the only trace was a console.log in a
--     serverless runtime. 11 of 12 website intakes sat unlinked with no
--     visible signal. `link_error` / `link_attempted_at` make failures
--     queryable, and the partial index makes "show me the unlinked
--     ones" cheap.
--
-- Also records the prospect-facing side of the funnel: which booking URL
-- we generated for them, and whether the confirmation email went out.
-- `prospect_confirmation_sent_at` is the single-flight guard for that
-- email, mirroring how `notified_at` guards the team email.

ALTER TABLE public.jotform_intake_submissions
  -- Why linking failed, verbatim from the thrown error. NULL when the
  -- last attempt succeeded or none has run yet.
  ADD COLUMN IF NOT EXISTS link_error text,
  -- Set on every link attempt, success or failure. Distinguishes "never
  -- ran" (NULL) from "ran and found nothing" — the two look identical
  -- on link_method alone.
  ADD COLUMN IF NOT EXISTS link_attempted_at timestamptz,

  -- The prefilled Calendly URL handed to this prospect. Persisted so the
  -- team email, the triage sheet, and any follow-up nudge all send the
  -- SAME link — a second generated link would break attribution.
  ADD COLUMN IF NOT EXISTS booking_url text,
  ADD COLUMN IF NOT EXISTS prospect_confirmation_sent_at timestamptz,

  -- The booking this intake produced. Populated by the Calendly webhook
  -- when invitee.tracking.salesforce_uuid matches this row's id.
  -- ON DELETE SET NULL: losing a Calendly event must never cascade into
  -- deleting the intake record it came from.
  ADD COLUMN IF NOT EXISTS calendly_event_id uuid
    REFERENCES public.calendly_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_booked_at timestamptz;

COMMENT ON COLUMN public.jotform_intake_submissions.link_error IS
  'Error from the most recent contact-resolution attempt; NULL when it succeeded.';
COMMENT ON COLUMN public.jotform_intake_submissions.booking_url IS
  'Prefilled Calendly discovery-call URL generated for this prospect. Carries salesforce_uuid = this row''s id for attribution.';
COMMENT ON COLUMN public.jotform_intake_submissions.calendly_event_id IS
  'The Calendly booking this intake produced, attributed via tracking.salesforce_uuid.';

-- "Which intakes never got a contact?" — the query that would have
-- surfaced the website-intake linking failure months earlier.
CREATE INDEX IF NOT EXISTS idx_intake_unlinked
  ON public.jotform_intake_submissions (jotform_created_at DESC)
  WHERE contact_id IS NULL AND organization_id IS NULL;

-- "Which intakes converted to a booking?" — funnel reporting.
CREATE INDEX IF NOT EXISTS idx_intake_calendly_event
  ON public.jotform_intake_submissions (calendly_event_id)
  WHERE calendly_event_id IS NOT NULL;

-- Reverse lookup for the webhook: given an intake id from
-- salesforce_uuid, we address the row by primary key, so no index is
-- needed there. This one supports the nudge sweep: intakes that were
-- sent a booking link but never booked.
CREATE INDEX IF NOT EXISTS idx_intake_awaiting_booking
  ON public.jotform_intake_submissions (prospect_confirmation_sent_at)
  WHERE calendly_event_id IS NULL AND prospect_confirmation_sent_at IS NOT NULL;
