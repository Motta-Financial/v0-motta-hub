import Link from "next/link"
import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronRight,
  Database,
  GitMerge,
  Link2,
  ListChecks,
  Megaphone,
  RefreshCw,
  Sparkles,
  Video,
  Webhook,
  type LucideIcon,
} from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Admin hub — the firm-wide data and integration tooling that used to
 * live mixed in with the user Settings page. This is a child of
 * /settings (linked from the "Admin" section there) so the URL still
 * roots under user settings, but the contents are explicitly
 * operational rather than personal.
 *
 * Only links to routes that actually exist under app/ today. When a
 * new admin route ships, add it to the corresponding section here.
 */

type AdminItem = {
  name: string
  description: string
  href: string
  icon: LucideIcon
}

type AdminCategory = {
  title: string
  description: string
  items: AdminItem[]
}

const categories: AdminCategory[] = [
  {
    title: "Data & Integrations",
    description:
      "Wire external systems into Motta Hub and keep them in sync.",
    items: [
      {
        name: "Karbon Live Sync",
        description:
          "Webhook subscriptions, event log, and the reconciliation watchdog.",
        href: "/admin/karbon-sync",
        icon: RefreshCw,
      },
      {
        name: "Ignition",
        description:
          "Match unmapped Ignition clients, manage proposals, and view payment health.",
        href: "/admin/ignition",
        icon: Sparkles,
      },
      {
        name: "Webhook Integrations",
        description:
          "Jotform, Karbon, Calendly, Zoom, and Ignition webhook health in one console.",
        href: "/admin/webhooks",
        icon: Webhook,
      },
      {
        name: "Zoom Recordings",
        description:
          "Pull account-wide cloud recordings + transcripts for a date range, archive video to Blob, and monitor coverage.",
        href: "/admin/zoom-recordings",
        icon: Video,
      },
      {
        name: "Migration",
        description: "Migrate data from AirTable and other sources.",
        href: "/settings/migration",
        icon: ArrowRightLeft,
      },
    ],
  },
  {
    title: "Records & Mapping",
    description:
      "Resolve duplicates and link records across Karbon, Ignition, and ProConnect.",
    items: [
      {
        name: "Master Client Mapping",
        description: "Reconcile a single client identity across every system.",
        href: "/admin/master-client-mapping",
        icon: Link2,
      },
      {
        name: "Unlinked Records",
        description:
          "Triage records that haven't been matched to a contact or organization.",
        href: "/admin/unlinked-records",
        icon: Database,
      },
      {
        name: "Migrate Organizations",
        description:
          "Promote contacts to organizations and migrate downstream data.",
        href: "/admin/migrate-orgs",
        icon: GitMerge,
      },
    ],
  },
  {
    title: "Operations",
    description: "Day-to-day admin actions.",
    items: [
      {
        name: "Broadcast Email",
        description: "Send a firm-wide announcement to every team member.",
        href: "/admin/broadcast",
        icon: Megaphone,
      },
      {
        name: "Work Statuses (Admin)",
        description:
          "Audit which Karbon statuses exist and what's exposed to the rest of the app.",
        href: "/admin/work-statuses",
        icon: ListChecks,
      },
    ],
  },
]

export default function SettingsAdminPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link
            href="/settings"
            className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Settings
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-bold text-foreground">
              Admin
              <span className="ml-3 align-middle rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Settings · Admin
              </span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Firm-wide data, integrations, and operational tooling.
            </p>
          </div>
        </header>

        {categories.map((category) => (
          <section key={category.title} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-semibold text-foreground">
                {category.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                {category.description}
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {category.items.map((item) => (
                <AdminCard key={item.href} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </DashboardLayout>
  )
}

function AdminCard({ item }: { item: AdminItem }) {
  const Icon = item.icon
  return (
    <Link href={item.href} className="group">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/30">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <CardTitle className="text-base">{item.name}</CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  )
}
