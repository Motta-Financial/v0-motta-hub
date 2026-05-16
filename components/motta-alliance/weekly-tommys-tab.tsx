"use client"

/**
 * Motta Alliance — Weekly Tommy's archive
 *
 * Surfaces every persisted `tommy_weekly_recaps` row as a card in the
 * Motta Alliance gallery so the firm has a single visual home for the
 * comic series AND the weekly Operation Tommy dispatches. Each card
 * mirrors what teammates receive in the Friday recap email:
 *   - generated F1-podium hero image (3:2)
 *   - ALFRED Ai's narrated summary (line-clamped)
 *   - the top three with point totals
 *   - "Read" (opens the dispatch PDF in a new tab) +
 *     "Download" (saves the same PDF with a friendly filename)
 *
 * Data comes from `/api/tommy-awards?type=all_recaps`, newest first.
 * Loading + empty states match the existing Alliance gallery copy
 * voice so the tab feels native to the page.
 */

import Image from "next/image"
import useSWR from "swr"
import { useState } from "react"
import { Sparkles, Trophy, ExternalLink, Download, FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface TopThreeEntry {
  name: string
  rank: number
  totalPoints: number
  first?: number
  second?: number
  third?: number
}

interface WeeklyRecap {
  week_id: string
  week_date: string
  week_label: string
  total_ballots: number
  ai_summary: string | null
  podium_image_url: string | null
  podium_pdf_url: string | null
  top_three: TopThreeEntry[] | null
  email_sent_at: string | null
  created_at: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.json() as Promise<{ recaps: WeeklyRecap[] }>
}

export function WeeklyTommysTab() {
  const { data, isLoading, error } = useSWR(
    "/api/tommy-awards?type=all_recaps",
    fetcher,
    { revalidateOnFocus: false },
  )

  // Only show recaps whose email has actually shipped — anything still
  // "in flight" stays sealed behind the ALFRED waiting screen on the
  // Tommy Awards dashboard.
  const recaps = (data?.recaps ?? []).filter((r) => !!r.email_sent_at)

  if (isLoading) {
    return (
      <div className="rounded-xl border-2 p-10 text-center"
        style={{
          borderColor: "rgba(168,197,102,0.20)",
          backgroundColor: "rgba(168,197,102,0.04)",
        }}
      >
        <p className="text-sm" style={{ color: "#B8B3AA" }}>
          Loading dispatch archive&hellip;
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border-2 p-10 text-center"
        style={{
          borderColor: "rgba(230,168,92,0.30)",
          backgroundColor: "rgba(230,168,92,0.06)",
        }}
      >
        <p className="text-sm" style={{ color: "#E6A85C" }}>
          ALFRED&apos;s archive is offline. Try again in a moment.
        </p>
      </div>
    )
  }

  if (recaps.length === 0) {
    return (
      <div
        className="rounded-xl border-2 p-10 text-center"
        style={{
          borderColor: "rgba(168,197,102,0.20)",
          backgroundColor: "rgba(168,197,102,0.04)",
        }}
      >
        <Trophy className="mx-auto mb-3 h-10 w-10 opacity-40" style={{ color: "#A8C566" }} />
        <p className="text-sm" style={{ color: "#B8B3AA" }}>
          No Operation Tommy dispatches issued yet. The first weekly recap
          unlocks the moment ALFRED ships the Friday email.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {recaps.map((recap) => (
        <RecapCard key={recap.week_id} recap={recap} />
      ))}
    </div>
  )
}

function RecapCard({ recap }: { recap: WeeklyRecap }) {
  const [downloading, setDownloading] = useState(false)

  const downloadName = `Tommy-Awards-Recap-${recap.week_label.replace(/[^a-zA-Z0-9]+/g, "-")}.pdf`

  async function handleDownload() {
    if (!recap.podium_pdf_url) return
    setDownloading(true)
    try {
      // Same cross-origin trick the comic-edition cards use — fetch the
      // PDF into a Blob and click a programmatic <a download> link so
      // the browser actually uses our friendly filename instead of the
      // blob hash baked into the URL.
      const res = await fetch(recap.podium_pdf_url)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      console.error("[weekly-tommys] download failed, falling back to new tab", err)
      window.open(recap.podium_pdf_url, "_blank", "noopener,noreferrer")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card
      className="group overflow-hidden rounded-lg border shadow-lg transition-all hover:-translate-y-1 hover:shadow-2xl"
      style={{
        borderColor: "rgba(168,197,102,0.25)",
        backgroundColor: "#0F140C",
        boxShadow:
          "0 10px 30px -10px rgba(0,0,0,0.45), 0 0 0 1px rgba(168,197,102,0.06) inset",
      }}
    >
      {recap.podium_image_url ? (
        // gpt-image-2 outputs a 3:2 frame — the container matches it
        // exactly so the artwork (and the MOTTA ALLIANCE banner along
        // the top) sits edge-to-edge with no cropping.
        <div className="relative w-full aspect-[3/2]" style={{ backgroundColor: "#0A0E08" }}>
          <Image
            src={recap.podium_image_url}
            alt={`Generated podium image for ${recap.week_label}`}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            className="object-contain"
            unoptimized
          />
        </div>
      ) : (
        <div
          className="relative w-full aspect-[3/2] flex items-center justify-center"
          style={{ backgroundColor: "#0A0E08" }}
        >
          <Trophy className="h-12 w-12 opacity-30" style={{ color: "#A8C566" }} />
        </div>
      )}

      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div
              className="p-1.5 rounded-md"
              style={{ backgroundColor: "rgba(168,197,102,0.15)" }}
            >
              <Sparkles className="h-4 w-4" style={{ color: "#A8C566" }} />
            </div>
            <div>
              <p
                className="text-[10px] uppercase tracking-[0.18em] font-bold"
                style={{ color: "#A8C566" }}
              >
                Operation Tommy
              </p>
              <p className="text-sm font-semibold" style={{ color: "#F4EFE8" }}>
                {recap.week_label}
              </p>
            </div>
          </div>
          <span
            className="rounded-sm border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{
              color: "#A8C566",
              borderColor: "rgba(168,197,102,0.40)",
              backgroundColor: "rgba(168,197,102,0.06)",
            }}
          >
            {recap.total_ballots} Ballots
          </span>
        </div>

        {Array.isArray(recap.top_three) && recap.top_three.length > 0 && (
          <div
            className="rounded-md border px-3 py-2"
            style={{
              borderColor: "rgba(168,197,102,0.20)",
              backgroundColor: "rgba(168,197,102,0.04)",
            }}
          >
            <div className="space-y-1">
              {recap.top_three.map((entry) => (
                <div key={`${entry.rank}-${entry.name}`} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="text-[10px] font-bold uppercase tracking-wider"
                      style={{ color: entry.rank === 1 ? "#E6A85C" : "#A8C566" }}
                    >
                      {entry.rank === 1 ? "1st" : entry.rank === 2 ? "2nd" : "3rd"}
                    </span>
                    <span className="text-xs font-semibold truncate" style={{ color: "#F4EFE8" }}>
                      {entry.name}
                    </span>
                  </div>
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: "#A8C566" }}>
                    {entry.totalPoints} pts
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {recap.ai_summary && (
          <p
            className="line-clamp-5 text-xs leading-relaxed"
            style={{ color: "#D5D0C8" }}
            title={recap.ai_summary}
          >
            {recap.ai_summary}
          </p>
        )}

        {recap.podium_pdf_url ? (
          <div className="flex gap-2 pt-1">
            <Button
              asChild
              size="sm"
              className="flex-1 font-bold uppercase tracking-wider"
              style={{ backgroundColor: "#A8C566", color: "#0F140C" }}
            >
              <a
                href={recap.podium_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open ${recap.week_label} dispatch in a new tab`}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Read
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 font-bold uppercase tracking-wider"
              style={{
                borderColor: "rgba(168,197,102,0.4)",
                color: "#A8C566",
                backgroundColor: "transparent",
              }}
              onClick={handleDownload}
              disabled={downloading}
              aria-label={`Download ${recap.week_label} dispatch PDF`}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {downloading ? "Downloading\u2026" : "Download"}
            </Button>
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              borderColor: "rgba(184,179,170,0.30)",
              color: "#B8B3AA",
              backgroundColor: "rgba(184,179,170,0.05)",
            }}
          >
            <FileDown className="h-3 w-3" />
            PDF Not Available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
