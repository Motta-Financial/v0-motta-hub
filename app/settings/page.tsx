import Link from "next/link"
import {
  ArrowRightLeft,
  Bell,
  Calendar as CalendarIcon,
  ChevronRight,
  ListChecks,
  Settings as SettingsIcon,
  ShieldCheck,
  UserCircle,
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
 * The Settings page is the personal hub for the signed-in user. It
 * intentionally avoids firm-wide data-integration tooling (which now
 * lives at /settings/admin) — every link here should be something a
 * non-admin user has reason to click for their own account.
 *
 * Sub-pages that don't actually exist yet have been removed (the
 * previous version linked to /settings/services, /settings/security,
 * etc. which all 404'd). Add a new card here only after the
 * corresponding route exists under app/settings.
 */

type SettingsItem = {
  name: string
  description: string
  href: string
  icon: LucideIcon
  badge?: string
}

type SettingsCategory = {
  title: string
  description: string
  items: SettingsItem[]
}

const categories: SettingsCategory[] = [
  {
    title: "Account",
    description: "Settings that follow you across the firm.",
    items: [
      {
        name: "Profile",
        description: "Edit your name, photo, contact info, and timezone.",
        href: "/settings/profile",
        icon: UserCircle,
      },
      {
        name: "Notifications",
        description: "Choose which events you want emails or in-app pings for.",
        href: "/settings/notifications",
        icon: Bell,
      },
    ],
  },
  {
    title: "Connections",
    description:
      "Personal integrations tied to your account. Each one walks you through any required setup.",
    items: [
      {
        name: "Calendly",
        description:
          "Connect your Calendly account, manage the OAuth scopes, and view your upcoming events and event types.",
        href: "/settings/calendly",
        icon: CalendarIcon,
      },
    ],
  },
  {
    title: "Workspace",
    description: "Shared settings that affect what your teammates see.",
    items: [
      {
        name: "Users",
        description: "Invite teammates and manage their app permissions.",
        href: "/settings/users",
        icon: ShieldCheck,
      },
      {
        name: "Work Statuses",
        description:
          "Pick which Karbon work-item statuses appear in dashboards and filters.",
        href: "/settings/work-statuses",
        icon: ListChecks,
      },
    ],
  },
]

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your account, personal connections, and shared workspace
            preferences.
          </p>
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
                <SettingsCard key={item.href} item={item} />
              ))}
            </div>
          </section>
        ))}

        {/*
          The Admin card is set apart in its own section because the
          link leads outside the user-scope of this page — it covers
          firm-wide data and integration tooling that not every user
          will have a reason to open.
         */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold text-foreground">Admin</h2>
            <p className="text-sm text-muted-foreground">
              Firm-wide data, integrations, and operational tooling.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <SettingsCard
              item={{
                name: "Data & Integrations",
                description:
                  "Karbon sync, webhooks, migrations, broadcasts, and the master client mapping tools.",
                href: "/settings/admin",
                icon: SettingsIcon,
                badge: "Admin",
              }}
            />
          </div>
        </section>
      </div>
    </DashboardLayout>
  )
}

function SettingsCard({ item }: { item: SettingsItem }) {
  const Icon = item.icon
  return (
    <Link href={item.href} className="group">
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-accent/30">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex items-center gap-2">
            {item.badge ? (
              <span className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {item.badge}
              </span>
            ) : null}
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <CardTitle className="text-base">{item.name}</CardTitle>
          <CardDescription>{item.description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  )
}
