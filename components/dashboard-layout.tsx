"use client"

import type React from "react"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useUser, useDisplayName, useUserInitials, clearUserCache } from "@/contexts/user-context"
import { isLeadershipRole } from "@/lib/auth/leadership-roles"
import {
  LayoutDashboard,
  Users,
  Calendar,
  Settings,
  Menu,
  CheckSquare,
  UserCircle,
  Database,
  ArrowRightLeft,
  Trophy,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  MessageSquareHeart,
  ListChecks,
  ShieldCheck,
  CreditCard,
  LogOut,
  ClipboardList,
  Calculator,
  FileText,
  DollarSign,
  Workflow,
  BarChart3,
  Video,
  Bell,
  Radio,
  RefreshCw,
  TrendingUp,
  Lightbulb,
  Building2,
  Landmark,
  UserPlus,
  NotebookPen,
  Receipt,
  Briefcase,
  Repeat,
  Headphones,
  Inbox,
  Link2,
  ExternalLink,
  FilePlus2,
  Sparkles,
  Layers,
  Network,
  Share2,
  BookOpen,
  Palette,
  Wallet,
  Webhook,
  FolderKanban,
  Crown,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useRouter } from "next/navigation"
import { WorkItemSearchTrigger } from "@/components/work-item-search"

// Top-level sections are organised by *function*, not by team, and ordered
// to mirror how teammates actually use the app day-to-day. The five
// daily-driver pages (Triage, Work Items, Clients, Calendar, Debriefs) all
// live under "Home" so the root of the app stays the launchpad.
// "Departments" — the operational pipeline taxonomy (Tax / Accounting /
// Special Teams) — sits directly above "Sales" because most teammates
// open the app to find their work queue first; Sales follows as the
// proposal-to-payment lifecycle hub (incl. Payments + Ignition admin).
// "Talent" is the people side of the firm (directory + recognition).
// "Settings" absorbs both the legacy "Karbon Data" page and the
// engineer-facing "Admin" tools so non-admins see a single
// configuration entry-point.
const navigation = [
  // Home is the launchpad — everything that's part of a teammate's daily
  // driver workflow lives here. Calendar and Debriefs each have their own
  // sub-tree so things like /calendly and /debriefs/new are reachable.
  {
    name: "Home",
    href: "/",
    icon: LayoutDashboard,
    children: [
      // Triage is now the Dashboard tab on the Home page itself — see
      // components/triage-feed.tsx and components/dashboard-home.tsx.
      // The legacy /triage route still exists but redirects to /, so we
      // omit it from the sidebar to avoid a duplicate nav entry.
      // Projects is the engagement-level view (e.g. "Acme Corp — Monthly
      // Bookkeeping" rolls up 12 monthly Karbon work items). Work Items is
      // the task-level queue underneath — same data, different zoom level —
      // so it now lives as a child of Projects rather than as a sibling.
      // Both routes stay flat (/projects and /work-items) to preserve every
      // existing deep link, bookmark, and share-view URL.
      {
        name: "Projects",
        href: "/projects",
        icon: FolderKanban,
        children: [
          { name: "Work Items", href: "/work-items", icon: CheckSquare },
        ],
      },
      // Clients is the master roster, with Intake (inbound Jotform
      // submissions that become clients) and Feedback (post-engagement
      // NPS that drives referrals + recovery) nested underneath. Both
      // used to live in the Sales tree, but operationally they're
      // bookends of the client lifecycle, so they belong with the
      // client roster itself.
      {
        name: "Clients",
        href: "/clients",
        icon: Users,
        children: [
          { name: "Intake", href: "/sales/intake", icon: Inbox },
          { name: "Feedback", href: "/sales/feedback", icon: MessageSquareHeart },
        ],
      },
      // Meetings is now its OWN top-level Home section (it used to be
      // nested under Clients). The Team Calendar and Zoom dashboards —
      // previously their own top-level routes (/calendar, /zoom) — now
      // live underneath it alongside Calendly and Debriefs. All four are
      // "meeting surfaces," so grouping them here keeps every meeting
      // touchpoint in one place. The legacy URLs (/clients/meetings/*,
      // /calendar, /zoom, /debriefs) all redirect to /meetings/* so
      // existing bookmarks keep working.
      {
        name: "Meetings",
        href: "/meetings",
        icon: Calendar,
        children: [
          { name: "Calendar", href: "/meetings/calendar", icon: Calendar },
          { name: "Calendly", href: "/meetings/calendly", icon: Calendar },
          { name: "Zoom", href: "/meetings/zoom", icon: Video },
          // Debriefs is now expandable: the parent row + "All Debriefs"
          // both open the list at /meetings/debriefs, while "New Debrief"
          // jumps straight to the logging form (also reachable from the
          // header Forms dropdown). Keeping the list reachable from both
          // the parent row and an explicit child mirrors how the other
          // section parents behave.
          {
            name: "Debriefs",
            href: "/meetings/debriefs",
            icon: MessageSquare,
            children: [
              { name: "All Debriefs", href: "/meetings/debriefs", icon: MessageSquare },
              { name: "New Debrief", href: "/debriefs/new", icon: NotebookPen },
            ],
          },
        ],
      },
    ],
  },
  // "Departments" is the operational pipeline taxonomy and now lives
  // directly above Sales because the firm's day-to-day work happens here
  // — teammates scan Departments first to find the queue they own, then
  // drop into Sales for proposal/billing follow-ups. Onboarding moved
  // under Accounting because it's the kickoff step for every new
  // bookkeeping engagement.
  {
    name: "Departments",
    href: "/pipelines",
    icon: ClipboardList,
    children: [
      {
        name: "Accounting",
        href: "/accounting",
        icon: Calculator,
        children: [
          // "Project Plan" used to live here as a separate child route, but
          // its contents are now the Accounting Dashboard itself
          // (rendered by app/accounting/page.tsx via <ProjectPlanView />),
          // so the duplicate sidebar entry was removed.
          { name: "Bookkeeping", href: "/accounting/bookkeeping", icon: DollarSign },
          { name: "Onboarding", href: "/onboarding", icon: UserPlus },
        ],
      },
      {
        name: "Tax",
        href: "/tax",
        icon: FileText,
        children: [
          // ── ProConnect-backed Tax surfaces ───────────────────────────
          // Two top-level groupings now sit under Tax:
          //   • Clients — the PC roster joined onto the
          //     master_client_mapping view. Relationships (the entity ↔
          //     individual graph) nests under it because it's a lens on
          //     the same client population.
          //   • Returns — the unified return browser, with the three
          //     return-form views (Individual 1040, Business
          //     1065/1120/1120S, Nonprofit 990) nested as children since
          //     each one drills into a subset of what Returns lists.
          // Clients sits above Returns so the roster reads first, then
          // the work product. Settings stays a flat leaf at the bottom.
          {
            name: "Clients",
            href: "/tax/clients",
            icon: UserCircle,
            children: [
              { name: "Relationships", href: "/tax/relationships", icon: Network },
            ],
          },
          {
            name: "Returns",
            href: "/tax/returns",
            icon: FileText,
            children: [
              { name: "Individual (1040)", href: "/tax/individual", icon: Users },
              {
                name: "Business (1065/1120/1120S)",
                href: "/tax/business",
                icon: Building2,
              },
              { name: "Nonprofit (990)", href: "/tax/nonprofit", icon: Landmark },
            ],
          },
          { name: "Settings", href: "/tax/settings", icon: Settings },
        ],
      },
      // Special Teams is intentionally hidden from the sidebar for now.
      // The /special-teams page + its API routes still exist and remain
      // reachable by direct URL — this is purely a nav-visibility change,
      // so re-adding the entry here is the only step needed to restore it.
    ],
  },
  // Sales is the proposal-to-payment lifecycle hub. Payments and the
  // Ignition admin queue live here because they're the natural follow-on
  // to a signed proposal.
  {
    name: "Sales",
    href: "/sales",
    icon: BarChart3,
    children: [
      { name: "Sales Dashboard", href: "/sales/dashboard", icon: TrendingUp },
      // Recurring Revenue is the firm's headline KPI for the sales motion,
      // so it sits directly under the Sales Dashboard — every leader
      // checks "where are we vs MRR target" before drilling into the
      // funnel below.
      { name: "Recurring Revenue", href: "/sales/recurring-revenue", icon: Repeat },
      // Ignition is the proposal-to-payment engine, so Proposals,
      // Invoices, and Payments live underneath it as a single grouped
      // workflow (matches the way Ignition organizes them in its own
      // product). Ignition itself stays at /admin/ignition — the parent
      // entry just opens the admin queue / Zap setup.
      {
        name: "Ignition",
        href: "/admin/ignition",
        icon: Workflow,
        children: [
          { name: "Proposals", href: "/sales/proposals", icon: FileText },
          { name: "Invoices", href: "/sales/invoices", icon: Receipt },
          { name: "Payments", href: "/payments", icon: CreditCard },
        ],
      },
      // Intake (inbound Jotform → prospect → Ignition proposal) and
      // Feedback (post-engagement NPS) used to live here, but they
      // were moved under Clients in the Home tree because they're the
      // bookends of the client lifecycle, not a Sales-pipeline step.
      { name: "Services", href: "/sales/services", icon: Briefcase },
    ],
  },
  // "Talent" is the people side of the firm — directory + recognition.
  {
    name: "Talent",
    href: "/teammates",
    icon: UserCircle,
    children: [
      {
        // "Submit Ballot" used to live as a child here, but the ballot is
        // now surfaced exclusively through the header Forms dropdown.
        // The main Tommy Awards screen still links to /tommy-awards/ballot
        // from its primary CTA.
        name: "Tommy Awards",
        href: "/tommy-awards",
        icon: Trophy,
      },
      {
        // Motta Alliance — internal comic book series. Lives under
        // Talent because the heroes ARE the team; this is the people-
        // and-culture artifact of the firm, not an operational page.
        name: "Motta Alliance",
        href: "/motta-alliance",
        icon: BookOpen,
      },
      {
        // Training Library — Loom videos recorded by the team for
        // onboarding, SOPs, deep dives, and culture. Lives under Talent
        // because it's a people-development artifact (knowledge transfer
        // and ramp-up), not an operational pipeline page. The library
        // itself uses Loom's public oEmbed for inline playback; videos
        // are added manually (single URL) or via the bulk-paste tool.
        name: "Training",
        href: "/training",
        icon: Video,
      },
      {
        // Leadership ("PPD" — Partners, Principals, Directors) is a
        // restricted child only rendered for team_members.role values
        // matching `LEADERSHIP_ROLES` in lib/auth/require-leadership.
        // The actual page is also server-gated, so flipping this flag
        // is just a cosmetic hide — never the security boundary.
        name: "Leadership",
        href: "/talent/leadership",
        icon: Crown,
        requiresLeadership: true,
      },
    ],
  },
  // Settings is the personal hub for the signed-in user. The
  // sub-tree mirrors the /settings page's section order:
  //   - Account: Profile, Notifications
  //   - Connections: Calendly (per-user OAuth + setup)
  //   - Workspace: Users, Work Statuses
  //   - Admin: firm-wide data/integration tooling, nested under
  //     /settings/admin so it stays grouped without polluting the
  //     top-level Settings list.
  {
    name: "Settings",
    href: "/settings",
    icon: Settings,
    children: [
      { name: "Profile", href: "/settings/profile", icon: UserCircle },
      { name: "Notifications", href: "/settings/notifications", icon: Bell },
      { name: "Calendly", href: "/settings/calendly", icon: Calendar },
      { name: "Users", href: "/settings/users", icon: ShieldCheck },
      { name: "Work Statuses", href: "/settings/work-statuses", icon: ListChecks },
      { name: "Karbon Data", href: "/karbon-data", icon: Database },
      {
        name: "Admin",
        href: "/settings/admin",
        icon: ShieldCheck,
        children: [
          { name: "ALFRED AI", href: "/admin/alfred-ai", icon: Sparkles },
          { name: "Karbon Sync", href: "/admin/karbon-sync", icon: RefreshCw },
          { name: "Webhooks", href: "/admin/webhooks", icon: Webhook },
          { name: "Referrals", href: "/admin/referrals", icon: Share2 },
          {
            name: "Master Client Mapping",
            href: "/admin/master-client-mapping",
            icon: Network,
          },
          { name: "Unlinked Records", href: "/admin/unlinked-records", icon: Link2 },
          { name: "Broadcast", href: "/admin/broadcast", icon: Radio },
          { name: "Migrate Orgs", href: "/admin/migrate-orgs", icon: ArrowRightLeft },
          { name: "Work Statuses", href: "/admin/work-statuses", icon: ListChecks },
          { name: "Migration", href: "/settings/migration", icon: ArrowRightLeft },
        ],
      },
    ],
  },
]

