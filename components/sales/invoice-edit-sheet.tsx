"use client"

/**
 * Edit sheet for an Ignition invoice. Most common cleanup is fixing the
 * client mapping (~3 of the 234 imported invoices land on the wrong client
 * because of name fuzziness) and toggling status + amounts when something
 * is paid outside Stripe.
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ClientPicker,
  type ClientPickerValue,
} from "@/components/clients/client-picker"

interface Invoice {
  ignition_invoice_id: string
  invoice_number: string | null
  status: string | null
  amount: number | null
  amount_paid: number | null
  amount_outstanding: number | null
  currency: string | null
  invoice_date: string | null
  due_date: string | null
  organization_id: string | null
  contact_id: string | null
  organizations: { id: string; name: string } | null
  contacts: { id: string; full_name: string } | null
}

interface Props {
  invoice: Invoice | null
  statuses: string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: any) => void
}

function dateToInput(s: string | null) {
  if (!s) return ""
  // Accept either yyyy-mm-dd or full ISO and return the date piece for <input type="date">.
  return s.slice(0, 10)
}

export function InvoiceEditSheet({ invoice, statuses, open, onOpenChange, onSaved }: Props) {
  const [client, setClient] = useState<ClientPickerValue | null>(null)
  const [invoiceNumber, setInvoiceNumber] = useState("")
  const [status, setStatus] = useState<string>("")
  const [amount, setAmount] = useState<string>("")
  const [amountPaid, setAmountPaid] = useState<string>("")
  const [amountOutstanding, setAmountOutstanding] = useState<string>("")
  const [invoiceDate, setInvoiceDate] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!invoice) return
    if (invoice.organization_id && invoice.organizations) {
      setClient({
        id: invoice.organization_id,
        name: invoice.organizations.name,
        kind: "organization",
      })
    } else if (invoice.contact_id && invoice.contacts) {
      setClient({
        id: invoice.contact_id,
        name: invoice.contacts.full_name,
        kind: "contact",
      })
    } else {
      setClient(null)
    }
    setInvoiceNumber(invoice.invoice_number || "")
    setStatus(invoice.status || "")
    setAmount(invoice.amount?.toString() || "")
    setAmountPaid(invoice.amount_paid?.toString() || "")
    setAmountOutstanding(invoice.amount_outstanding?.toString() || "")
    setInvoiceDate(dateToInput(invoice.invoice_date))
    setDueDate(dateToInput(invoice.due_date))
  }, [invoice])

  async function handleSave() {
    if (!invoice) return
    setSaving(true)
    try {
      const res = await fetch(`/api/sales/invoices/${invoice.ignition_invoice_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: client?.kind === "organization" ? client.id : null,
          contact_id: client?.kind === "contact" ? client.id : null,
          invoice_number: invoiceNumber || null,
          status: status || null,
          amount: amount,
          amount_paid: amountPaid,
          amount_outstanding: amountOutstanding,
          invoice_date: invoiceDate || null,
          due_date: dueDate || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error || "Failed to save invoice")
      }
      toast.success("Invoice updated")
      onSaved(json.invoice)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save invoice")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Invoice</SheetTitle>
          <SheetDescription>
            {invoice?.invoice_number ? `#${invoice.invoice_number}` : "Update the fields below"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label>Client</Label>
            <ClientPicker
              value={client}
              onChange={setClient}
              placeholder="Search organizations and contacts…"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="invoice-number">Invoice Number</Label>
            <Input
              id="invoice-number"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoice-amount">Amount</Label>
              <Input
                id="invoice-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoice-paid">Paid</Label>
              <Input
                id="invoice-paid"
                type="number"
                step="0.01"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoice-outstanding">Outstanding</Label>
              <Input
                id="invoice-outstanding"
                type="number"
                step="0.01"
                value={amountOutstanding}
                onChange={(e) => setAmountOutstanding(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoice-date">Invoice Date</Label>
              <Input
                id="invoice-date"
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invoice-due">Due Date</Label>
              <Input
                id="invoice-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !invoice}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
