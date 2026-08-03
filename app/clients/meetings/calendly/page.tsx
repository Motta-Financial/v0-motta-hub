import { redirect } from "next/navigation"

/** Legacy alias — forwards to the canonical /meetings/calendly. */
export default function LegacyClientMeetingsCalendlyPage() {
  redirect("/meetings/calendly")
}
