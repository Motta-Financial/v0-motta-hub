import { Suspense } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { ResourcesHub } from "@/components/resources/resources-hub"

export const metadata = {
  title: "Resources | ALFRED Hub",
  description:
    "Team instructions, SOPs, FAQ, client resources, and templates for running ALFRED Hub.",
}

export default function ResourcesPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-stone-100" />}>
        <ResourcesHub />
      </Suspense>
    </DashboardLayout>
  )
}