interface DashboardLayoutProps {
  children: React.ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#EAE6E1" }}>
      {/* Top header banner - always visible */}
      <HubHeader sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Desktop sidebar - positioned below the header */}
      <div className="hidden md:fixed md:top-16 md:bottom-0 md:flex md:w-64 md:flex-col">
        <Sidebar />
      </div>

      {/* Main content. The sidebar is fixed-position 16rem wide, so the
          content area only needs ONE `md:pl-64` to clear it. The previous
          version stacked two of these, pushing content 32rem past the left
          edge and overflowing the viewport on the right. */}
      <div className="pt-16 md:pl-64">
        {/* Sticky topbar — gives every page a global Cmd+K work-item search.
            Lives outside <main> so its sticky behavior survives any page that
            applies its own positioning context. */}
        <div className="sticky top-0 z-30 border-b border-stone-200/70 bg-[#EAE6E1]/85 backdrop-blur supports-[backdrop-filter]:bg-[#EAE6E1]/60">
          <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-3 px-4 pl-14 sm:px-6 lg:px-8 md:pl-6">
            <div className="flex-1 max-w-xl">
              <WorkItemSearchTrigger />
            </div>
          </div>
        </div>
        <main className="py-6">
          {/* Bumped from `max-w-7xl` (1280px) to 1600px so wide-screen
              monitors actually use the available width instead of leaving a
              huge dead zone on the right of every dashboard. */}
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8">{children}</div>
        </main>
      </div>
    </div>
  )
}

