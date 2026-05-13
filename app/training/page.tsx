import { DashboardLayout } from "@/components/dashboard-layout"
import { TrainingLibrary } from "@/components/training/training-library"

export const metadata = {
  title: "Training Library | Motta Hub",
  description:
    "Browse and search Loom training videos recorded by the Motta Financial team.",
}

export default function TrainingPage() {
  return (
    <DashboardLayout>
      <TrainingLibrary />
    </DashboardLayout>
  )
}
