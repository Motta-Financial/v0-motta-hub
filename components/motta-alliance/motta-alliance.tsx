"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  BookOpen,
  Download,
  ExternalLink,
  Plus,
  Sparkles,
  Users,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { IssueNewEditionDialog } from "@/components/motta-alliance/issue-new-edition-dialog"

// ─────────────────────────────────────────────────────────────────────
// MOTTA ALLIANCE — internal comic book series
// ─────────────────────────────────────────────────────────────────────
// This page is a gallery of the firm's in-house comic-book lore. The
// PDFs themselves live on Vercel Blob (URLs below). Each issue gets a
// stylized cover card — bold issue number, title, story arc, featured
// characters — plus a "View" button that opens the PDF in a new tab
// and a "Download" button that triggers a file save.
//
// Design notes
// ------------
// We intentionally do NOT render the PDF's first page as a thumbnail
// here. pdf.js is heavy, and the OCR'd cover art is already crowded
// when shrunk to a card. Instead, every card is a typographic poster
// using the firm's existing palette (olive / beige / cream + a single
// amber accent) so the gallery feels cohesive with the rest of the
// Hub while still reading as "comic book". A few cards lean darker
// for a "night issue" feel (Sunset Vibes, Taxverse) and the solo
// volumes use a warmer cream-on-olive treatment so the team issues
// vs. character volumes register at a glance.

type CoverVariant = "olive" | "sunset" | "taxverse" | "cream-olive" | "amber"

type Issue = {
  // Stable slug used as the React key + the download filename so the
  // saved file is human-readable rather than the blob hash.
  slug: string
  // Top-line series label rendered as a small caps eyebrow.
  series: string
  // Issue identifier — "Issue 1", "Vol. 1", etc. Rendered as a bold
  // corner badge so it scans like a real comic cover.
  number: string
  // Headline title of this issue. Two lines max to keep the cover
  // card balanced at all viewport widths.
  title: string
  // Optional story-arc subtitle ("Sunset Vibes", "Taxverse 2026", ...).
  arc?: string
  // One-line tagline rendered at the bottom of the cover. Lifted
  // directly from the PDFs themselves so the language stays in lockstep
  // with the actual content.
  tagline: string
  // Cast list — rendered as Badge chips. Keep to 4-5 for layout.
  characters: string[]
  // Public blob URL — used for both the "View" (target="_blank") and
  // "Download" actions. We append the suggested download filename via
  // the `download` attribute below.
  pdfUrl: string
  // Visual treatment of the cover. Five variants share a tight 5-color
  // palette (olive / dark olive / cream / beige / amber-gold) so the
  // gallery reads as a series rather than a soup of one-offs.
  variant: CoverVariant
  // Claude-generated story preview, only set for DB-backed editions
  // uploaded through the "Issue New Edition" dialog. When present, the
  // gallery shows it underneath the meta strip so readers can decide
  // whether to open the PDF before clicking through.
  aiSummary?: string | null
  // Issuer display name — only set for DB-backed editions. Used in the
  // "Issued by ..." byline that appears under the AI preview.
  issuedBy?: string | null
  // Publish date — only set for DB-backed editions. Shown as a relative
  // "3 days ago"-style label so newer drops surface visually.
  publishedAt?: string | null
}