function HubHeader({
  sidebarOpen,
  setSidebarOpen,
}: {
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}) {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-16 bg-white border-b shadow-sm"
      style={{ borderColor: "#8E9B79" }}
    >
      <div className="flex h-full items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          {/* Mobile menu trigger */}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-6 w-6" />
                <span className="sr-only">Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <Sidebar />
            </SheetContent>
          </Sheet>
          <a href="/" className="flex items-center gap-3">
            <img src="/images/alfred-logo.png" alt="ALFRED Hub" className="h-10 w-auto" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-wide" style={{ color: "#6B745D" }}>
                ALFRED HUB
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">A Motta Financial product</span>
            </div>
          </a>
        </div>
        <div className="flex items-center gap-2">
          <FormsMenu />
          <AiToolsMenu />
          <TechStackMenu />
          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5 text-gray-600" />
          </Button>
          <HeaderUserMenu />
        </div>
      </div>
    </header>
  )
}

// Does pathname match this node, or any descendant of it? Used both for
// auto-expansion and for parent-active highlighting. Recurses through the
// whole subtree so a deep grandchild match (e.g. /calendly while we're
// inside Home �� Calendar → Calendly Admin) still bubbles up to mark every
// ancestor as active and expanded.
function branchContainsActive(node: any, pathname: string): boolean {
  if (
    node.href &&
    node.href !== "/" &&
    (pathname === node.href || pathname.startsWith(node.href + "/"))
  ) {
    return true
  }
  if (node.children?.length) {
    return node.children.some((child: any) => branchContainsActive(child, pathname))
  }
  // Special-case the root: only mark Home as active when we're literally
  // on "/", not on every page (every pathname starts with "/").
  return node.href === "/" && pathname === "/"
}

