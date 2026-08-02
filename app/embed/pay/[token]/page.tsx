import { notFound } from "next/navigation"
import { getPaymentRequestByToken } from "@/lib/payments/requests"
import { getPackage } from "@/lib/payments/catalog"
import { getPublishableKey } from "@/lib/stripe"
import { PayClient } from "@/components/payments/pay-client"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Secure Payment | Motta Financial",
  robots: { index: false, follow: false },
}

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const req = await getPaymentRequestByToken(token)
  if (!req) notFound()

  // Confirm the package still resolves (so we fail fast on a deleted package).
  const pkg = req.service_package_id ? await getPackage(req.service_package_id) : null

  return (
    <PayClient
      token={token}
      initialStatus={req.status}
      packageName={req.package_name}
      amountCents={req.amount_cents}
      currency={req.currency}
      billingType={req.billing_type}
      recurringInterval={req.recurring_interval}
      memo={req.memo}
      recipientName={req.recipient_name}
      packageAvailable={!!pkg}
      publishableKey={getPublishableKey()}
    />
  )
}
