import { redirect } from "next/navigation"

/** Legacy alias — forwards to the canonical /meetings/debriefs. */
export default function LegacyClientMeetingsDebriefsPage() {
  redirect("/meetings/debriefs")
}
