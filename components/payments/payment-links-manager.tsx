"use client"

import { useState } from "react"
import useSWR, { mutate } from "swr"
import { toast } from "sonner"
import { Plus, Copy, Send, Ban, LinkIcon, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CreatePaymentLinkDialog } from "./create-payment-link-dialog"
import {
  formatAmount,
  intervalSuffix,
  type PaymentRequest,
  type PaymentRequestStatus,
} from "@/lib/payments/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const STATUS_STYLES: Record<PaymentRequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-200",
  paid: "bg-emerald-100 text-emerald-800 border-emerald-200",
  canceled: "bg-muted text-muted-foreground border-border",
  expired: "bg-muted text-muted-foreground border-border",
}

const LIST_KEY = "/api/sales/payment-links"

export function PaymentLinksManager() {
  const [createOpen, setCreateOpen] = useState(false)
  const { data, isLoading } = useSWR<{ requests: PaymentRequest[] }>(LIST_KEY, fetcher)
  const requests = data?.requests ?? []

  function linkUrl(token: string) {
    const base = typeof window !== "undefined" ? window.location.origin : ""
    return `${base}/embed/pay/${token}`
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(linkUrl(token))
    toast.success("Payment link copied")
  }

  async function act(id: string, action: "resend" | "cancel") {
    const res = await fetch(`/api/sales/payment-links/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    })
    const json = await res.json()
    if (!res.ok) {
      toast.error(json.error ?? "Action failed")
      return
    }
    toast.success(action === "resend" ? "Email resent" : "Link canceled")
    mutate(LIST_KEY)
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-foreground text-balance">Payment Links</h1>
          <p className="text-sm text-muted-foreground">
            Send a client a secure link to pay for a service package.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="size-4" />
          New payment link
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Recent links</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <LinkIcon className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No payment links yet. Create one to get started.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Package</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((req) => (
                  <TableRow key={req.id}>
                    <TableCell className="font-medium text-foreground">
                      {req.recipient_name || req.recipient_email}
                      {req.recipient_name && (
                        <span className="block text-xs text-muted-foreground">
                          {req.recipient_email}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{req.package_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAmount(req.amount_cents, req.currency)}
                      <span className="text-xs text-muted-foreground">
                        {req.billing_type === "recurring"
                          ? intervalSuffix(req.recurring_interval)
                          : ""}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_STYLES[req.status]}>
                        {req.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copy link"
                          onClick={() => copyLink(req.token)}
                        >
                          <Copy className="size-4" />
                        </Button>
                        {req.status === "pending" && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Resend email"
                              onClick={() => act(req.id, "resend")}
                            >
                              <Send className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Cancel link"
                              onClick={() => act(req.id, "cancel")}
                            >
                              <Ban className="size-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreatePaymentLinkDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => mutate(LIST_KEY)}
      />
    </div>
  )
}
