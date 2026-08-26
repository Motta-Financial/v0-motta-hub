"use client"

/**
 * HouseholdSpouseCard — spouse section of the household tab.
 *
 * Mirrors the review affordances of client-relationships-card.tsx (same
 * card shape, same "link to an existing record" flow) but for the
 * household model rather than the entity-relationship scanner: this is a
 * durable person-to-person link, not a confidence-scored business match,
 * so there is no confirm/reject queue here — a preparer either adds the
 * link or ends it.
 *
 * The link is stored once, in one direction, and read back through
 * tax_person_relationships_both, so it resolves the same way regardless
 * of which spouse's profile you're looking at.
 */

import { useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Check, Heart, Loader2, Plus, X } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { HouseholdContactPicker } from "@/components/tax/household-contact-picker"

type SpouseResponse = {
  ok: boolean
  current: {
    id: string
    contactId: string
    fullName: string | null
    hasSsn: boolean
    hasDateOfBirth: boolean
  } | null
  history: Array<{
    id: string
    contactId: string
    fullName: string | null
    relationshipType: string
    effectiveFrom: string | null
    effectiveTo: string | null
  }>
}

const fetcher = async (url: string): Promise<SpouseResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export function HouseholdSpouseCard({ contactId }: { contactId: string }) {
  const { data, isLoading, error, mutate } = useSWR(
    `/api/tax/household/spouse?contactId=${contactId}`,
    fetcher,
    { revalidateOnFocus: false },
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [endOpen, setEndOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function addSpouse(spouse: { id: string; name: string }) {
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/tax/household/spouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          contactId,
          spouseContactId: spouse.id,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to add spouse")
      setPickerOpen(false)
      await mutate()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to add spouse")
    } finally {
      setBusy(false)
    }
  }

  async function endMarriage() {
    if (!data?.current) return
    setBusy(true)
    setErrorMsg(null)
    try {
      const res = await fetch("/api/tax/household/spouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "end",
          id: data.current.id,
          effectiveTo: new Date().toISOString().slice(0, 10),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "Failed to end marriage")
      setEndOpen(false)
      await mutate()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to end marriage")
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="h-4 w-4 text-primary" />
            Spouse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="h-4 w-4 text-primary" />
            Spouse
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Failed to load: {String(error.message)}</p>
        </CardContent>
      </Card>
    )
  }

  const current = data?.current ?? null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart className="h-4 w-4 text-primary" />
          Spouse
        </CardTitle>
        {!current && (
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add spouse
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="end">
              <p className="mb-2 text-xs text-muted-foreground">
                Link an existing contact as spouse. This does not create a new contact.
              </p>
              <HouseholdContactPicker
                excludeContactId={contactId}
                onPick={addSpouse}
                autoFocus
              />
              {busy && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Linking…
                </div>
              )}
              {errorMsg && <p className="mt-2 text-xs text-destructive">{errorMsg}</p>}
            </PopoverContent>
          </Popover>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!current ? (
          <p className="text-sm text-muted-foreground">
            No spouse on file. A joint return needs the spouse&apos;s name, SSN, and date of
            birth — add them here once they exist as a contact.
          </p>
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-border bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Link
                href={`/contacts/${current.contactId}`}
                className="truncate font-medium text-foreground hover:underline"
              >
                {current.fullName ?? current.contactId}
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant="outline"
                  className={
                    current.hasSsn
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }
                >
                  {current.hasSsn ? (
                    <Check className="mr-1 h-3 w-3" />
                  ) : (
                    <X className="mr-1 h-3 w-3" />
                  )}
                  SSN on file
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    current.hasDateOfBirth
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }
                >
                  {current.hasDateOfBirth ? (
                    <Check className="mr-1 h-3 w-3" />
                  ) : (
                    <X className="mr-1 h-3 w-3" />
                  )}
                  Date of birth on file
                </Badge>
              </div>
              {(!current.hasSsn || !current.hasDateOfBirth) && (
                <p className="text-xs text-amber-700">
                  A joint return needs both — this spouse is missing{" "}
                  {[!current.hasSsn && "SSN", !current.hasDateOfBirth && "date of birth"]
                    .filter(Boolean)
                    .join(" and ")}
                  .
                </p>
              )}
            </div>
            <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
              <Button
                size="sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => setEndOpen(true)}
              >
                End marriage
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End this marriage?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This marks the marriage ended as of today. The record is never deleted —
                    prior years&apos; returns stay reconstructable with this spouse attached.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={endMarriage}>
                    {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    End marriage
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {data && data.history.filter((h) => h.effectiveTo).length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Prior marriages
            </h3>
            {data.history
              .filter((h) => h.effectiveTo)
              .map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <span>{h.fullName ?? h.contactId}</span>
                  <span>
                    Ended {h.effectiveTo}
                    {h.effectiveFrom ? ` (since ${h.effectiveFrom})` : ""}
                  </span>
                </div>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
