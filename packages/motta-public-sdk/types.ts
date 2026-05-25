/**
 * Input shapes accepted by the Hub public endpoints. Mirror these
 * exactly when posting from the marketing site so TypeScript catches
 * shape drift.
 */

export interface ContactSubmissionInput {
  name: string
  email: string
  message: string
  phone?: string
  subject?: string
  company?: string
  topic?: string
  source_page?: string
  /** Honeypot — leave undefined / empty. */
  website?: string
}

export interface IntakeSubmissionInput {
  // Mirrors POST /api/public/intake. The server tolerates additional
  // fields (raw_answers gets stored verbatim) so this is a minimum
  // contract — extend it as the form on motta.cpa grows.
  submitter_first_name?: string
  submitter_last_name?: string
  submitter_full_name?: string
  submitter_email: string
  submitter_phone?: string
  business_name?: string
  business_state?: string
  service_focus?: string
  services_requested?: string[]
  questions_or_concerns?: string
  additional_notes?: string
  source_page?: string
  /** Honeypot. */
  website?: string
  /** Anything else the form captures — stored as raw_answers. */
  [extra: string]: unknown
}

export interface NewsletterSignupInput {
  email: string
  full_name?: string
  source?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  /** Honeypot. */
  website?: string
}
