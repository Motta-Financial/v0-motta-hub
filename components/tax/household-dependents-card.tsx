"use client"

/**
 * HouseholdDependentsCard — dependents section of the household tab,
 * scoped to a single tax year (a dependent claim is a per-year fact, not
 * a durable one — see scripts/404_tax_household_model.sql).
 *
 * Adding a dependent writes BOTH the durable relationship and the
 * per-year facts row in one action (POST .../dependents?action=add).
 * "Copy from last year" exists because most households don't change
 * season to season, and re-keying them is exactly what this table is
 * meant to stop.
 */

import { useMemo, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Baby, Copy, Loader2, Plus } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { HouseholdContactPicker } from "@/components/tax/household-contact-picker"
import { cn } from "@/lib/utils"

type Dependent = {
  id: string
  dependentContactId: string
  relationshipId: string | null
  fullName: string | null
  dateOfBirth: string | null
  ageAtYearEnd: number | null
  relationshipType: string | null
  taxYear: number
  monthsLivedWithClaimant: number | null
  isFullTimeStudent: boolean | null
  isPermanentlyDisabled: boolean | null
  releasedToOtherParent: boolean
  creditType: "ctc" | "odc" | "none" | null
  notes: string | null
}

type DependentsResponse = {
  ok: boolean
  dependents: Dependent[]
  taxYear: number
}

const RELATIONSHIP_LABELS: Record<string, string> = {
  child: "Child",
  stepchild: "Stepchild",
  foster_child: "Foster child",
  adopted_child: "Adopted child",
  grandchild: "Grandchild",
  parent: "Parent",
  grandparent: "Grandparent",
  sibling: "Sibling",
  other_dependent: "Other dependent",
}

const fetcher = async (url: string): Promise<DependentsResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function creditLabel(credit: Dependent["creditType"]) {
  if (credit === null) {
    return (
      <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
        Not yet determined
      </Badge>
    )
  }
  if (credit === "ctc") {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-900">
        Child Tax Credit
      </Badge>
    )
  }
  if (credit === "odc") {
    return (
      <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-900">
        Credit for Other Dependents
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-700">
      No credit
    </Badge>
  )
}

