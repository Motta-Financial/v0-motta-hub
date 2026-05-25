"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { Calendar, Video, MessageSquare, Network } from "lucide-react"
import { cn } from "@/lib/utils"
import { DashboardLayout } from "@/components/dashboard-layout"

/**
 * Shared layout for /clients/meetings/* — renders a sub-nav so the
 * three meeting surfaces (Calendly invitees, Zoom recordings,
 * post-meeting Debriefs) feel like one tabbed product instead of
 * three orphaned top-level routes. The actual meeting data lives in
 * the existing dashboards we wrap here; this file is purely chrome.
 *
 * Why a sub-nav and not Tabs? The three child pages are full route
 * segments (each has its own URL, search params, and back-button
 * history) — that&apos;s the whole reason we&apos;re grouping them under
 * /clients/meetings instead of collapsing them into one tabbed page.
 * Sub-nav is the App Router-friendly pattern for that shape.
 */
export default function ClientMeetingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Each tab is a real route. The "Overview" tab is the bare
  // /clients/meetings entry — only treated active on exact match so
  // it doesn&apos;t light up while you&apos;re inside a child.
  const tabs = [
    {
      label: "Overview",
      href: "/clients/meetings",
      icon: Network,
      activeFor: (p: string) => p === "/clients/meetings",
    },
    {
      label: "Calendly",
      href: "/clients/meetings/calendly",
      icon: Calendar,
      activeFor: (p: string) => p.startsWith("/clients/meetings/calendly"),
    },
    {
      label: "Zoom",
      href: "/clients/meetings/zoom",
      icon: Video,
      activeFor: (p: string) => p.startsWith("/clients/meetings/zoom"),
    },
    {
      label: "Debriefs",
      href: "/clients/meetings/debriefs",
      icon: MessageSquare,
      activeFor: (p: string) => p.startsWith("/clients/meetings/debriefs"),
    },
  ]

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        {/* Sticky tab bar so the user can pivot between Calendly /
            Zoom / Debriefs without scrolling back to the top of long
            tables. Mirrors the sticky tab pattern used on the client
            profile page. */}
        <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-stone-200">
          <nav className="flex flex-wrap gap-1" aria-label="Meetings sub-navigation">
            {tabs.map((tab) => {
              const active = tab.activeFor(pathname)
              const Icon = tab.icon
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-stone-900 text-white"
                      : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {children}
      </div>
    </DashboardLayout>
  )
}
