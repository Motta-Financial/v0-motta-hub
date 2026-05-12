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
  Flame,
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
  BookOpen,
  Palette,
  Wallet,
  Webhook,
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
      { name: "Work Items", href: "/work-items", icon: CheckSquare },
      { name: "Clients", href: "/clients", icon: Users },
      {
        // Calendly used to live as a child here ("Calendly Admin").
        // It moved to /settings/calendly so it sits alongside the
        // other per-user OAuth connections (and the old /calendly
        // URL now server-redirects there). Zoom stays since it's a
        // shared meeting room view, not a per-user setup screen.
        name: "Calendar",
        href: "/calendar",
        icon: Calendar,
        children: [{ name: "Zoom", href: "/zoom", icon: Video }],
      },
      {
        // "New Debrief" used to live as a child here, but the form is now
        // surfaced exclusively through the header Forms dropdown (alongside
        // Prospect Form + Tommy Award Ballot). The Debriefs hub itself has
        // a "+ New Debrief" button on its own page, so keeping a sidebar
        // child was redundant.
        name: "Debriefs",
        href: "/debriefs",
        icon: MessageSquare,
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
          // Ordered from "all returns at a glance" down to "single
          // client roster". The four return-form pages (Individual,
          // Business, Nonprofit) each drill into one or more PC tables;
          // Returns is the unified browser; Clients is the PC roster
          // joined onto the master_client_mapping view.
          { name: "Returns", href: "/tax/returns", icon: FileText },
          { name: "Individual (1040)", href: "/tax/individual", icon: Users },
          {
            name: "Business (1065/1120/1120S)",
            href: "/tax/business",
            icon: Building2,
          },
          { name: "Nonprofit (990)", href: "/tax/nonprofit", icon: Landmark },
          { name: "Clients", href: "/tax/clients", icon: UserCircle },
        ],
      },
      { name: "Special Teams", href: "/special-teams", icon: Flame },
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
      // Inbound prospects from the embedded Jotform on
      // mottafinancial.com/intake-form. Sits below Ignition because a
      // submission's natural next step is to become an Ignition proposal.
      { name: "Intake", href: "/sales/intake", icon: Inbox },
      { name: "Services", href: "/sales/services", icon: Briefcase },
      // Feedback is the closing of the loop — it drives referrals
      // (new pipeline) and detractor recovery (retention), so it lives
      // at the bottom of the Sales tree as the post-engagement step.
      { name: "Feedback", href: "/sales/feedback", icon: MessageSquareHeart },
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
          { name: "Karbon Sync", href: "/admin/karbon-sync", icon: RefreshCw },
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
          { name: "Webhooks", href: "/settings/webhooks", icon: Webhook },
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
            <img src="/images/alfred-logo.png" alt="Motta Hub" className="h-10 w-auto" />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-bold tracking-wide" style={{ color: "#6B745D" }}>
                MOTTA HUB
              </span>
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Powered by ALFRED AI</span>
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

