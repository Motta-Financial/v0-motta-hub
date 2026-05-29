import { redirect } from "next/navigation"

/** Legacy alias — forwards to the canonical /meetings/zoom. */
export default function LegacyClientMeetingsZoomPage() {
  redirect("/meetings/zoom")
}