export function HouseholdDependentsCard({ contactId }: { contactId: string }) {
  const currentYear = new Date().getFullYear()
  // Default to the most recent fully-elapsed tax year — the year a
  // preparer is most likely working on.
  const [taxYear, setTaxYear] = useState(currentYear - 1)
  const [addOpen, setAddOpen] = useState(false)
  const [copying, setCopying] = useState(false)
  const [copyMsg, setCopyMsg] = useState<string | null>(null)

  const { data, isLoading, error, mutate } = useSWR(
    `/api/tax/household/dependents?contactId=${contactId}&taxYear=${taxYear}`,
    fetcher,
    { revalidateOnFocus: false },
  )

  const yearOptions = useMemo(() => {
    const years: number[] = []
    for (let y = currentYear + 1; y >= currentYear - 6; y--) years.push(y)
    return years
  }, [currentYear])

  async function copyFromLastYear() {
    setCopying(true)
    setCopyMsg(null)
    try {
      const res = await fetch("/api/tax/household/dependents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "copy_from_last_year", contactId, taxYear }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Copy failed")
      const parts: string[] = []
      if (json.copied) parts.push(`${json.copied} copied`)
      if (json.skipped) parts.push(`${json.skipped} already on file for ${taxYear}`)
      if (json.conflicts?.length) parts.push(`${json.conflicts.length} conflict(s)`)
      setCopyMsg(
        parts.length ? parts.join(", ") : `No dependents found for tax year ${taxYear - 1}.`,
      )
      await mutate()
    } catch (err) {
      setCopyMsg(err instanceof Error ? err.message : "Copy failed")
    } finally {
      setCopying(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Baby className="h-4 w-4 text-primary" />
          Dependents
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={String(taxYear)} onValueChange={(v) => setTaxYear(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  TY {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={copying}
            onClick={copyFromLastYear}
          >
            {copying ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            Copy from last year
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add dependent
              </Button>
            </DialogTrigger>
            <AddDependentDialog
              contactId={contactId}
              taxYear={taxYear}
              onAdded={() => {
                setAddOpen(false)
                mutate()
              }}
              onCancel={() => setAddOpen(false)}
            />
          </Dialog>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {copyMsg && (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {copyMsg}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load: {String(error.message)}</p>
        ) : !data || data.dependents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No dependents on file for tax year {taxYear}.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.dependents.map((dep) => (
              <DependentRow key={dep.id} dependent={dep} onChanged={() => mutate()} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DependentRow({
  dependent,
  onChanged,
}: {
  dependent: Dependent
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function setCredit(credit: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/tax/household/dependents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "update",
          id: dependent.id,
          creditType: credit === "unset" ? null : credit,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      onChanged()
    } catch (err) {
      console.error("[v0] update dependent credit failed", err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-background px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {RELATIONSHIP_LABELS[dependent.relationshipType ?? ""] ??
              dependent.relationshipType ??
              "Dependent"}
          </Badge>
          <Link
            href={`/contacts/${dependent.dependentContactId}`}
            className="truncate font-medium text-foreground hover:underline"
          >
            {dependent.fullName ?? dependent.dependentContactId}
          </Link>
          {creditLabel(dependent.creditType)}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>
            DOB {dependent.dateOfBirth ?? "—"}
            {dependent.ageAtYearEnd != null && ` · age ${dependent.ageAtYearEnd} at year end`}
          </span>
          {dependent.monthsLivedWithClaimant != null && (
            <span>{dependent.monthsLivedWithClaimant} mo. lived with claimant</span>
          )}
          {dependent.isFullTimeStudent && <span>Full-time student</span>}
          {dependent.isPermanentlyDisabled && <span>Permanently disabled</span>}
          {dependent.releasedToOtherParent && <span>Released to other parent</span>}
        </div>
      </div>
      <Select
        value={dependent.creditType ?? "unset"}
        onValueChange={setCredit}
        disabled={busy}
      >
        <SelectTrigger className="h-8 w-44 shrink-0 text-xs">
          <SelectValue placeholder="Credit" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unset">Not yet determined</SelectItem>
          <SelectItem value="ctc">Child Tax Credit</SelectItem>
          <SelectItem value="odc">Credit for Other Dependents</SelectItem>
          <SelectItem value="none">No credit</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}

function AddDependentDialog({
  contactId,
  taxYear,
  onAdded,
  onCancel,
}: {
  contactId: string
  taxYear: number
  onAdded: () => void
  onCancel: () => void
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [relationshipType, setRelationshipType] = useState("child")
  const [monthsLived, setMonthsLived] = useState<string>("12")
  const [isStudent, setIsStudent] = useState(false)
  const [isDisabled, setIsDisabled] = useState(false)
  const [releasedToOther, setReleasedToOther] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/tax/household/dependents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          contactId,
          dependentContactId: picked.id,
          relationshipType,
          taxYear,
          monthsLivedWithClaimant: monthsLived === "" ? null : Number(monthsLived),
          isFullTimeStudent: isStudent,
          isPermanentlyDisabled: isDisabled,
          releasedToOtherParent: releasedToOther,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to add dependent")
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add dependent")
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add dependent — TY {taxYear}</DialogTitle>
        <DialogDescription>
          Link an existing contact as a dependent for this tax year. This writes both the
          household relationship and this year&apos;s claim facts.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        {!picked ? (
          <HouseholdContactPicker
            excludeContactId={contactId}
            onPick={setPicked}
            autoFocus
          />
        ) : (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{picked.name}</span>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Change
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="relationship-type">Relationship</Label>
          <Select value={relationshipType} onValueChange={setRelationshipType}>
            <SelectTrigger id="relationship-type" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RELATIONSHIP_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="months-lived">Months lived with claimant in {taxYear}</Label>
          <Select value={monthsLived} onValueChange={setMonthsLived}>
            <SelectTrigger id="months-lived" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 13 }, (_, i) => i).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {m} {m === 1 ? "month" : "months"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <Checkbox
              id="is-student"
              checked={isStudent}
              onCheckedChange={(v) => setIsStudent(v === true)}
            />
            <Label htmlFor="is-student" className="text-sm font-normal">
              Full-time student
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="is-disabled"
              checked={isDisabled}
              onCheckedChange={(v) => setIsDisabled(v === true)}
            />
            <Label htmlFor="is-disabled" className="text-sm font-normal">
              Permanently disabled
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="released"
              checked={releasedToOther}
              onCheckedChange={(v) => setReleasedToOther(v === true)}
            />
            <Label htmlFor="released" className="text-sm font-normal">
              Released to other parent (Form 8332)
            </Label>
          </div>
        </div>

        <p
          className={cn(
            "rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900",
          )}
        >
          Credit stays &quot;not yet determined&quot; until you run it through the calculator —
          you can set it from the row after saving.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!picked || busy}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Add dependent
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