// Team-wide ensemble issues — the main numbered series.
const TEAM_ISSUES: Issue[] = [
  {
    slug: "issue-1-origin",
    series: "Motta Alliance",
    number: "Issue 1",
    title: "Origin",
    tagline: "One team. One mission. Protect the future.",
    characters: ["Caleb Long", "Amy Sparaco", "Andrew Gianares", "Ganesh & Thameem", "Micaela Palacios"],
    pdfUrl:
      "https://blobs.vusercontent.net/blob/Motta%20Alliance_Issue%201-4T0GlQWzj6G3pfMiAXltTaNNzQqkiu.pdf",
    variant: "olive",
  },
  {
    slug: "issue-1-sunset-vibes",
    series: "Motta Alliance",
    number: "Issue 1",
    title: "Sunset Vibes",
    arc: "A Different Kind of Heroism",
    tagline: "Some heroes save the day. Some make it worth coming home to.",
    characters: ["Caleb Long", "Andrew Gianares", "Amy Sparaco"],
    pdfUrl:
      "https://blobs.vusercontent.net/blob/MA_Issue%201_Sunset%20Vibes-o2d26Atj9xE5oqKBt3OabFTPp9Xb88.pdf",
    variant: "sunset",
  },
  {
    slug: "issue-2-jr-achievement",
    series: "Motta Alliance",
    number: "Issue 2",
    title: "Junior Achievement",
    arc: "Taxverse 2026",
    tagline: "Fighting for financial clarity. Saving the tax world.",
    characters: ["Caleb Long", "Amy Sparaco", "Andrew Gianares", "P24", "Micaela Palacios"],
    pdfUrl:
      "https://blobs.vusercontent.net/blob/MA_2_Jr%20Achievement-6qZhIT3bmLoT3RW1RviJBiK3qYILfg.pdf",
    variant: "taxverse",
  },
]

// Solo character spotlights — "Volume" rather than "Issue" so the
// numbering doesn't collide with the main series.
const HERO_VOLUMES: Issue[] = [
  {
    slug: "caleb-long-vol-1",
    series: "Hero Volume",
    number: "Vol. 1",
    title: "Caleb Long",
    arc: "The Financial Optimizer",
    tagline: "Every system has a leverage point. He finds them.",
    characters: ["Caleb Long"],
    pdfUrl:
      "https://blobs.vusercontent.net/blob/Motta%20-%20Caleb%20Long%20-%20Volume%20-%201-ZCBlvd6RL2uYyWKHAcKhvrlFn6VurF.pdf",
    variant: "cream-olive",
  },
  {
    slug: "amy-sparaco-vol-1",
    series: "Hero Volume",
    number: "Vol. 1",
    title: "Amy Sparaco",
    arc: "The Reconciliation Scientist",
    tagline: "If the numbers don't agree, she makes them.",
    characters: ["Amy Sparaco"],
    pdfUrl:
      "https://blobs.vusercontent.net/blob/Motta%20-%20Amy%20Sparaco%20-%20Volume%20-%201-lnpj1pUWl41WRj7aKZhNEZEJ9e6wsz.pdf",
    variant: "amber",
  },
]

// Variant → cover styles. Kept inline-only (no globals.css edits) so the
// page is self-contained and easy to extend with future issues.
const VARIANT_STYLES: Record<
  CoverVariant,
  {
    bg: string
    eyebrow: string
    title: string
    arc: string
    tagline: string
    badge: string
    accent: string
    // Subtle radial-gradient "spotlight" tinted to match each variant
    // — keeps each cover from feeling like flat color while staying in
    // the same palette family.
    spotlight: string
  }