// Walk the navigation tree and pre-expand every ancestor of the active
// route. Everything else stays collapsed so the sidebar is calm by default.
function buildInitialExpandedState(
  items: typeof navigation,
  pathname: string,
): Record<string, boolean> {
  const expanded: Record<string, boolean> = {}
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.children?.length) {
        const hasActive = node.children.some((child: any) =>
          branchContainsActive(child, pathname),
        )
        if (hasActive) expanded[node.name] = true
        walk(node.children)
      }
    }
  }
  walk(items as any[])
  return expanded
}

// ---------------------------------------------------------------------------
// Recursive sidebar node
// ---------------------------------------------------------------------------
// One component renders every level of the nav tree, so nesting depth is no
// longer capped (previously the renderer was hand-written for exactly three
// levels). Indentation and the parent→child guide line are both computed
// from `depth` in pixels rather than hard-coded Tailwind padding classes,
// which keeps deeper levels (e.g. Departments → Tax → Returns → Individual)
// aligned automatically. Every node that has children shows the SAME
// affordance — a subpage count badge + a left/down chevron — so it's always
// clear which rows expand.
const NAV_INDENT_BASE_PX = 8 // matches the old top-level pl-2
const NAV_INDENT_STEP_PX = 20 // per nesting level

// Motta sidebar palette — kept inline (not tokens) to match the rest of
// this component, which already styles via these literals.
const NAV_ACTIVE_BG = "#6B745D"
const NAV_HOVER_BG = "#8E9B79"
const NAV_ACTIVE_BORDER = "#333333"

