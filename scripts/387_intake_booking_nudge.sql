-- 387 — One-shot booking reminder for intake prospects who never booked
--
-- Companion to 386. The intake pipeline emails every prospect a
-- discovery-call link; this column is the single-flight guard for the
-- ONE follow-up we send 48h later if they still haven't booked.
--
-- Deliberately a timestamp rather than a counter: the design decision
-- is one nudge per prospect for good, not a drip sequence. Someone who
-- filled in a tax intake form and then went quiet has a reason, and
-- chasing them costs more reputationally than the marginal booking is
-- worth. See lib/intake/booking-nudge.ts for the rest of the guards.

ALTER TABLE public.jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS booking_nudge_sent_at timestamptz;

COMMENT ON COLUMN public.jotform_intake_submissions.booking_nudge_sent_at IS
  'Single-flight guard for the 48h booking reminder. Set only on a confirmed send; one nudge per prospect, ever.';

-- Replaces 386's version of this index. The sweep also filters on
-- booking_nudge_sent_at, so folding it into the partial predicate keeps
-- the index selective as the already-nudged population grows — without
-- it, every nudged row stays in the index forever and the scan degrades
-- into "all prospects who ever got a link and never booked".
DROP INDEX IF EXISTS public.idx_intake_awaiting_booking;
CREATE INDEX IF NOT EXISTS idx_intake_awaiting_booking
  ON public.jotform_intake_submissions (prospect_confirmation_sent_at)
  WHERE calendly_event_id IS NULL
    AND prospect_confirmation_sent_at IS NOT NULL
    AND booking_nudge_sent_at IS NULL;