> = {
  olive: {
    bg: "#3D4634",
    eyebrow: "#EAE6E1",
    title: "#F4EFE8",
    arc: "#C89B5C",
    tagline: "#EAE6E1",
    badge: "#C89B5C",
    accent: "#C89B5C",
    spotlight:
      "radial-gradient(circle at 30% 20%, rgba(244,239,232,0.18), transparent 60%)",
  },
  sunset: {
    bg: "#5A3E2B",
    eyebrow: "#F4EFE8",
    title: "#F4EFE8",
    arc: "#E6A85C",
    tagline: "#EAE6E1",
    badge: "#E6A85C",
    accent: "#E6A85C",
    spotlight:
      "radial-gradient(circle at 70% 80%, rgba(230,168,92,0.28), transparent 60%)",
  },
  taxverse: {
    bg: "#2C3329",
    eyebrow: "#C89B5C",
    title: "#F4EFE8",
    arc: "#C89B5C",
    tagline: "#EAE6E1",
    badge: "#C89B5C",
    accent: "#C89B5C",
    spotlight:
      "radial-gradient(circle at 80% 20%, rgba(200,155,92,0.22), transparent 55%)",
  },
  "cream-olive": {
    bg: "#F4EFE8",
    eyebrow: "#6B745D",
    title: "#3D4634",
    arc: "#6B745D",
    tagline: "#4A5240",
    badge: "#6B745D",
    accent: "#C89B5C",
    spotlight:
      "radial-gradient(circle at 25% 80%, rgba(107,116,93,0.18), transparent 60%)",
  },
  amber: {
    bg: "#6B745D",
    eyebrow: "#F4EFE8",
    title: "#F4EFE8",
    arc: "#E6A85C",
    tagline: "#EAE6E1",
    badge: "#E6A85C",
    accent: "#E6A85C",
    spotlight:
      "radial-gradient(circle at 70% 30%, rgba(230,168,92,0.22), transparent 60%)",
  },
}

