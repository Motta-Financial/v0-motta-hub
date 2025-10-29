export interface CalendlyUser {
  uri: string
  name: string
  slug: string
  email: string
  scheduling_url: string
  timezone: string
  avatar_url?: string
  created_at: string
  updated_at: string
  current_organization: string
}

export interface CalendlyEventType {
  uri: string
  name: string
  active: boolean
  slug: string
  scheduling_url: string
  duration: number
  kind: "solo" | "group" | "collective" | "round_robin"
  pooling_type?: string
  type: "StandardEventType" | "AdhocEventType"
  color: string
  created_at: string
  updated_at: string
  internal_note?: string
  description_plain?: string
  description_html?: string
  profile: {
    type: string
    name: string
    owner: string
  }
  secret: boolean
  booking_method: string
  custom_questions?: Array<{
    name: string
    type: string
    position: number
    enabled: boolean
    required: boolean
    answer_choices?: string[]
    include_other?: boolean
  }>
}

export interface CalendlyScheduledEvent {
  uri: string
  name: string
  status: "active" | "canceled"
  start_time: string
  end_time: string
  event_type: string
  location?: {
    type: string
    location?: string
    join_url?: string
  }
  invitees_counter: {
    total: number
    active: number
    limit: number
  }
  created_at: string
  updated_at: string
  event_memberships: Array<{
    user: string
    user_email?: string
    user_name?: string
  }>
  event_guests: Array<{
    email: string
    created_at: string
    updated_at: string
  }>
  cancellation?: {
    canceled_by: string
    reason?: string
    canceler_type: string
  }
}

export interface CalendlyInvitee {
  uri: string
  email: string
  name: string
  status: "active" | "canceled"
  timezone: string
  event: string
  created_at: string
  updated_at: string
  tracking?: {
    utm_campaign?: string
    utm_source?: string
    utm_medium?: string
    utm_content?: string
    utm_term?: string
    salesforce_uuid?: string
  }
  text_reminder_number?: string
  rescheduled: boolean
  old_invitee?: string
  new_invitee?: string
  cancel_url: string
  reschedule_url: string
  questions_and_answers?: Array<{
    question: string
    answer: string
    position: number
  }>
  payment?: {
    id: string
    provider: string
    amount: number
    currency: string
    terms: string
    successful: boolean
  }
  no_show?: {
    created_at: string
  }
  reconfirmation?: {
    created_at: string
    confirmed_at?: string
  }
  cancellation?: {
    canceled_by: string
    reason?: string
    canceler_type: string
  }
}

export interface CalendlyWebhook {
  uri: string
  callback_url: string
  created_at: string
  updated_at: string
  retry_started_at?: string
  state: "active" | "disabled"
  events: string[]
  organization: string
  user?: string
  creator: string
  signing_key: string
}
