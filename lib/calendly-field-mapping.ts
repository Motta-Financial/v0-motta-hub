/**
 * Calendly → DB field mapping (single source of truth).
 *
 * Both ingest paths — the real-time webhook (`app/api/calendly/webhook`)
 * and the polling sync (`lib/calendly-sync.ts`) — receive the same
 * Calendly `scheduled_event` and `invitee` shapes. Historically each path
 * hand-mapped a *subset* of fields into columns and dumped the rest into
 * `raw_data`, so the two paths drifted and useful data (invitee phone,
 * reschedule lineage, payment, no-show, guests, host buffers, meeting
 * notes…) was only reachable by digging through JSON.
 *
 * These helpers map every meaningful field Calendly sends into the
 * dedicated columns added by `scripts/330_calendly_full_field_capture.sql`.
 * Callers spread the result and add their own context-specific columns
 * (connection ids, contact_id, synced_at, raw_data).
 *
 * Reference: https://developer.calendly.com/api-docs
 *   - Scheduled Event resource
 *   - Invitee resource
 */
import { extractUuid } from "@/lib/calendly-api"

/**
 * Map a Calendly `scheduled_event` to `calendly_events` columns.
 *
 * `event_type_name` falls back to the event `name` because the bare
 * scheduled_event payload doesn't always echo the event-type name; the
 * polling sync sometimes hydrates `event_type_name` separately.
 */
export function mapCalendlyEventFields(event: any): Record<string, unknown> {
  const location = event?.location || {}
  const counter = event?.invitees_counter || {}
  // Calendly returns the external-calendar link as `calendar_event`
  // ({ kind, external_id }) on events that sync to Google/Outlook/etc.
  const calendarEvent = event?.calendar_event || {}

  return {
    name: event?.name ?? null,
    start_time: event?.start_time ?? null,
    end_time: event?.end_time ?? null,
    event_type_uuid: extractUuid(event?.event_type),
    event_type_name: event?.event_type_name ?? event?.name ?? null,

    // Location (in-person address, phone, or video-conference join URL)
    location_type: location.type ?? null,
    location: location.location ?? null,
    join_url: location.join_url ?? null,

    // Cancellation lineage. `canceler` is the modern nested object;
    // `canceled_by` is the legacy flat string — accept either.
    canceled_at: event?.cancellation?.canceled_at ?? null,
    canceler_type: event?.cancellation?.canceler_type ?? null,
    canceler_name:
      event?.cancellation?.canceler?.name ?? event?.cancellation?.canceled_by ?? null,
    cancel_reason: event?.cancellation?.reason ?? null,
    rescheduled: event?.rescheduled ?? false,

    // ── full-capture columns (migration 330) ────────────────────────────
    meeting_notes_plain: event?.meeting_notes_plain ?? null,
    meeting_notes_html: event?.meeting_notes_html ?? null,
    calendar_kind: calendarEvent.kind ?? null,
    calendar_external_id: calendarEvent.external_id ?? null,
    invitees_counter_total: counter.total ?? null,
    invitees_counter_active: counter.active ?? null,
    invitees_counter_limit: counter.limit ?? null,
    event_guests: event?.event_guests ?? null,
    event_memberships: event?.event_memberships ?? null,

    calendly_created_at: event?.created_at ?? null,
    calendly_updated_at: event?.updated_at ?? null,
  }
}

/**
 * Map a Calendly `invitee` to `calendly_invitees` columns.
 *
 * Promotes the full structured invitee payload: name parts, the SMS
 * reminder number (the most reliable phone signal Calendly gives us),
 * reschedule lineage, routing-form origin, payment, no-show, and the
 * complete UTM/tracking blob.
 */
export function mapCalendlyInviteeFields(invitee: any): Record<string, unknown> {
  const tracking = invitee?.tracking || {}
  // `no_show` is an object ({ uri, created_at }) when the invitee has been
  // marked a no-show, otherwise null. Derive a convenience boolean.
  const noShow = invitee?.no_show || null

  return {
    name: invitee?.name ?? null,
    email: invitee?.email ?? null,
    first_name: invitee?.first_name ?? null,
    last_name: invitee?.last_name ?? null,
    timezone: invitee?.timezone ?? null,
    status: invitee?.status ?? "active",

    reschedule_url: invitee?.reschedule_url ?? null,
    cancel_url: invitee?.cancel_url ?? null,

    // Cancellation lineage (same dual-shape handling as the event).
    canceled_at: invitee?.cancellation?.canceled_at ?? null,
    canceler_type: invitee?.cancellation?.canceler_type ?? null,
    canceler_name:
      invitee?.cancellation?.canceler?.name ?? invitee?.cancellation?.canceled_by ?? null,
    cancel_reason: invitee?.cancellation?.reason ?? null,

    questions_answers: invitee?.questions_and_answers ?? null,

    // Flatten the most-queried UTM params AND keep the full tracking blob
    // (which also carries salesforce_uuid) for anything we didn't promote.
    utm_source: tracking.utm_source ?? null,
    utm_medium: tracking.utm_medium ?? null,
    utm_campaign: tracking.utm_campaign ?? null,
    utm_term: tracking.utm_term ?? null,
    utm_content: tracking.utm_content ?? null,
    tracking: invitee?.tracking ?? null,

    // ── full-capture columns (migration 330) ────────────────────────────
    text_reminder_number: invitee?.text_reminder_number ?? null,
    rescheduled: invitee?.rescheduled ?? false,
    old_invitee_uri: invitee?.old_invitee ?? null,
    new_invitee_uri: invitee?.new_invitee ?? null,
    scheduling_method: invitee?.scheduling_method ?? null,
    invitee_scheduled_by_uri: invitee?.invitee_scheduled_by ?? null,
    routing_form_submission_uri: invitee?.routing_form_submission ?? null,
    payment: invitee?.payment ?? null,
    no_show: !!noShow,
    no_show_uri: noShow?.uri ?? null,
    reconfirmation: invitee?.reconfirmation ?? null,

    calendly_created_at: invitee?.created_at ?? null,
    calendly_updated_at: invitee?.updated_at ?? null,
  }
}
