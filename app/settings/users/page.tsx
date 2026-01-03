import { DashboardLayout } from "@/components/dashboard-layout"
import { UserAuthManager } from "@/components/user-auth-manager"

export default function UsersSettingsPage() {
  return (
    <DashboardLayout>
      <UserAuthManager />
    </DashboardLayout>
  )
}
