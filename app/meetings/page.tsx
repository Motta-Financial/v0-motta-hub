import Link from "next/link"
import { Calendar, Video, MessageSquare, ArrowRight, CalendarClock } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * /meetings — Overview hub for the firm's meeting surfaces. Each tile
 * deep-links into its child route. We deliberately keep this static
 * (no live counts) so the page is fast and the data stays canonical to
 * the child dashboards — Calendly counts live in the Calendly
 * dashboard, Zoom counts live in the Zoom dashboard, etc.
 *
 * The DashboardLayout chrome + sticky sub-nav are owned by the parent
 * `app/meetings/layout.tsx`, so this page only renders the page body.
 */
export default function MeetingsOverviewPage() {
  const tiles = [
    {
      title: "Calendar",
      href: "/meetings/calendar",
      icon: CalendarClock,
      blurb:
        "Firm-wide meeting schedule across every connected Calendly account, with day/week/month/list views and a per-host filter.",
    },
    {
      title: "Calendly",
      href: "/meetings/calendly",
      icon: Calendar,
      blurb:
        "Scheduled invitees, no-shows, and the master calendar view across the firm. Auto-tags clients and work items at booking time.",
    },
    {
      title: "Zoom",
      href: "/meetings/zoom",
      icon: Video,
      blurb:
        "Recent meetings with participant rosters, recordings, and ALFRED triage suggestions for client + work-item linking.",
    },
    {
      title: "Debriefs",
      href: "/meetings/debriefs",
      icon: MessageSquare,
      blurb:
        "Post-meeting summaries, action items, and team-member assignments — one record per debrief that ties Calendly + Zoom together.",
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">Meetings</h1>
        <p className="text-sm text-stone-600 mt-1">
          The team calendar, Calendly bookings, Zoom recordings, and post-meeting debriefs in one place. Auto-linking from
          each surface flows into the master client mapping.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const Icon = tile.icon
          return (
            <Link key={tile.href} href={tile.href} className="group">
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-stone-100 p-2 group-hover:bg-stone-900 group-hover:text-white transition-colors">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-lg">{tile.title}</CardTitle>
                  </div>
                  <ArrowRight className="h-4 w-4 text-stone-400 transition-transform group-hover:translate-x-1 group-hover:text-stone-900" />
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm leading-relaxed">{tile.blurb}</CardDescription>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
