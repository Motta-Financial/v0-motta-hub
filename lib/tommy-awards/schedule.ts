/**
 * Tommy Awards — Friday recap schedule, all in America/New_York.
 *
 * Single source of truth for the three moments that have to stay in
 * sync: when voting closes, when PREPARE tallies + generates art, and
 * when SEND emails the firm. Changing the schedule means updating this
 * file AND the matching cron entries in vercel.json (Vercel Cron is
 * UTC-only, so each ET time needs its EDT + EST UTC-twin schedule).
 *
 *   12:15 PM ────────────── VOTING_CUTOFF (ballot route rejects writes)
 *                           AND PREPARE runs (tally, story, kicks off
 *                           image/PDF) — same instant, so the tally
 *                           PREPARE reads can no longer change under it.
 *   12:30 PM ────────────── SEND runs (re-tally safety check, then email)
 *                           so the firm sees the podium ~15 min later.
 *
 * Voting cutoff and PREPARE share the same wall-clock minute rather than
 * closing voting slightly earlier, per explicit request — "the closer
 * the better." SEND still re-tallies and regenerates on drift as a
 * second safety net (see tommy-recap-send/route.ts) in case a request
 * ever lands in the same instant as the cutoff.
 */
export const VOTING_CUTOFF_HOUR = 12
export const VOTING_CUTOFF_MINUTE = 15

export const PREPARE_HOUR = 12
export const PREPARE_MINUTE = 15

export const SEND_HOUR = 12
export const SEND_MINUTE = 30
