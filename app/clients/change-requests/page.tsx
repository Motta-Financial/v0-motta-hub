import { ChangeRequestsPanel } from "@/components/clients/change-requests-panel"

export const metadata = {
  title: "Change requests | Motta Hub",
  description: "Review and action detail changes clients have submitted from the portal.",
}

export default function ChangeRequestsPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Change requests</h1>
        <p className="text-sm text-muted-foreground">
          Review detail changes clients have submitted from their portal, then approve or dismiss them.
        </p>
      </div>
      <ChangeRequestsPanel />
    </div>
  )
}
