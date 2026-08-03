"use client"

import { useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatAmount, intervalSuffix, type ServicePackage } from "@/lib/payments/types"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function CreatePaymentLinkDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}) {
  const { data } = useSWR<{ packages: ServicePackage[] }>(
    open ? "/api/sales/service-packages" : null,
    fetcher,
  )
  const packages = data?.packages ?? []

  const [packageId, setPackageId] = useState("")
  const [recipientName, setRecipientName] = useState("")
  const [recipientEmail, setRecipientEmail] = useState("")
  const [memo, setMemo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const selected = packages.find((p) => p.id === packageId)

  function reset() {
    setPackageId("")
    setRecipientName("")
    setRecipientEmail("")
    setMemo("")
  }

  async function submit() {
    if (!packageId) return toast.error("Choose a service package")
    if (!recipientEmail.trim()) return toast.error("Enter the client's email")
    setSubmitting(true)
    try {
      const res = await fetch("/api/sales/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicePackageId: packageId,
          recipientEmail: recipientEmail.trim(),
          recipientName: recipientName.trim() || undefined,
          memo: memo.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Could not create link")
        return
      }
      toast.success(json.emailed ? "Payment link sent" : "Payment link created")
      reset()
      onOpenChange(false)
      onCreated()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New payment link</DialogTitle>
          <DialogDescription>
            Pick a service package and the client receives a secure link to pay.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="pkg">Service package</Label>
            <Select value={packageId} onValueChange={setPackageId}>
              <SelectTrigger id="pkg">
                <SelectValue placeholder="Choose a package" />
              </SelectTrigger>
              <SelectContent>
                {packages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — {formatAmount(p.price_cents, p.currency)}
                    {p.billing_type === "recurring" ? intervalSuffix(p.recurring_interval) : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Client name</Label>
            <Input
              id="name"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Jane Doe"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Client email</Label>
            <Input
              id="email"
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="memo">Memo (optional)</Label>
            <Textarea
              id="memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="A short note shown on the payment page and email."
              rows={2}
            />
          </div>

          {selected && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              Charging{" "}
              <span className="font-medium text-foreground">
                {formatAmount(selected.price_cents, selected.currency)}
                {selected.billing_type === "recurring"
                  ? intervalSuffix(selected.recurring_interval)
                  : ""}
              </span>{" "}
              {selected.billing_type === "recurring" ? "on a recurring basis" : "one time"}.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting} className="gap-2">
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Create & send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
