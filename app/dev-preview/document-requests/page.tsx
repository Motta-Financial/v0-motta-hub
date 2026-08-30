/**
 * TEMPORARY verification-only route — no auth required.
 * Renders the two new document-request-checklist screens side by side
 * with mock data so they can be visually checked without signing in as
 * any real staff or client account. Delete this file once verified.
 */
import { DocumentRequestChecklistStaff } from "@/components/clients/document-request-checklist-staff"
import { DocumentRequestChecklistClient } from "@/components/portal/document-request-checklist-client"

export default function DevPreviewPage() {
  return (
    <div className="flex flex-col gap-10 bg-background p-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Screen 1 — Staff (Hub)
        </h2>
        <DocumentRequestChecklistStaff clientName="The Elden House LLC" />
      </section>
      <section className="bg-gray-50 p-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Screen 2 — Client (Portal)
        </h2>
        <div className="max-w-2xl">
          <DocumentRequestChecklistClient />
        </div>
      </section>
    </div>
  )
}
