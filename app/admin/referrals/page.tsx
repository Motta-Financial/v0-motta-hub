import type { Metadata } from "next"
import { ReferralsAdmin } from "@/components/admin/referrals-admin"

export const metadata: Metadata = {
  title: "Referrals · Motta Hub Admin",
  description: "Top referrers, resolution work queue, and data-quality flags.",
}

export default function ReferralsAdminPage() {
  return <ReferralsAdmin />
}