function NavNode({
  node,
  depth,
  pathname,
  expandedSections,
  toggleSection,
  expandSection,
}: {
  node: any
  depth: number
  pathname: string
  expandedSections: Record<string, boolean>
  toggleSection: (name: string) => void
  expandSection: (name: string) => void
}) {
  const hasChildren = !!node.children?.length
  const isExpanded = expandedSections[node.name] || false

  // A node lights up when: it's the exact current route, OR (for leaves)
  // the path is nested under it, OR any descendant in its subtree is active
  // (so ancestors stay highlighted while collapsed). `branchContainsActive`
  // recurses the whole subtree, so this works at any depth.
  const isSelfCurrent = node.href !== "/" && pathname === node.href
  const isLeafNested =
    !hasChildren && node.href !== "/" && pathname.startsWith(node.href + "/")
  const isBranchActive =
    hasChildren && node.children.some((c: any) => branchContainsActive(c, pathname))
  const highlighted = isSelfCurrent || isLeafNested || isBranchActive

  const paddingLeft = NAV_INDENT_BASE_PX + depth * NAV_INDENT_STEP_PX
  const guideLeft = paddingLeft + 10 // sits under the icon center
  const iconSize = depth === 0 ? "h-5 w-5" : "h-4 w-4"

  return (
    <li>
      <div className="flex items-center">
        <a
          href={node.href}
          // Clicking the row navigates AND opens its subpages (never
          // collapses) so you never lose sight of where you are.
          // Collapsing is the chevron button's job.
          onClick={() => {
            if (hasChildren) expandSection(node.name)
          }}
          style={{
            paddingLeft,
            backgroundColor: highlighted ? NAV_ACTIVE_BG : "transparent",
            borderColor: highlighted ? NAV_ACTIVE_BORDER : "transparent",
          }}
          className={cn(
            highlighted ? "text-white border-r-2" : "text-gray-700 hover:text-white",
            "group flex flex-1 items-center gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
            depth > 0 && "text-sm",
          )}
          onMouseEnter={(e) => {
            if (!highlighted) e.currentTarget.style.backgroundColor = NAV_HOVER_BG
          }}
          onMouseLeave={(e) => {
            if (!highlighted) e.currentTarget.style.backgroundColor = "transparent"
          }}
        >
          <node.icon
            className={cn(
              highlighted ? "text-white" : "text-gray-400 group-hover:text-white",
              iconSize,
              "shrink-0",
            )}
            aria-hidden="true"
          />
          <span className="flex-1">{node.name}</span>
        </a>

        {hasChildren && (
          // Count badge + chevron rendered as a sibling <button> (valid
          // HTML — never a <button> inside the <a>). The same control at
          // every level makes "this row has subpages" unmistakable.
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault()
              toggleSection(node.name)
            }}
            aria-label={
              isExpanded
                ? `Collapse ${node.name} (${node.children.length} subpages)`
                : `Expand ${node.name} (${node.children.length} subpages)`
            }
            aria-expanded={isExpanded}
            className={cn(
              "mr-1 flex shrink-0 items-center gap-1 rounded-full px-1.5 py-1 transition-colors",
              highlighted ? "text-white hover:bg-white/15" : "text-gray-500 hover:bg-gray-100",
            )}
          >
            <span
              className={cn(
                "text-[10px] font-semibold tabular-nums leading-none",
                highlighted ? "text-white/80" : "text-gray-400",
              )}
            >
              {node.children.length}
            </span>
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {hasChildren && isExpanded && (
        // Vertical guide line connects children back to their parent. Drawn
        // as an explicit absolutely-positioned span (rather than a pseudo-
        // element) so its per-depth left offset can come straight from an
        // inline style — guaranteed to render at any nesting depth without
        // relying on Tailwind JIT picking up an arbitrary value. The span is
        // a sibling of (not inside) the <ul> so the list stays valid markup.
        <div className="relative mt-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-1 w-px bg-gray-200"
            style={{ left: guideLeft }}
          />
          <ul className="space-y-1">
            {node.children.map((child: any) => (
              <NavNode
                key={child.name}
                node={child}
                depth={depth + 1}
                pathname={pathname}
                expandedSections={expandedSections}
                toggleSection={toggleSection}
                expandSection={expandSection}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Header quick-launcher dropdowns
// ---------------------------------------------------------------------------
// We expose three sibling dropdowns in the global header:
//   - Forms       : internal Hub routes for fill-in-and-go forms
//   - Quick Links : AI assistants we use daily
//   - Tech Stack  : the external SaaS platforms that power the firm
//
// Every item -- internal or external -- opens in a NEW tab via
// `window.open(href, "_blank", "noopener,noreferrer")` so the Hub stays
// put behind it. noopener,noreferrer prevents the opened tab from
// gaining back-reference access to `window.opener`; modern browsers
// imply noopener for _blank, but we set it explicitly so the contract
// is obvious in code.
//
// All three menus share a single `HeaderLinkMenu` component below so
// styling and a11y stay in lockstep. Adding a new entry is a one-line
// constant edit; adding a new menu is a single <HeaderLinkMenu /> mount
// in the header JSX.

type HeaderMenuItem = {
  name: string
  href: string
  icon: typeof NotebookPen
  // Two ways to describe the item under its name. `description` is a
  // sentence ("Log a client meeting..."). `category` is a short tag
  // ("Ai", "Accounting") rendered as a muted prefix -- this is the
  // "Category | Vendor" pattern Motta uses for tech-stack links. Use
  // one or the other, not both.
  description?: string
  category?: string
}

const HEADER_FORMS: ReadonlyArray<HeaderMenuItem> = [
  {
    name: "Debrief Form",
    href: "/debriefs/new",
    description: "Log a client meeting or internal touchpoint",
    icon: NotebookPen,
  },
  {
    // Internal-only intake: a teammate just met or already has the
    // prospect's information and wants to capture it (plus their own
    // notes / screenshots) without making the prospect fill out the
    // public Jotform intake. The form lives at /prospects/new and
    // post-submit redirects to /prospects/[id] for review + the
    // "Create Karbon Work Item" action -- same UX as the intake page.
    name: "Prospect Form",
    href: "/prospects/new",
    description: "Capture a prospect you met or already have info on",
    icon: UserPlus,
  },
  {
    name: "Tommy Award Ballot",
    href: "/tommy-awards/ballot",
    description: "Nominate a teammate for this week's award",
    icon: Trophy,
  },
]

// AI assistants Motta uses daily. The top-line `name` is the
// friendly product-facing label (what teammates actually call the
// tool inside the firm); `category` is the underlying vendor that
// powers it, rendered as a muted subheader so it's obvious which
// account / provider the link opens to.
const HEADER_AI_TOOLS: ReadonlyArray<HeaderMenuItem> = [
  {
    name: "ALFRED GPT",
    href: "https://chatgpt.com/g/g-VZHJiFTtK-alfred",
    category: "OpenAI",
    icon: Sparkles,
  },
  {
    name: "Claude",
    href: "https://claude.ai/new",
    category: "Anthropic",
    icon: Sparkles,
  },
  {
    name: "Agent Builder",
    href: "https://mottafinancial.anyquest.ai/login",
    category: "AnyQuest",
    icon: Sparkles,
  },
]

// External SaaS platforms in Motta's tech stack. Grouped by the
// department / engagement-stage the tool serves so teammates can
// scan the dropdown by what they're trying to do (sell, bookkeep,
// run payroll, prep taxes, manage wealth) rather than memorize
// vendor names. Within each group the order matches the firm's
// preferred-vendor priority.
type HeaderMenuGroup = {
  label: string
  items: ReadonlyArray<HeaderMenuItem>
}

const HEADER_TECH_STACK: ReadonlyArray<HeaderMenuGroup> = [
  {
    label: "Sales & Marketing",
    items: [
      {
        name: "Ignition",
        href: "https://go.ignitionapp.com/home",
        category: "Proposals & Billing",
        icon: FileText,
      },
      {
        name: "Canva",
        href: "https://www.canva.com/",
        category: "Marketing",
        icon: Palette,
      },
    ],
  },
  {
    label: "Accounting",
    items: [
      {
        name: "QuickBooks Online",
        href: "https://accounts.intuit.com/app/sign-in?app_group=QBO&asset_alias=Intuit.accounting.core.qbowebapp&app_environment=prod&iux_redirect_reason=UNAUTHENTICATED",
        category: "Bookkeeping",
        icon: Calculator,
      },
      {
        name: "Aider",
        href: "https://advisory.app.aider.ai/advisory-dashboard",
        category: "FP&A",
        icon: BarChart3,
      },
      {
        name: "BizEquity",
        href: "https://motta.bizequity.com/login?redirectPath=%2Fuser%2Fcompanies",
        category: "Business Valuation",
        icon: TrendingUp,
      },
    ],
  },
  {
    label: "Payroll",
    items: [
      {
        name: "Gusto",
        // Long signed-state-bearing URL preserved verbatim from the
        // spec so the Keycloak SSO handoff keeps working; truncating
        // any query param breaks the redirect back into app.gusto.com.
        href: "https://login.gusto.com/realms/zenpayroll/protocol/openid-connect/auth?alert=&client_id=zenpayroll&device_uuid=dc674477-e4a7-486e-b8a6-85977088fbc1&redirect_to_partner=false&redirect_uri=https%3A%2F%2Fapp.gusto.com%2Fuser%2Fauth%2Fkeycloak_openid%2Fcallback&response_type=code&scope=openid&session_key=c8MUXiP45sLqa29q4STQ23qU9Jik0derlu5VgBOgAgg%3D&state=b0039a014aec9802c87b5fd2c91e29f20b40610d237e3860",
        category: "Payroll",
        icon: Wallet,
      },
      {
        name: "ADP",
        href: "https://online.adp.com/signin/v1/?APPID=AccountantConnect&productId=80e309c3-70cf-bae1-e053-3505430b5495&returnURL=https://runpayroll.adp.com/enrollment.aspx?lightbrand=accountantconnect&callingAppId=AccountantConnect&TARGET=-SM-https://runpayroll.adp.com/protected/auth.aspx?brand=45135cd7-de34-4a45-a9de-ef8c5a2d6fa6&auth=OLP&lightbrand=accountantconnect&lightbrand=accountantconnect",
        category: "Payroll",
        icon: Wallet,
      },
    ],
  },
  {
    label: "Tax",
    items: [
      {
        name: "ProConnect",
        href: "https://ito.intuit.com/app/protax/welcome?iux_intuit_tid=1-69ef56fb-7a6e28034d449fbb11b2852f",
        category: "Tax Prep",
        icon: Receipt,
      },
      {
        name: "ProConnect Tax Advisor",
        href: "https://taxadvisor.app.intuit.com/tax-advisor-ui/welcome",
        category: "Tax Advisory",
        icon: Lightbulb,
      },
    ],
  },
  {
    label: "Wealth Management",
    items: [
      {
        name: "Altruist",
        href: "https://app.altruist.com/dashboard",
        category: "Wealth Mgmt",
        icon: Briefcase,
      },
    ],
  },
]

function openInNewTab(href: string) {
  window.open(href, "_blank", "noopener,noreferrer")
}

// Render one row inside the dropdown -- pulled out so both the flat
// and grouped branches below stay tiny.
function HeaderMenuRow({ item }: { item: HeaderMenuItem }) {
  const Icon = item.icon
  return (
    <DropdownMenuItem
      onClick={() => openInNewTab(item.href)}
      className="cursor-pointer items-start gap-3 py-2.5"
    >
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: "#EAE6E1" }}
      >
        <Icon className="h-4 w-4" style={{ color: "#6B745D" }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
          {item.name}
          <ExternalLink className="h-3 w-3 text-gray-400" />
        </span>
        {item.description && (
          <span className="text-xs text-gray-500">{item.description}</span>
        )}
        {item.category && (
          <span className="text-xs text-gray-500">{item.category}</span>
        )}
      </span>
    </DropdownMenuItem>
  )
}

function HeaderLinkMenu({
  label,
  triggerIcon: TriggerIcon,
  groupLabel,
  items,
  groups,
  width = "w-72",
}: {
  label: string
  triggerIcon: typeof FilePlus2
  groupLabel: string
  // Pass `items` for a flat list (Forms, AI Tools) or `groups` for
  // a sectioned list with sub-headers between rows (Tech Stack).
  // Exactly one of the two must be provided.
  items?: ReadonlyArray<HeaderMenuItem>
  groups?: ReadonlyArray<HeaderMenuGroup>
  // Tech Stack rows have longer "Category | Vendor" labels, so we
  // widen that menu. Forms and AI Tools use the default.
  width?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
          aria-label={label}
        >
          <TriggerIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={width}>
        <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {groupLabel}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items?.map((item) => <HeaderMenuRow key={item.href} item={item} />)}
        {groups?.map((group, groupIdx) => (
          <div key={group.label}>
            {/* Section divider between groups; the menu's own top
                separator handles the gap above the first group, so
                we only need an extra separator for groups 2..N. */}
            {groupIdx > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {group.label}
            </DropdownMenuLabel>
            {group.items.map((item) => (
              <HeaderMenuRow key={item.href} item={item} />
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function FormsMenu() {
  return (
    <HeaderLinkMenu
      label="Forms"
      triggerIcon={FilePlus2}
      groupLabel="Quick Forms"
      items={HEADER_FORMS}
    />
  )
}

function AiToolsMenu() {
  return (
    <HeaderLinkMenu
      label="AI Tools"
      triggerIcon={Sparkles}
      groupLabel="AI Tools"
      items={HEADER_AI_TOOLS}
    />
  )
}

function TechStackMenu() {
  return (
    <HeaderLinkMenu
      label="Tech Stack"
      triggerIcon={Layers}
      groupLabel="Motta Tech Stack"
      groups={HEADER_TECH_STACK}
      width="w-80"
    />
  )
}

function HeaderUserMenu() {
  const { teamMember, user } = useUser()
  const displayName = useDisplayName()
  const initials = useUserInitials()
  const router = useRouter()

  const handleLogout = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" })
    if (response.ok) {
      // Clear the cached user data so the login page and any other pages
      // don't show stale profile info if the user logs back in.
      clearUserCache()
      router.push("/login")
    }
  }

  // When nobody is signed in, surface a Sign In affordance instead of
  // hiding the menu entirely. Without this the header looked empty on
  // every public-facing page and made the login flow undiscoverable.
  if (!user) {
    return (
      <Button
        size="sm"
        onClick={() => router.push("/login")}
        className="bg-[#6B745D] text-white hover:bg-[#8E9B79]"
      >
        <UserCircle className="mr-2 h-4 w-4" />
        Sign In
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-gray-900">{displayName}</span>
            <span className="text-xs text-gray-500">{teamMember?.title || teamMember?.role || "Team Member"}</span>
          </div>
          <Avatar className="h-9 w-9">
            <AvatarImage src={teamMember?.avatar_url || undefined} alt={displayName} />
            <AvatarFallback className="bg-[#6B745D] text-white text-sm">{initials}</AvatarFallback>
          </Avatar>
          <ChevronDown className="h-4 w-4 text-gray-400 hidden sm:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{displayName}</span>
            <span className="text-xs font-normal text-gray-500">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/settings/profile")}>
          <UserCircle className="mr-2 h-4 w-4" />
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings")}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} className="text-red-600">
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// localStorage key for the sidebar's expanded-sections map. The nav rows
// use plain `<a href>` (not Next.js Link) which means every click is a
// full reload — without persistence the sidebar would collapse every
// manually-opened section on each navigation. Bumping this key is the
// migration path if the shape of the value ever changes.
const SIDEBAR_EXPANDED_STORAGE_KEY = "motta:sidebar:expanded:v1"

/**
 * Recursively prune nav nodes that the current caller isn't allowed
 * to see. Today the only flag is `requiresLeadership` (PPD), but the
 * function is written generically so additional flags
 * (e.g. `requiresAdmin`) can be added without touching the rendering
 * logic. Returns a NEW array — never mutates `navigation`.
 *
 * IMPORTANT: this is a cosmetic UX hide only. The pages and API
 * routes that back these links MUST be server-gated independently
 * (see `requireLeadership()` / `requireAdmin()`).
 */
function filterNavigationByRole(
  items: any[],
  ctx: { isLeadership: boolean },
): any[] {
  return items
    .filter((item) => {
      if (item.requiresLeadership && !ctx.isLeadership) return false
      return true
    })
    .map((item) =>
      item.children
        ? { ...item, children: filterNavigationByRole(item.children, ctx) }
        : item,
    )
}

function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  // Pull the caller's role so we can hide leadership-only ("PPD")
  // nav entries from rank-and-file users. This is purely cosmetic;
  // the actual page + API routes are server-gated by
  // `requireLeadership()`. Falsy until UserProvider hydrates, which
  // means the link briefly stays hidden — preferred over a flash of
  // a link the user can't access.
  const { teamMember } = useUser()
  const isLeadership = isLeadershipRole(teamMember?.role)

  // Filter the static `navigation` tree based on the caller's role.
  // Currently the only `requiresLeadership` flag is on
  // Talent → Leadership, but the helper is recursive so any future
  // restricted nodes (admin sub-items, etc.) can flip a flag instead
  // of forking the tree.
  const visibleNavigation = filterNavigationByRole(navigation, { isLeadership })
  // Start with an empty state to avoid hydration mismatch. The server and
  // client must render identically on first paint — we cannot read
  // localStorage during SSR, and even `buildInitialExpandedState` can

  // differ if the server/client pathname diverges for a moment. After
  // hydration completes we populate the real expanded state from
  // localStorage + pathname in the effect below.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [hydrated, setHydrated] = useState(false)

  // Once mounted on the client, seed expanded sections from localStorage
  // ONLY. We deliberately do NOT pre-expand the active route's ancestors
  // — the user asked for the nav to start fully collapsed every load,
  // and to only open sections when they explicitly click them. Persisted
  // choices still win so a section the user opened earlier stays open
  // across reloads.
  useEffect(() => {
    let initial: Record<string, boolean> = {}
    try {
      const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          initial = parsed as Record<string, boolean>
        }
      }
    } catch {
      // Storage can throw in private mode; fall through to fully-collapsed.
    }
    setExpandedSections(initial)
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mirror every change to localStorage so the next page load restores
  // the same shape. We persist on every write rather than on unload to
  // tolerate hard reloads, browser crashes, and tab clones gracefully.
  // Skip until hydrated to avoid overwriting real data with the empty
  // initial state used during SSR.
  useEffect(() => {
    if (!hydrated) return
    try {
      window.localStorage.setItem(
        SIDEBAR_EXPANDED_STORAGE_KEY,
        JSON.stringify(expandedSections),
      )
    } catch {
      // Storage can throw in private mode or when the quota is full; the
      // sidebar still works in-session, just without persistence.
    }
  }, [expandedSections, hydrated])

  // Keep the *active* page's section visible: whenever the route changes,
  // merge in the expanded state for every ancestor of the current path.
  // This is purely additive — it OPENS the active branch but never closes
  // anything the user opened manually, so the "collapsed by default"
  // feel is preserved (nothing else springs open) while the page you're
  // actually on is always revealed in the tree. Runs after hydration so
  // it composes with the localStorage-restored state above.
  useEffect(() => {
    if (!hydrated) return
    const activeBranch = buildInitialExpandedState(visibleNavigation, pathname)
    if (Object.keys(activeBranch).length === 0) return
    setExpandedSections((prev) => {
      // Avoid a redundant state write (and localStorage churn) when every
      // active-branch ancestor is already expanded.
      const needsUpdate = Object.keys(activeBranch).some((name) => !prev[name])
      return needsUpdate ? { ...prev, ...activeBranch } : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, hydrated])

  const toggleSection = (name: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [name]: !prev[name],
    }))
  }

  // Used by parent/child *row* clicks (the link, not the chevron). Always
  // OPENS the section — never collapses — so navigating to a section
  // never hides its kids. Collapsing stays the chevron's job, which keeps
  // the link's primary purpose (navigate) and the chip's purpose
  // (expand/collapse) cleanly separated. No-op when already expanded.
  const expandSection = (name: string) => {
    setExpandedSections((prev) => (prev[name] ? prev : { ...prev, [name]: true }))
  }

  return (
    <div
      className="flex grow flex-col gap-y-5 overflow-y-auto bg-white px-6 pb-4 shadow-sm border-r"
      style={{ borderColor: "#8E9B79" }}
    >
      <nav className="flex flex-1 flex-col pt-6">
        <ul role="list" className="flex flex-1 flex-col gap-y-7">
          <li>
            <ul role="list" className="-mx-2 space-y-1">
              {/* The sidebar tree is now rendered by a single recursive
                  <NavNode> (defined above DashboardLayout). It supports
                  arbitrary nesting depth — Home → Meetings → Debriefs →
                  New Debrief and Departments → Tax → Returns → Individual
                  both go four levels deep — and gives every node that has
                  children the same count-badge + chevron affordance so
                  it's always obvious which rows expand. */}
              {visibleNavigation.map((item) => (
                <NavNode
                  key={item.name}
                  node={item}
                  depth={0}
                  pathname={pathname}
                  expandedSections={expandedSections}
                  toggleSection={toggleSection}
                  expandSection={expandSection}
                />
              ))}
            </ul>
          </li>
        </ul>
      </nav>

      <a
        href="https://alfred.motta.cpa"
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-xl p-4 transition-all hover:shadow-lg bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 mb-2"
      >
        <div className="flex items-center justify-center gap-3">
          <div className="relative">
            <img src="/images/alfred-logo.png" alt="ALFRED AI" className="h-10 w-auto" />
            <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-400 rounded-full border-2 border-white animate-pulse" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-gray-900 text-sm">ALFRED AI</p>
            <p className="text-xs text-gray-500">Your AI Assistant</p>
          </div>
        </div>
      </a>

      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span>ALFRED AI Online</span>
        </div>
      </div>
    </div>
  )
}

export default DashboardLayout