function IssueCover({ issue }: { issue: Issue }) {
  const styles = VARIANT_STYLES[issue.variant]
  // Track the per-card download state so a slow blob fetch doesn't
  // freeze the UI — the button shows "Downloading…" until the blob
  // resolves and the save dialog opens.
  const [downloading, setDownloading] = useState(false)

  // Suggested filename when the user clicks Download. The blob URL
  // has a random suffix that would otherwise show up in the save
  // dialog, which is hostile to anyone trying to keep a tidy folder.
  const downloadName = `Motta-Alliance--${issue.slug}.pdf`

  async function handleDownload() {
    setDownloading(true)
    try {
      // We can't just rely on `<a download>` because the PDF lives on
      // a different origin (blobs.vusercontent.net), and the browser
      // ignores the `download` attribute for cross-origin links.
      // Fetching the PDF into a Blob and using URL.createObjectURL
      // lets us force the save dialog with the friendly filename.
      const res = await fetch(issue.pdfUrl)
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      // Defer the revoke so Firefox/Safari can hand off the blob
      // before we yank it back. 60s is generous — the file is small.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      console.error("[motta-alliance] download failed, falling back to new tab", err)
      // If the fetch fails (CORS, network blip, etc.) we still want
      // the teammate to get the PDF — just open it in a new tab so
      // they can use the browser's built-in save dialog.
      window.open(issue.pdfUrl, "_blank", "noopener,noreferrer")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card className="overflow-hidden border-0 shadow-lg transition-transform hover:-translate-y-1 hover:shadow-xl">
      {/* Cover canvas — 3:4 portrait, like a real comic cover */}
      <div
        className="relative aspect-[3/4] w-full"
        style={{
          backgroundColor: styles.bg,
          backgroundImage: styles.spotlight,
        }}
      >
        {/* Issue number badge (top-left) — the canonical comic-cover
            corner stamp. Uses the accent color so it pops against the
            cover regardless of variant. */}
        <div
          className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ backgroundColor: styles.badge, color: styles.bg }}
        >
          <BookOpen className="h-3 w-3" strokeWidth={2.5} />
          {issue.number}
        </div>

        {/* Series eyebrow (top-right) */}
        <div
          className="absolute right-4 top-4 text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: styles.eyebrow }}
        >
          {issue.series}
        </div>

        {/* Center stack — arc badge, big title, tagline */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          {issue.arc && (
            <div
              className="mb-3 inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ borderColor: styles.arc, color: styles.arc }}
            >
              {issue.arc}
            </div>
          )}
          <h3
            className="font-sans text-3xl font-black uppercase leading-[1.05] tracking-tight text-balance md:text-4xl"
            style={{ color: styles.title }}
          >
            {issue.title}
          </h3>
        </div>

        {/* Tagline (bottom) */}
        <div
          className="absolute inset-x-6 bottom-5 text-center text-[11px] font-medium italic leading-snug text-pretty"
          style={{ color: styles.tagline }}
        >
          “{issue.tagline}”
        </div>
      </div>

      {/* Meta strip below the cover */}
      <CardContent className="space-y-3 p-4">
        {/* Featured characters — chips. */}
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="flex flex-wrap gap-1">
            {issue.characters.map((c) => (
              <Badge
                key={c}
                variant="secondary"
                className="px-2 py-0 text-[10px] font-medium"
              >
                {c}
              </Badge>
            ))}
          </div>
        </div>

        {/* AI-generated preview + issuance byline (only present on DB-
            backed editions uploaded through the new-edition dialog).
            Line-clamped to 4 lines so the gallery card stays uniform
            in height — readers can hover to see the full text. */}
        {issue.aiSummary && (
          <div
            className="rounded-md border border-dashed bg-muted/40 px-3 py-2"
            title={issue.aiSummary}
          >
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-2.5 w-2.5" />
              ALFRED Preview
            </div>
            <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-stone-700">
              {issue.aiSummary}
            </p>
            {(issue.issuedBy || issue.publishedAt) && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {issue.issuedBy ? `Issued by ${issue.issuedBy}` : ""}
                {issue.issuedBy && issue.publishedAt ? " · " : ""}
                {issue.publishedAt
                  ? new Date(issue.publishedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : ""}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            asChild
            variant="default"
            size="sm"
            className="flex-1"
          >
            {/* Open PDF in a new tab. noopener,noreferrer matches the
                same hardening we use on the header Quick Links. */}
            <a
              href={issue.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Read ${issue.title} in a new tab`}
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Read
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleDownload}
            disabled={downloading}
            aria-label={`Download ${issue.title} PDF`}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {downloading ? "Downloading…" : "Download"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function IssueGrid({ issues }: { issues: Issue[] }) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {issues.map((issue) => (
        <IssueCover key={issue.slug} issue={issue} />
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────
 * DB-backed editions
 * ─────────────────────────────────────────────────────────────────────
 * Editions uploaded through the in-app "Issue New Edition" dialog live
 * in the `motta_alliance_issues` table. We fetch them with SWR and
 * merge into the gallery as a "Latest Editions" section that sits
 * ABOVE the seeded Team Issues block — newest content surfaces first
 * without burying the original lore.
 */

interface DbIssueRow {
  id: string
  slug: string
  series: string
  issue_number: string
  title: string
  arc: string | null
  tagline: string | null
  characters: string[] | null
  pdf_url: string
  variant: string | null
  ai_summary: string | null
  created_by_name: string | null
  published_at: string | null
}

const KNOWN_VARIANTS: CoverVariant[] = [
  "olive",
  "sunset",
  "taxverse",
  "cream-olive",
  "amber",
]

function isKnownVariant(v: string | null | undefined): v is CoverVariant {
  return !!v && (KNOWN_VARIANTS as string[]).includes(v)
}

/** Convert a DB row into the same Issue shape the seeded constants use,
 *  so the existing IssueCover / IssueGrid components render it as-is.
 *  Unknown variants fall back to the default olive look. */
function dbRowToIssue(row: DbIssueRow): Issue {
  return {
    slug: row.slug,
    series: row.series || "Motta Alliance",
    number: row.issue_number,
    title: row.title,
    arc: row.arc ?? undefined,
    tagline: row.tagline ?? "",
    characters: row.characters ?? [],
    pdfUrl: row.pdf_url,
    variant: isKnownVariant(row.variant) ? row.variant : "olive",
    aiSummary: row.ai_summary,
    issuedBy: row.created_by_name,
    publishedAt: row.published_at,
  }
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
  return res.json() as Promise<{ issues: DbIssueRow[] }>
}

export function MottaAlliance() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data, mutate, isLoading } = useSWR(
    "/api/motta-alliance/issues",
    fetcher,
    {
      // Editions are append-only and rare; no need to poll. Just
      // refresh after a successful publish via the dialog's onIssued
      // callback below.
      revalidateOnFocus: false,
    },
  )

  const dbIssues = useMemo<Issue[]>(
    () => (data?.issues ?? []).map(dbRowToIssue),
    [data?.issues],
  )

  return (
    <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 md:px-6 md:py-10">
      {/* Hero — sets the in-universe tone with the team's lore tagline,
          then immediately tells the teammate WHAT this page actually
          is (a gallery of internal comics). */}
      <header className="relative overflow-hidden rounded-2xl border bg-card p-6 md:p-10">
        {/* Decorative halftone-ish radial accent so the hero isn't a
            flat rectangle. Subtle so it doesn't distract from copy. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 90% 0%, rgba(107,116,93,0.10), transparent 55%), radial-gradient(circle at 0% 100%, rgba(200,155,92,0.10), transparent 55%)",
          }}
        />
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="h-3 w-3" />
              Internal Lore
            </div>
            <h1 className="font-sans text-3xl font-black uppercase tracking-tight text-foreground text-balance md:text-4xl">
              The Motta Alliance
            </h1>
            <p className="mt-2 text-sm font-medium uppercase tracking-[0.15em] text-muted-foreground">
              One team. One mission. Protect the future.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
              A comic-book series chronicling the heroes of Motta Financial —
              the advisors, accountants, and operators fighting for financial
              clarity across the Taxverse. Click any cover to read in a new
              tab, or download a copy to keep on your device.
            </p>
          </div>

          {/* Primary action — opens the new-edition dialog. Lives in
              the hero so anyone with a finished PDF can ship it without
              hunting for the button. */}
          <div className="shrink-0">
            <Button
              size="lg"
              onClick={() => setDialogOpen(true)}
              className="w-full md:w-auto"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Issue New Edition
            </Button>
          </div>
        </div>
      </header>

      {/* Latest Editions — DB-backed uploads. Hidden when none exist so
          the page doesn't show an empty section on first load. */}
      {dbIssues.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4 border-b pb-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-foreground">
                <Sparkles className="h-4 w-4 text-amber-600" />
                Latest Editions
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Newly issued via the Hub — each one announced to the team
                by ALFRED Ai with a story preview.
              </p>
            </div>
            <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {dbIssues.length} {dbIssues.length === 1 ? "Edition" : "Editions"}
            </span>
          </div>
          <IssueGrid issues={dbIssues} />
        </section>
      )}

      {/* Team Issues — seeded constants. */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Team Issues
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The main numbered series — the whole Alliance on a mission.
            </p>
          </div>
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground",
            )}
          >
            {TEAM_ISSUES.length} {TEAM_ISSUES.length === 1 ? "Issue" : "Issues"}
          </span>
        </div>
        <IssueGrid issues={TEAM_ISSUES} />
      </section>

      {/* Hero Volumes — seeded constants. */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Hero Volumes
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Solo character spotlights — the origin stories.
            </p>
          </div>
          <span className="rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {HERO_VOLUMES.length} {HERO_VOLUMES.length === 1 ? "Volume" : "Volumes"}
          </span>
        </div>
        <IssueGrid issues={HERO_VOLUMES} />
      </section>

      {/* Footer note */}
      <footer className="rounded-xl border bg-muted/30 p-4 text-center">
        <p className="text-xs text-muted-foreground text-pretty">
          {isLoading
            ? "Loading the latest editions…"
            : "Have an idea for a story arc or want to nominate a teammate for their own Hero Volume? Use the Issue New Edition button above, or mention it in your next debrief."}
        </p>
      </footer>

      {/* Issue New Edition dialog. SWR's `mutate` revalidates the
          editions list after a successful publish so the new cover
          appears at the top without a manual refresh. */}
      <IssueNewEditionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onIssued={() => {
          void mutate()
        }}
      />
    </div>
  )
}
