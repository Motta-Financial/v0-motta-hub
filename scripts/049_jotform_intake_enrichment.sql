-- ─────────────────────────────────────────────────────────────────────────
-- Jotform intake — auto-assignment, firm-wide notification, and AI
-- enrichment. Idempotent.
--
-- New columns on jotform_intake_submissions:
--   preferred_team_member  : the prospect's typed/selected name from
--                            the "Is there a specific team member you
--                            would prefer to meet with?" question
--                            (raw answer `lastlyTo53`). Kept as plain
--                            text alongside `assigned_to_id` so we
--                            never lose what the prospect actually
--                            said even when the name doesn't match a
--                            current team member.
--   enrichment             : research blob produced by the website /
--                            web-search enrichment pass. Shape:
--                              {
--                                summary: string,
--                                websites: [{url, title, note?}],
--                                sources:  [{url, title, snippet?}],
--                                generated_at: iso,
--                                model: string
--                              }
--   question_research      : AI research notes drafted in response to
--                            the prospect's `questions_or_concerns`
--                            field. Shape:
--                              {
--                                questions: string,
--                                summary: string,
--                                key_points: string[],
--                                references: [{url, title}],
--                                disclaimer: string,
--                                generated_at: iso,
--                                model: string
--                              }
--   notified_at            : timestamp the firm-wide "new intake" email
--                            was sent. Used as a dedupe guard so a
--                            webhook re-delivery (or backfill replay)
--                            never re-emails the team for the same
--                            submission.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.jotform_intake_submissions
  ADD COLUMN IF NOT EXISTS preferred_team_member text,
  ADD COLUMN IF NOT EXISTS enrichment            jsonb,
  ADD COLUMN IF NOT EXISTS question_research     jsonb,
  ADD COLUMN IF NOT EXISTS notified_at           timestamptz;

-- Triage-by-preference: partners often want to pull up intakes that
-- requested a specific teammate.
CREATE INDEX IF NOT EXISTS idx_jotform_intake_preferred_member
  ON public.jotform_intake_submissions (preferred_team_member);

-- Dedupe / debug lookup for the notification send.
CREATE INDEX IF NOT EXISTS idx_jotform_intake_notified_at
  ON public.jotform_intake_submissions (notified_at);
