"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  User,
  Pencil,
  X,
  CheckCircle2,
  AlertCircle,
  Users,
  Info,
} from "lucide-react"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

interface ContactInfo {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone_numbers?: Array<{ number: string; type?: string }> | null
  physical_addresses?: Array<{
    line1?: string
    line2?: string
    city?: string
    state?: string
    postal_code?: string
  }> | null
  // Org fields
  name?: string | null
  phone_number?: string | null
  address?: string | null
}

interface AuthorizedContact {
  id: string
  full_name: string | null
  email: string
  role: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// ── Preview mock data ─────────────────────────────────────────────────────────

const PREVIEW_CONTACT: ContactInfo = {
  first_name: "Alex",
  last_name: "Johnson",
  email: "alex.johnson@example.com",
  phone_numbers: [{ number: "(512) 555-0147", type: "Mobile" }],
  physical_addresses: [
    {
      line1: "4821 Barton Springs Rd",
      line2: "Apt 3B",
      city: "Austin",
      state: "TX",
      postal_code: "78704",
    },
  ],
}

const PREVIEW_AUTHORIZED_CONTACTS: AuthorizedContact[] = [
  {
    id: "ac-1",
    full_name: "Jordan Johnson",
    email: "jordan.johnson@example.com",
    role: "client_contact",
  },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ClientInfoPage() {
  const { data } = useSWR<{
    contact: ContactInfo | null
    authorizedContacts: AuthorizedContact[]
  }>("/api/client-portal/client-info", fetcher)

  const isLoading = false
  const contact = data?.contact ?? PREVIEW_CONTACT
  const authorizedContacts = data?.authorizedContacts ?? PREVIEW_AUTHORIZED_CONTACTS

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Client Info</h1>
        <p className="text-sm text-gray-500 mt-1">
          Review your information on file. To request a change, click Edit — your
          Motta team will be notified and update your records.
        </p>
      </div>

      <Alert className="border-0" style={{ backgroundColor: "#EFF6E8" }}>
        <Info className="h-4 w-4" style={{ color: "#6B745D" }} />
        <AlertDescription className="text-sm" style={{ color: "#4B5563" }}>
          Changes submitted here are sent as a request to your advisor. They will
          update your information in our system within 1–2 business days.
        </AlertDescription>
      </Alert>

      {/* Contact details */}
      <ContactCard contact={contact} isLoading={isLoading} />

      {/* People on this account */}
      {(isLoading || authorizedContacts.length > 0) && (
        <AuthorizedContactsCard
          contacts={authorizedContacts}
          isLoading={isLoading}
        />
      )}
    </div>
  )
}

// ── Contact details card ──────────────────────────────────────────────────────

function ContactCard({
  contact,
  isLoading,
}: {
  contact: ContactInfo | null
  isLoading: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // Read the primary phone + address for display
  const primaryPhone =
    contact?.phone_numbers?.[0]?.number ??
    contact?.phone_number ??
    ""

  const addr = contact?.physical_addresses?.[0]
  const addressLine = addr
    ? [addr.line1, addr.city, addr.state, addr.postal_code]
        .filter(Boolean)
        .join(", ")
    : contact?.address ?? ""

  const displayName =
    contact?.name ??
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ??
    "—"

  // Edit state
  const [fields, setFields] = useState({
    "Phone number": primaryPhone,
    "Mailing address": addressLine,
  })

  function handleChange(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    // Only send fields that differ from the original
    const changes: Record<string, string> = {}
    if (fields["Phone number"] !== primaryPhone)
      changes["Phone number"] = fields["Phone number"]
    if (fields["Mailing address"] !== addressLine)
      changes["Mailing address"] = fields["Mailing address"]

    if (Object.keys(changes).length === 0) {
      setEditing(false)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/client-portal/client-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      })

      if (!res.ok) {
        toast.error("Could not submit your request. Please try again.")
        return
      }

      setEditing(false)
      setSubmitted(true)
      toast.success("Change request sent to your advisor.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <User className="h-4 w-4" style={{ color: "#6B745D" }} />
            Personal Information
          </CardTitle>
          <CardDescription className="text-xs mt-0.5">
            Your contact details on file with Motta Financial
          </CardDescription>
        </div>
        {!editing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSubmitted(false)
              setEditing(true)
            }}
            className="shrink-0"
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {submitted && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ backgroundColor: "#EFF6E8", color: "#16a34a" }}
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Change request sent. Your advisor will update your records shortly.
          </div>
        )}

        {/* Read-only fields */}
        <InfoRow label="Full name" value={isLoading ? null : displayName} />
        <InfoRow label="Email" value={isLoading ? null : contact?.email ?? "—"} />

        {/* Editable: phone */}
        <div>
          <Label className="text-xs text-gray-500 uppercase tracking-wide">
            Phone number
          </Label>
          {editing ? (
            <Input
              className="mt-1"
              value={fields["Phone number"]}
              onChange={(e) => handleChange("Phone number", e.target.value)}
              placeholder="e.g. (555) 123-4567"
              disabled={submitting}
            />
          ) : isLoading ? (
            <Skeleton className="mt-1 h-5 w-40" />
          ) : (
            <p className="mt-1 text-sm text-gray-900">{primaryPhone || "—"}</p>
          )}
        </div>

        {/* Editable: address */}
        <div>
          <Label className="text-xs text-gray-500 uppercase tracking-wide">
            Mailing address
          </Label>
          {editing ? (
            <Input
              className="mt-1"
              value={fields["Mailing address"]}
              onChange={(e) => handleChange("Mailing address", e.target.value)}
              placeholder="e.g. 123 Main St, Miami, FL 33101"
              disabled={submitting}
            />
          ) : isLoading ? (
            <Skeleton className="mt-1 h-5 w-56" />
          ) : (
            <p className="mt-1 text-sm text-gray-900">{addressLine || "—"}</p>
          )}
        </div>

        {editing && (
          <div className="flex items-center gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={submitting}
              className="text-white"
              style={{ backgroundColor: "#6B745D" }}
            >
              {submitting ? "Submitting…" : "Submit change request"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={submitting}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: string | null
}) {
  return (
    <div>
      <Label className="text-xs text-gray-500 uppercase tracking-wide">
        {label}
      </Label>
      {value === null ? (
        <Skeleton className="mt-1 h-5 w-40" />
      ) : (
        <p className="mt-1 text-sm text-gray-900">{value}</p>
      )}
    </div>
  )
}

// ── Authorized contacts card ──────────────────────────────────────────────────

function AuthorizedContactsCard({
  contacts,
  isLoading,
}: {
  contacts: AuthorizedContact[]
  isLoading: boolean
}) {
  return (
    <Card className="shadow-sm border-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4" style={{ color: "#6B745D" }} />
          People on this account
        </CardTitle>
        <CardDescription className="text-xs mt-0.5">
          Other contacts with portal access linked to your account
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-sm text-gray-500">
            No additional contacts on this account.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {c.full_name ?? c.email}
                  </p>
                  <p className="text-xs text-gray-500">{c.email}</p>
                </div>
                <Badge variant="secondary" className="text-xs capitalize">
                  {c.role === "client_contact" ? "Authorized Contact" : "Primary"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