function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  // Start with an empty state to avoid hydration mismatch. The server and
  // client must render identically on first paint — we cannot read
  // localStorage during SSR, and even `buildInitialExpandedState` can

  // differ if the server/client pathname diverges for a moment. After
  // hydration completes we populate the real expanded state from
  // localStorage + pathname in the effect below.
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})
  const [hydrated, setHydrated] = useState(false)

  // Once mounted on the client, seed expanded sections from localStorage
  // and the active route. This runs only once after hydration so the
  // server/client first-render is identical (empty → avoids mismatch).
  useEffect(() => {
    const seed = buildInitialExpandedState(navigation, pathname)
    let initial = seed
    try {
      const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") {
          // Merge persisted choices over active-ancestor seed — this way
          // an explicitly-collapsed section the user closed earlier stays
          // closed unless it's an ancestor of the current page.
          initial = { ...parsed, ...seed }
        }
      }
    } catch {
      // Storage can throw in private mode; continue with seed.
    }
    setExpandedSections(initial)
    setHydrated(true)
    // Only run on mount — pathname changes are handled by a separate effect.
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

  // When the user navigates between pages we want the new active section to
  // auto-open, but we deliberately MERGE rather than replace so that any
  // sibling sections the user manually opened stay open. The only thing we
  // ever flip here is `true` for ancestors of the new pathname — never
  // `false`, so the sidebar never yanks something closed underneath them.
  useEffect(() => {
    const activeAncestors = buildInitialExpandedState(navigation, pathname)
    if (Object.keys(activeAncestors).length === 0) return
    setExpandedSections((prev) => {
      let changed = false
      const next = { ...prev }
      for (const key of Object.keys(activeAncestors)) {
        if (!next[key]) {
          next[key] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [pathname])

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

  // Recurses through the entire subtree so a parent like Home stays
  // highlighted even when the active route is a grandchild (e.g.
  // /calendly under Home → Calendar → Calendly Admin).
  const hasActiveChild = (children?: any[]) => {
    if (!children?.length) return false
    return children.some((child: any) => branchContainsActive(child, pathname))
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
              {navigation.map((item) => {
                const hasChildren = item.children && item.children.length > 0
                const isExpanded = expandedSections[item.name] || false
                const isParentActive = hasActiveChild(item.children)
                const isCurrent =
                  pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href) && !hasChildren)

                return (
                  <li key={item.name}>
                    <div className="flex items-center">
                      <a
                        href={item.href}
                        // Clicking the row opens its subpages alongside the
                        // navigation. Skipped when there are no children so
                        // we don't pay for unnecessary state writes on leaf
                        // nav items.
                        onClick={() => {
                          if (hasChildren) expandSection(item.name)
                        }}
                        className={cn(
                          isCurrent || isParentActive
                            ? "text-white border-r-2"
                            : "text-gray-700 hover:text-white hover:bg-opacity-80",
                          "pl-2 group flex flex-1 gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                        )}
                        style={{
                          backgroundColor: isCurrent || isParentActive ? "#6B745D" : "transparent",
                          borderColor: isCurrent || isParentActive ? "#333333" : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!isCurrent && !isParentActive) {
                            e.currentTarget.style.backgroundColor = "#8E9B79"
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isCurrent && !isParentActive) {
                            e.currentTarget.style.backgroundColor = "transparent"
                          }
                        }}
                      >
                        <item.icon
                          className={cn(
                            isCurrent || isParentActive ? "text-white" : "text-gray-400 group-hover:text-white",
                            "h-5 w-5 shrink-0",
                          )}
                          aria-hidden="true"
                        />
                        {/* `flex-1` on the label pushes the chevron to a
                            consistent right-edge position across every
                            parent row, so all chevrons line up
                            vertically regardless of label length. */}
                        <span className="flex-1">{item.name}</span>
                        {/* Right-aligned chevron — single dropdown
                            affordance per parent. Implemented as a
                            `<span role="button">` because a real
                            <button> inside an <a> is invalid HTML. The
                            role + tabIndex + keyboard handler give it
                            the same accessibility semantics as a
                            button, and stopPropagation prevents the
                            parent <a>'s click handler from also firing
                            — clicking the chevron toggles open/closed
                            only, while clicking the row still navigates
                            and auto-expands. */}
                        {hasChildren && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              toggleSection(item.name)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                e.stopPropagation()
                                toggleSection(item.name)
                              }
                            }}
                            aria-label={
                              isExpanded
                                ? `Collapse ${item.name} (${item.children!.length} subpages)`
                                : `Expand ${item.name} (${item.children!.length} subpages)`
                            }
                            aria-expanded={isExpanded}
                            className={cn(
                              "-mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors cursor-pointer",
                              isCurrent || isParentActive
                                ? "text-white/80 hover:bg-white/15 hover:text-white"
                                : "text-gray-400 hover:bg-gray-100 hover:text-gray-700",
                            )}
                          >
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 transition-transform duration-200",
                                isExpanded ? "rotate-0" : "-rotate-90",
                              )}
                              aria-hidden="true"
                            />
                          </span>
                        )}
                      </a>
                    </div>

                    {hasChildren && isExpanded && (
                      // Vertical guide line connects children back to their
                      // parent visually. The pseudo-element is positioned at
                      // 18px from the ul's left edge — that lines up with the
                      // right edge of the parent icon, so the eye traces a
                      // clean L-path from parent down through its kids
                      // without shifting any row's actual indent.
                      <ul
                        className="relative mt-1 space-y-1 before:absolute before:bottom-1 before:left-[18px] before:top-1 before:w-px before:bg-gray-200 before:content-['']"
                      >
                        {(item.children as any[])!.map((child: any) => {
                          const isChildCurrent = pathname === child.href || pathname.startsWith(child.href + "/")
                          const hasGrandchildren = child.children && child.children.length > 0
                          const isChildExpanded = expandedSections[child.name] || false
                          const hasActiveGrandchild =
                            hasGrandchildren &&
                            child.children!.some(
                              (gc: any) => pathname === gc.href || pathname.startsWith(gc.href + "/"),
                            )

                          return (
                            <li key={child.name}>
                              <div className="flex items-center">
                                <a
                                  href={child.href}
                                  // Same expand-on-navigate behavior as the
                                  // parent row, scoped to whichever child
                                  // has its own grandchildren (e.g. Talent →
                                  // Tommy Awards → Submit Ballot).
                                  onClick={() => {
                                    if (hasGrandchildren) expandSection(child.name)
                                  }}
                                  className={cn(
                                    isChildCurrent || hasActiveGrandchild
                                      ? "text-white border-r-2"
                                      : "text-gray-700 hover:text-white hover:bg-opacity-80",
                                    "pl-8 text-sm group flex flex-1 gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                                  )}
                                  style={{
                                    backgroundColor: isChildCurrent || hasActiveGrandchild ? "#6B745D" : "transparent",
                                    borderColor: isChildCurrent || hasActiveGrandchild ? "#333333" : "transparent",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (!isChildCurrent && !hasActiveGrandchild) {
                                      e.currentTarget.style.backgroundColor = "#8E9B79"
                                    }
                                  }}
                                  onMouseLeave={(e) => {
                                    if (!isChildCurrent && !hasActiveGrandchild) {
                                      e.currentTarget.style.backgroundColor = "transparent"
                                    }
                                  }}
                                >
                                  <child.icon
                                    className={cn(
                                      isChildCurrent || hasActiveGrandchild
                                        ? "text-white"
                                        : "text-gray-400 group-hover:text-white",
                                      "h-4 w-4 shrink-0",
                                    )}
                                    aria-hidden="true"
                                  />
                                  <span className="flex-1">{child.name}</span>
                                </a>
                                {hasGrandchildren && (
                                  <button
                                    onClick={(e) => {
                                      e.preventDefault()
                                      toggleSection(child.name)
                                    }}
                                    aria-label={
                                      isChildExpanded
                                        ? `Collapse ${child.name} (${child.children!.length} subpages)`
                                        : `Expand ${child.name} (${child.children!.length} subpages)`
                                    }
                                    aria-expanded={isChildExpanded}
                                    className={cn(
                                      "mr-1 flex items-center gap-1 rounded-full px-1.5 py-1 transition-colors",
                                      isChildCurrent || hasActiveGrandchild
                                        ? "text-white hover:bg-white/15"
                                        : "text-gray-500 hover:bg-gray-100",
                                    )}
                                  >
                                    <span
                                      className={cn(
                                        "text-[10px] font-semibold tabular-nums leading-none",
                                        isChildCurrent || hasActiveGrandchild
                                          ? "text-white/80"
                                          : "text-gray-400",
                                      )}
                                    >
                                      {child.children!.length}
                                    </span>
                                    {isChildExpanded ? (
                                      <ChevronDown className="h-4 w-4" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4" />
                                    )}
                                  </button>
                                )}
                              </div>

                              {hasGrandchildren && isChildExpanded && (
                                // Same guide-line pattern, but at 40px to
                                // sit under the child icon (one indent level
                                // deeper than the parent guide above).
                                <ul
                                  className="relative mt-1 space-y-1 before:absolute before:bottom-1 before:left-[40px] before:top-1 before:w-px before:bg-gray-200 before:content-['']"
                                >
                                  {child.children!.map((grandchild: any) => {
                                    const isGrandchildCurrent =
                                      pathname === grandchild.href || pathname.startsWith(grandchild.href + "/")

                                    return (
                                      <li key={grandchild.name}>
                                        <a
                                          href={grandchild.href}
                                          className={cn(
                                            isGrandchildCurrent
                                              ? "text-white border-r-2"
                                              : "text-gray-700 hover:text-white hover:bg-opacity-80",
                                            "pl-12 text-sm group flex gap-x-3 rounded-l-md py-2 pr-3 leading-6 font-medium transition-colors relative",
                                          )}
                                          style={{
                                            backgroundColor: isGrandchildCurrent ? "#6B745D" : "transparent",
                                            borderColor: isGrandchildCurrent ? "#333333" : "transparent",
                                          }}
                                          onMouseEnter={(e) => {
                                            if (!isGrandchildCurrent) {
                                              e.currentTarget.style.backgroundColor = "#8E9B79"
                                            }
                                          }}
                                          onMouseLeave={(e) => {
                                            if (!isGrandchildCurrent) {
                                              e.currentTarget.style.backgroundColor = "transparent"
                                            }
                                          }}
                                        >
                                          <grandchild.icon
                                            className={cn(
                                              isGrandchildCurrent
                                                ? "text-white"
                                                : "text-gray-400 group-hover:text-white",
                                              "h-4 w-4 shrink-0",
                                            )}
                                            aria-hidden="true"
                                          />
                                          <span className="flex-1">{grandchild.name}</span>
                                        </a>
                                      </li>
                                    )
                                  })}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </li>
                )
              })}
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
