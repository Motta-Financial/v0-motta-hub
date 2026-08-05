"use client"

/**
 * Contact Updates review queue.
 *
 * Clients provide name / email / phone / state on intake forms and
 * Calendly bookings. Missing Hub fields are filled automatically by
 * sync_lead_contact_updates() (runs after every Calendly sync); values
 * that CONFLICT with the Hub contact record land here for a human call:
 * keep what's on file, or apply what the client provided.
 */

import { useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  ArrowRight,
  Check,
  ClipboardList,
  ExternalLink,
  RefreshCw,
  X,
} from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type Suggestion = {
  id: string
  contact_id: string
  field: "name" | "email" | "phone" | "state"
  current_value: string | null
  suggested_value: string
  source: "intake_form" | "calendly"
  source_captured_at: string | null
  status: "pending" | "accepted" | "dismissed"
  created_at?: string
  resolved_at?: string
  resolved_by?: string | null
  contact: { id: string; full_name: string | null; primary_email: string | null } | null
}

const FIELD_LABEL: Record<Suggestion["field"], string> = {
  name: "Name",
  email: "Email",
  phone: "Phone",
  state: "State",
}

const SOURCE_META: Record<Suggestion["source"], { label: string; tone: string }> = {
  intake_form: { label: "Intake form", tone: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  calendly: { label: "Calendly", tone: "bg-sky-100 text-sky-800 border-sky-200" },
}

export default function ContactUpdatesPage() {
  const { toast } = useToast()
  const { data, isLoading, mutate } = useSWR<{ pending: Suggestion[]; resolved: Suggestion[] }>(
    "/api/contacts/update-suggestions",
    fetcher,
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const resolve = async (s: Suggestion, action: "accept" | "dismiss") => {
    setBusyId(s.id)
    try {
      const res = await fetch(`/api/contacts/update-suggestions/${s.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "request failed")
      toast({
        title: action === "accept" ? "Contact updated" : "Kept current value",
        description: `${FIELD_LABEL[s.field]} for ${s.contact?.full_name || "contact"}`,
      })
      mutate()
    } catch (err) {
      toast({
        title: "Failed to resolve suggestion",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      const res = await fetch("/api/contacts/update-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || "request failed")
      toast({ title: "Sync complete", description: "Re-scanned intake & Calendly data" })
      mutate()
    } catch (err) {
      toast({
        title: "Refresh failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  const pending = data?.pending ?? []
  const resolved = data?.resolved ?? []

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900 tracking-tight flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-stone-500" />
              Contact Updates
            </h1>
            <p className="text-sm text-stone-600 mt-1">
              Client-provided info from intake forms and Calendly bookings. Missing fields fill
              automatically — conflicts with the Hub record wait here for your call.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshing && "animate-spin")} />
            Re-scan sources
          </Button>
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">
              Pending
              <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                {pending.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            {isLoading ? (
              <Card><CardContent className="p-8 text-center text-sm text-stone-500">Loading…</CardContent></Card>
            ) : pending.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center text-sm text-stone-500">
                  <Check className="h-5 w-5 mx-auto mb-2 text-emerald-600" />
                  No conflicts to review — Hub contacts match everything clients have provided.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {pending.map((s) => (
                  <Card key={s.id} className="border-stone-200">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/clients/${s.contact_id}`}
                              className="font-medium text-stone-900 hover:underline inline-flex items-center gap-1"
                            >
                              {s.contact?.full_name || "(unnamed contact)"}
                              <ExternalLink className="h-3 w-3 text-stone-400" />
                            </Link>
                            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                              {FIELD_LABEL[s.field]}
                            </Badge>
                            <Badge variant="outline" className={cn("text-[10px]", SOURCE_META[s.source].tone)}>
                              {SOURCE_META[s.source].label}
                            </Badge>
                            {s.source_captured_at ? (
                              <span className="text-[11px] text-stone-500">
                                provided {new Date(s.source_captured_at).toLocaleDateString()}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 flex items-center gap-3 text-sm flex-wrap">
                            <span className="text-stone-600">
                              <span className="text-[11px] uppercase tracking-wide text-stone-400 mr-1.5">On file</span>
                              {s.current_value || <em className="text-stone-400">none</em>}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                            <span className="font-medium text-stone-900">
                              <span className="text-[11px] uppercase tracking-wide text-stone-400 mr-1.5">Client provided</span>
                              {s.suggested_value}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === s.id}
                            onClick={() => resolve(s, "dismiss")}
                          >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Keep current
                          </Button>
                          <Button
                            size="sm"
                            disabled={busyId === s.id}
                            onClick={() => resolve(s, "accept")}
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Use client&apos;s
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card className="border-stone-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-stone-700">Recently resolved</CardTitle>
                <CardDescription className="text-xs">
                  Dismissed values are never re-suggested by later syncs.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {resolved.length === 0 ? (
                  <div className="p-8 text-center text-sm text-stone-500">Nothing resolved yet.</div>
                ) : (
                  <ul className="divide-y divide-stone-100">
                    {resolved.map((s) => (
                      <li key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <span className="text-stone-800">{s.contact?.full_name || "(unnamed)"}</span>
                          <span className="text-stone-500"> · {FIELD_LABEL[s.field]} · </span>
                          <span className="text-stone-600 truncate">{s.suggested_value}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 text-xs">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              s.status === "accepted"
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                : "bg-stone-100 text-stone-600 border-stone-200",
                            )}
                          >
                            {s.status === "accepted" ? "Applied" : "Kept current"}
                          </Badge>
                          <span className="text-stone-400">
                            {s.resolved_by ? `by ${s.resolved_by}` : ""}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
