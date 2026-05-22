import { DashboardLayout } from "@/components/dashboard-layout"
import { ProconnectConnectionCard } from "@/components/tax/proconnect-connection-card"
import { ProconnectFullImportCard } from "@/components/tax/proconnect-full-import-card"
import { ProconnectProfilesCard } from "@/components/tax/proconnect-profiles-card"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Tax Settings | Motta Hub",
  description:
    "Manage the ProConnect Tax integration powering the /tax dashboard — OAuth connection, sync state, and webhook activity.",
}

// ── /tax/settings — ProConnect connection + sync admin ─────────────
// Surfaces the connection card so partners can connect, reconnect, or
// disconnect the Intuit Developer app powering /tax/* without leaving
// Motta Hub. Anything ProConnect-admin (token state, recent webhooks,
// sync watermarks) lives here so the operational surfaces stay clean.
export default function TaxSettingsPage() {
  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Tax settings
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            Manage the ProConnect Tax integration. All <code className="rounded bg-muted px-1 py-0.5 text-xs">/tax/*</code>{" "}
            pages read from the synced data below.
          </p>
        </header>

        <ProconnectConnectionCard />
        <ProconnectFullImportCard />
        <ProconnectProfilesCard />
      </div>
    </DashboardLayout>
  )
}
