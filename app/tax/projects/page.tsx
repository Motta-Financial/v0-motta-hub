import { Suspense } from "react"
import { TaxProjectsClient } from "@/components/tax/tax-projects-client"

export default function TaxProjectsPage() {
  return (
    <Suspense fallback={null}>
      <TaxProjectsClient />
    </Suspense>
  )
}
