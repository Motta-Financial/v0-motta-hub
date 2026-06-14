"use client"

import { useCallback, useState } from "react"
import { loadStripe } from "@stripe/stripe-js"
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js"
import { Loader2, ShieldCheck, AlertTriangle } from "lucide-react"

type BillingType = "one_time" | "recurring"
type RequestStatus = "pending" | "paid" | "canceled" | "expired"

interface PayClientProps {
  token: string
  initialStatus: RequestStatus
  packageName: string
  amountCents: number
  currency: string
  billingType: BillingType
  recurringInterval: "month" | "quarter" | "year" | null
  memo: string | null
  recipientName: string | null
  packageAvailable: boolean
  publishableKey: string
}

const FIRM_NAME = "Motta Financial"

const intervalLabel: Record<string, string> = {
  month: "Billed monthly",
  quarter: "Billed quarterly",
  year: "Billed annually",
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase(),
  }).format(cents / 100)
}

// Cache the Stripe.js promise per publishable key so we don't re-init on every
// render. Created at module scope keyed by the value passed from the server.
let stripePromiseKey = ""
let stripePromiseValue: ReturnType<typeof loadStripe> | null = null
function getStripePromise(key: string) {
  if (!key) return null
  if (stripePromiseKey !== key) {
    stripePromiseKey = key
    stripePromiseValue = loadStripe(key)
  }
  return stripePromiseValue
}

export function PayClient(props: PayClientProps) {
  const { token, packageAvailable, publishableKey } = props
  const [phase, setPhase] = useState<"ready" | "processing" | "paid">(
    props.initialStatus === "paid" ? "paid" : "ready",
  )

  const amountFormatted = formatAmount(props.amountCents, props.currency)
  const recurringText =
    props.billingType === "recurring" && props.recurringInterval
      ? intervalLabel[props.recurringInterval]
      : null

  const fetchClientSecret = useCallback(async () => {
    const res = await fetch(`/api/public/pay/${token}/session`, { method: "POST" })
    const data = await res.json()
    if (!res.ok || !data?.clientSecret) {
      throw new Error(data?.error ?? "Unable to start checkout.")
    }
    return data.clientSecret as string
  }, [token])

  // The webhook is the source of truth for "paid"; poll our status endpoint
  // after Stripe reports completion, then fall through to success on timeout.
  const handleComplete = useCallback(() => {
    setPhase("processing")
    let attempts = 0
    const poll = setInterval(async () => {
      attempts += 1
      try {
        const r = await fetch(`/api/public/pay/${token}/status`, { cache: "no-store" })
        const d = await r.json()
        if (d?.status === "paid") {
          clearInterval(poll)
          setPhase("paid")
          return
        }
      } catch {
        // keep polling
      }
      if (attempts >= 8) {
        clearInterval(poll)
        setPhase("paid")
      }
    }, 1500)
  }, [token])

  // ─── Terminal / blocked states ───
  const blockedReason =
    props.initialStatus === "canceled" || props.initialStatus === "expired"
      ? "This payment link is no longer active."
      : !packageAvailable
        ? "This service is no longer available."
        : !publishableKey
          ? "Payment is not configured. Please contact our office."
          : null

  if (phase === "paid") {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 size-8 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Payment received</h2>
          <p className="mt-2 text-pretty text-sm text-muted-foreground">
            Thank you{props.recipientName ? `, ${props.recipientName}` : ""}. Your payment for{" "}
            {props.packageName} has been received. A receipt has been emailed to you.
          </p>
        </div>
      </Shell>
    )
  }

  if (blockedReason) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <AlertTriangle className="mx-auto mb-3 size-8 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-card-foreground">Link unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">{blockedReason}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            Please contact our office for an updated payment link.
          </p>
        </div>
      </Shell>
    )
  }

  const stripePromise = getStripePromise(publishableKey)

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Order summary */}
        <aside className="h-fit rounded-lg border border-border bg-card p-6">
          <p className="text-sm font-medium text-muted-foreground">{FIRM_NAME}</p>
          <h1 className="mt-1 text-balance text-xl font-semibold text-card-foreground">
            {props.packageName}
          </h1>
          {props.memo ? (
            <p className="mt-2 text-pretty text-sm leading-relaxed text-muted-foreground">
              {props.memo}
            </p>
          ) : null}
          <div className="mt-6 flex items-baseline justify-between border-t border-border pt-4">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="text-2xl font-semibold text-card-foreground">{amountFormatted}</span>
          </div>
          {recurringText ? (
            <p className="mt-1 text-right text-xs text-muted-foreground">{recurringText}</p>
          ) : null}
          <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            <span>Secured by Stripe. Card details never touch our servers.</span>
          </div>
        </aside>

        {/* Embedded Checkout / processing */}
        <div className="min-h-[400px] rounded-lg border border-border bg-card p-2">
          {phase === "processing" ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span>Confirming your payment…</span>
            </div>
          ) : stripePromise ? (
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ fetchClientSecret, onComplete: handleComplete }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          ) : null}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl px-4 py-10">{children}</div>
}
