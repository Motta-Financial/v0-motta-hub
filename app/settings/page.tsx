import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  ArrowRightLeft,
  Webhook,
  ListChecks,
  Database,
  Users,
  Building2,
  FileText,
  Bell,
  Shield,
  Palette,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"

const settingsCategories = [
  {
    title: "Data & Integrations",
    description: "Manage your data sources and external integrations",
    items: [
      {
        name: "Migration",
        description: "Migrate data from AirTable and other sources",
        href: "/settings/migration",
        icon: ArrowRightLeft,
      },
      {
        name: "Webhooks",
        description: "Configure webhook endpoints for real-time data sync",
        href: "/settings/webhooks",
        icon: Webhook,
      },
      {
        name: "Work Statuses",
        description: "Manage Karbon work item status filters",
        href: "/settings/work-statuses",
        icon: ListChecks,
      },
      {
        name: "Database",
        description: "View and manage Supabase database tables",
        href: "/settings/database",
        icon: Database,
      },
    ],
  },
  {
    title: "Organization",
    description: "Configure your organization settings",
    items: [
      {
        name: "Team Members",
        description: "Manage team member profiles and permissions",
        href: "/settings/team",
        icon: Users,
      },
      {
        name: "Organizations",
        description: "Manage client organizations and contacts",
        href: "/settings/organizations",
        icon: Building2,
      },
      {
        name: "Services",
        description: "Configure service offerings and pricing",
        href: "/settings/services",
        icon: FileText,
      },
    ],
  },
  {
    title: "Preferences",
    description: "Customize your experience",
    items: [
      {
        name: "Notifications",
        description: "Configure email and in-app notifications",
        href: "/settings/notifications",
        icon: Bell,
      },
      {
        name: "Security",
        description: "Manage authentication and access controls",
        href: "/settings/security",
        icon: Shield,
      },
      {
        name: "Appearance",
        description: "Customize the look and feel of Motta Hub",
        href: "/settings/appearance",
        icon: Palette,
      },
    ],
  },
]

export default function SettingsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="mt-2 text-gray-600">Manage your Motta Hub configuration, integrations, and preferences.</p>
        </div>

        <div className="space-y-8">
          {settingsCategories.map((category) => (
            <div key={category.title}>
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-gray-900">{category.title}</h2>
                <p className="text-sm text-gray-500">{category.description}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {category.items.map((item) => (
                  <Link key={item.name} href={item.href}>
                    <Card className="h-full transition-all hover:shadow-md hover:border-[#8E9B79] cursor-pointer group">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="p-2 rounded-lg transition-colors" style={{ backgroundColor: "#EAE6E1" }}>
                            <item.icon className="h-5 w-5" style={{ color: "#6B745D" }} />
                          </div>
                          <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                        </div>
                        <CardTitle className="text-base mt-3">{item.name}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <CardDescription>{item.description}</CardDescription>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  )
}
