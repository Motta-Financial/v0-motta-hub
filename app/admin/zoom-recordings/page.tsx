"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Video,
  FileText,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  Download,
  Clock,
  RefreshCw,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface StatusResponse {
  ok: boolean
  s2sConfigured: boolean
  recordingsTotal: number
  transcriptsTotal: number
  transcriptsParsed: number
  transcriptsFailed: number
  transcriptsExpired: number
  mediaArchived: number
  lastSyncedAt: string | null
  newestRecordingStart: string | null
  recent: Array<{
    id: string
    topic: string | null
    start_time: string | null
    duration: number | null
    hasMediaInBlob: boolean
  }>
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default function ZoomRecordingsAdminPage() {
  const { data, mutate, isLoading } = useSWR<StatusResponse>(
    "/api/zoom/recordings/status",
    fetcher,
    { refreshInterval: 60_000 },
  )

  const [from, setFrom] = useState(isoDaysAgo(7))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [includeMedia, setIncludeMedia] = useState(false)
  const [tagParticipants, setTagParticipants] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null)

  const showFlash = useCallback((kind: "ok" | "err", msg: string) => {
    setFlash({ kind, msg })
    setTimeout(() => setFlash(null), 10_000)
  }, [])

  const runPull = useCallback(async () => {
    setBusy(true)
    setFlash(null)
    try {
      const res = await fetch("/api/zoom/recordings/sync-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, includeMedia, tagParticipants }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || "Pull failed")
      showFlash(
        "ok",
        `Pulled ${json.recordingsUpserted} recording(s) across ${json.usersScanned} user(s): ` +
          `${json.transcriptsParsed} transcript(s) parsed, ${json.mediaCopied} media file(s) archived` +
          (json.transcriptsFailed ? `, ${json.transcriptsFailed} failed` : "") +
          (json.errors?.length ? ` · ${json.errors.length} error(s)` : "") +
          ` (${Math.round((json.ms ?? 0) / 1000)}s).`,
      )
      mutate()
    } catch (e: any) {
      showFlash("err", e.message)
    } finally {
      setBusy(false)
    }
  }, [from, to, includeMedia, tagParticipants, mutate, showFlash])

  const s2sOff = data && data.s2sConfigured === false

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-balance">Zoom Recordings</h1>
            <p className="text-sm text-muted-foreground">
              Account-wide cloud-recording + transcript pipeline. Pull a date range on demand, archive video to Blob,
              and monitor coverage.
            </p>
          </div>
          <Button onClick={() => mutate()} disabled={isLoading} variant="outline" size="sm">
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        {flash ? (
          <Alert variant={flash.kind === "err" ? "destructive" : "default"}>
            {flash.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            <AlertTitle>{flash.kind === "ok" ? "Done" : "Error"}</AlertTitle>
            <AlertDescription>{flash.msg}</AlertDescription>
          </Alert>
        ) : null}

        {s2sOff ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Zoom Server-to-Server OAuth is not configured</AlertTitle>
            <AlertDescription>
              Set <code>ZOOM_S2S_CLIENT_ID</code>, <code>ZOOM_S2S_CLIENT_SECRET</code>, and{" "}
              <code>ZOOM_S2S_ACCOUNT_ID</code> to enable account-wide pulls.
            </AlertDescription>
          </Alert>
        ) : null}

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard
            label="Recordings"
            value={isLoading ? "…" : (data?.recordingsTotal ?? 0)}
            sub={
              data?.newestRecordingStart
                ? `newest ${formatDistanceToNow(new Date(data.newestRecordingStart), { addSuffix: true })}`
                : "none yet"
            }
            icon={<Video className="h-4 w-4" />}
            tone="ok"
          />
          <StatCard
            label="Transcripts parsed"
            value={isLoading ? "…" : (data?.transcriptsParsed ?? 0)}
            sub={`${data?.transcriptsTotal ?? 0} total`}
            icon={<FileText className="h-4 w-4" />}
            tone="ok"
          />
          <StatCard
            label="Media archived"
            value={isLoading ? "…" : (data?.mediaArchived ?? 0)}
            sub="MP4/M4A copied to Blob"
            icon={<HardDrive className="h-4 w-4" />}
            tone="ok"
          />
          <StatCard
            label="Failed / expired"
            value={isLoading ? "…" : (data?.transcriptsFailed ?? 0) + (data?.transcriptsExpired ?? 0)}
            sub={
              data?.lastSyncedAt
                ? `last sync ${formatDistanceToNow(new Date(data.lastSyncedAt), { addSuffix: true })}`
                : "never synced"
            }
            icon={<AlertTriangle className="h-4 w-4" />}
            tone={(data?.transcriptsFailed ?? 0) + (data?.transcriptsExpired ?? 0) > 0 ? "warn" : "ok"}
          />
        </div>

        {/* On-demand pull */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pull recordings for a date range</CardTitle>
            <CardDescription>
              Enumerates every user in the Motta Zoom account and ingests their cloud recordings + transcripts for the
              window below. Idempotent — re-running skips already-parsed transcripts and already-archived media.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from">From</Label>
                <Input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to">To</Label>
                <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch id="media" checked={includeMedia} onCheckedChange={setIncludeMedia} />
                <Label htmlFor="media" className="cursor-pointer">
                  Archive MP4 video to Blob
                </Label>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Switch id="tag" checked={tagParticipants} onCheckedChange={setTagParticipants} />
                <Label htmlFor="tag" className="cursor-pointer">
                  Tag participants (slower)
                </Label>
              </div>
              <Button onClick={runPull} disabled={busy || s2sOff} className="ml-auto">
                <Download className={`mr-2 h-4 w-4 ${busy ? "animate-pulse" : ""}`} />
                {busy ? "Pulling…" : "Run pull"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Archiving video and tagging participants are token- and bandwidth-heavy. For multi-month backfills, run a
              few months at a time. The daily cron already keeps the most recent month&apos;s transcripts current.
            </p>
          </CardContent>
        </Card>

        {/* Recent recordings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent recordings</CardTitle>
            <CardDescription>The 10 most recent recordings the Hub holds.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !data?.recent || data.recent.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No recordings yet.</p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recent.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{r.topic || "(untitled meeting)"}</span>
                      {r.hasMediaInBlob ? (
                        <Badge variant="outline" className="border-green-600/50 text-green-700">
                          video archived
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {r.duration != null ? <span>{r.duration} min</span> : null}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {r.start_time
                          ? formatDistanceToNow(new Date(r.start_time), { addSuffix: true })
                          : "no date"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string
  value: number | string
  sub: React.ReactNode
  icon: React.ReactNode
  tone: "ok" | "warn" | "err"
}) {
  const toneClass =
    tone === "err"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : ""
  return (
    <Card className={toneClass}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{label}</span>
          {icon}
        </div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  )
}
