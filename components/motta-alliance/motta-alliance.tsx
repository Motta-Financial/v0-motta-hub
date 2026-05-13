"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  BookOpen,
  Download,
  ExternalLink,
  Plus,
  Shield,
  Sparkles,
  Users,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { IssueNewEditionDialog } from "@/components/motta-alliance/issue-new-edition-dialog"
import {
  ALLIANCE_COVER_URL,
  HERO_PROFILES,
  type HeroProfile,
} from "@/lib/motta-alliance/hero-profiles"

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
  // Standard Alliance issue — deep midnight olive with the signature
  // comic-green "Alliance" accent. Used for the canonical numbered
  // issues and as the safe fallback for anything DB-backed.
  olive: {
    bg: "#0F140C",
    eyebrow: "#A8C566",
    title: "#F4EFE8",
    arc: "#A8C566",
    tagline: "#D5D0C8",
    badge: "#A8C566",
    accent: "#A8C566",
    spotlight:
      "radial-gradient(circle at 30% 20%, rgba(168,197,102,0.18), transparent 60%), radial-gradient(circle at 80% 90%, rgba(168,197,102,0.10), transparent 55%)",
  },
  // "Night issue" / standalone arc — same dark base but a warmer
  // amber spotlight so it reads like a sunset scene cover.
  sunset: {
    bg: "#1A1408",
    eyebrow: "#E6A85C",
    title: "#F4EFE8",
    arc: "#E6A85C",
    tagline: "#D5D0C8",
    badge: "#E6A85C",
    accent: "#E6A85C",
    spotlight:
      "radial-gradient(circle at 70% 80%, rgba(230,168,92,0.30), transparent 60%), radial-gradient(circle at 20% 10%, rgba(168,197,102,0.10), transparent 50%)",
  },
  // Taxverse arc — slightly lifted dark olive with both accent rays.
  taxverse: {
    bg: "#11170D",
    eyebrow: "#A8C566",
    title: "#F4EFE8",
    arc: "#E6A85C",
    tagline: "#D5D0C8",
    badge: "#E6A85C",
    accent: "#A8C566",
    spotlight:
      "radial-gradient(circle at 80% 20%, rgba(230,168,92,0.22), transparent 55%), radial-gradient(circle at 10% 80%, rgba(168,197,102,0.15), transparent 55%)",
  },
  // Solo Hero Volume — same dark base, distinguished from numbered
  // team issues by a lotus-green title color so they scan apart.
  "cream-olive": {
    bg: "#0D110A",
    eyebrow: "#D5D0C8",
    title: "#A8C566",
    arc: "#E6A85C",
    tagline: "#D5D0C8",
    badge: "#A8C566",
    accent: "#E6A85C",
    spotlight:
      "radial-gradient(circle at 25% 80%, rgba(168,197,102,0.22), transparent 60%), radial-gradient(circle at 80% 20%, rgba(230,168,92,0.10), transparent 60%)",
  },
  // Amber-led variant — slightly warmer base for character spotlights
  // that lean into a single hero's signature color.
  amber: {
    bg: "#14110A",
    eyebrow: "#E6A85C",
    title: "#F4EFE8",
    arc: "#A8C566",
    tagline: "#D5D0C8",
    badge: "#E6A85C",
    accent: "#E6A85C",
    spotlight:
      "radial-gradient(circle at 70% 30%, rgba(230,168,92,0.28), transparent 60%), radial-gradient(circle at 10% 90%, rgba(168,197,102,0.12), transparent 55%)",
  },
}

// Shared comic-book typographic treatment for issue covers — black,
// uppercase, condensed, with a slight text shadow so it reads like a
// printed cover even on a flat web color.
const COMIC_TITLE_CLASS =
  "font-sans text-3xl font-black uppercase italic leading-[0.95] tracking-tight text-balance md:text-5xl"
const COMIC_TITLE_SHADOW =
  "0 2px 0 rgba(0,0,0,0.55), 0 0 24px rgba(0,0,0,0.45)"

/** Inline SVG of the Motta lotus signet. Rendered as a single-color
 *  mark so we can recolor it per surface without juggling PNG variants
 *  — used as a faint watermark behind issue titles, as a corner badge
 *  on the page hero, and in the hero-profile gallery dividers. */
function LotusMark({
  className,
  color = "currentColor",
}: {
  className?: string
  color?: string
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M32 6c-3 8-3 14 0 22 3-8 3-14 0-22z" />
      <path d="M32 12c-7 6-9 12-7 22 7-3 11-8 12-16 .3-2 .3-4-5-6z" transform="rotate(-22 32 28)" />
      <path d="M32 12c-7 6-9 12-7 22 7-3 11-8 12-16 .3-2 .3-4-5-6z" transform="rotate(22 32 28) scale(-1 1) translate(-64 0)" />
      <path d="M10 28c-2 8 4 18 22 22 1-10-3-18-13-22-4-1-7-1-9 0z" />
      <path d="M54 28c2 8-4 18-22 22-1-10 3-18 13-22 4-1 7-1 9 0z" />
    </svg>
  )
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
    <Card
      className="group overflow-hidden rounded-lg border shadow-lg transition-all hover:-translate-y-1 hover:shadow-2xl"
      style={{
        borderColor: "rgba(168,197,102,0.25)",
        boxShadow:
          "0 10px 30px -10px rgba(0,0,0,0.45), 0 0 0 1px rgba(168,197,102,0.06) inset",
      }}
    >
      {/* Cover canvas — 3:4 portrait, like a real comic cover. The
          double border + inset glow gives the printed-comic feel even
          on a flat web color. */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden"
        style={{
          backgroundColor: styles.bg,
          backgroundImage: styles.spotlight,
        }}
      >
        {/* Inner halftone-ish noise — keeps the flat color from feeling
            empty. Uses a single small SVG dot grid so we don't ship any
            extra raster assets just for texture. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.10]"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(255,255,255,0.55) 1px, transparent 1.5px)",
            backgroundSize: "6px 6px",
          }}
        />

        {/* Faint lotus watermark — the Alliance signet, anchored to the
            center so the title sits on top of it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <LotusMark className="h-3/5 w-3/5 opacity-[0.06]" color={styles.accent} />
        </div>

        {/* Issue number badge (top-left) — the canonical comic-cover
            corner stamp. Sharp-cornered, monospaced — like a real
            cover-date box. */}
        <div
          className="absolute left-3 top-3 inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{
            backgroundColor: styles.badge,
            color: "#0F140C",
            clipPath:
              "polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)",
          }}
        >
          <BookOpen className="h-3 w-3" strokeWidth={2.5} />
          {issue.number}
        </div>

        {/* Series eyebrow (top-right) */}
        <div
          className="absolute right-3 top-3 text-[10px] font-semibold uppercase tracking-[0.22em]"
          style={{ color: styles.eyebrow }}
        >
          {issue.series}
        </div>

        {/* Center stack — arc badge, big title, tagline */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          {issue.arc && (
            <div
              className="mb-3 inline-flex items-center rounded-sm border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
              style={{
                borderColor: styles.arc,
                color: styles.arc,
                backgroundColor: "rgba(0,0,0,0.25)",
              }}
            >
              {issue.arc}
            </div>
          )}
          <h3
            className={COMIC_TITLE_CLASS}
            style={{
              color: styles.title,
              textShadow: COMIC_TITLE_SHADOW,
            }}
          >
            {issue.title}
          </h3>
        </div>

        {/* Tagline (bottom) — sits inside a thin accent rule like a
            comic-cover splash caption. */}
        <div
          className="absolute inset-x-4 bottom-4 border-t pt-2 text-center text-[11px] font-medium italic leading-snug text-pretty"
          style={{
            color: styles.tagline,
            borderColor: `${styles.accent}55`,
          }}
        >
          &ldquo;{issue.tagline}&rdquo;
        </div>
      </div>

      {/* Meta strip below the cover — themed dark so it carries the
          same printed-comic feel as the cover above it. */}
      <CardContent
        className="space-y-3 p-4"
        style={{ backgroundColor: "#0F140C" }}
      >
        {/* Featured characters — chips. */}
        <div className="flex items-start gap-2">
          <Users
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
            style={{ color: "#A8C566" }}
          />
          <div className="flex flex-wrap gap-1">
            {issue.characters.map((c) => (
              <span
                key={c}
                className="rounded-sm border px-2 py-0.5 text-[10px] font-semibold"
                style={{
                  color: "#D5D0C8",
                  borderColor: "rgba(168,197,102,0.25)",
                  backgroundColor: "rgba(168,197,102,0.06)",
                }}
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* AI-generated preview + issuance byline (only present on DB-
            backed editions uploaded through the new-edition dialog).
            Line-clamped to 4 lines so the gallery card stays uniform
            in height — readers can hover to see the full text. */}
        {issue.aiSummary && (
          <div
            className="rounded-md border border-dashed px-3 py-2"
            title={issue.aiSummary}
            style={{
              borderColor: "rgba(168,197,102,0.35)",
              backgroundColor: "rgba(168,197,102,0.05)",
            }}
          >
            <div
              className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "#A8C566" }}
            >
              <Sparkles className="h-2.5 w-2.5" />
              ALFRED Preview
            </div>
            <p
              className="mt-1 line-clamp-4 text-xs leading-relaxed"
              style={{ color: "#D5D0C8" }}
            >
              {issue.aiSummary}
            </p>
            {(issue.issuedBy || issue.publishedAt) && (
              <p className="mt-1.5 text-[10px]" style={{ color: "#9B968D" }}>
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
            size="sm"
            className="flex-1 font-bold uppercase tracking-wider"
            style={{
              backgroundColor: "#A8C566",
              color: "#0F140C",
            }}
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
            className="flex-1 font-bold uppercase tracking-wider"
            style={{
              borderColor: "rgba(168,197,102,0.4)",
              color: "#A8C566",
              backgroundColor: "transparent",
            }}
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
    <div
      className="-mx-4 -my-8 min-h-screen px-4 py-8 md:-mx-6 md:-my-10 md:px-6 md:py-10"
      style={{
        backgroundColor: "#0A0E08",
        backgroundImage:
          "radial-gradient(circle at 15% 0%, rgba(168,197,102,0.10), transparent 50%)," +
          "radial-gradient(circle at 90% 100%, rgba(230,168,92,0.08), transparent 55%)",
      }}
    >
      <div className="mx-auto max-w-6xl space-y-12">
      {/* Hero — full-bleed comic cover splash. The right side holds the
          actual Issue #1 cover art so the page literally opens with the
          comic, and the left side carries the in-universe pitch + the
          "Issue New Edition" CTA. */}
      <header
        className="relative overflow-hidden rounded-2xl border p-6 md:p-10"
        style={{
          backgroundColor: "#0F140C",
          borderColor: "rgba(168,197,102,0.30)",
          boxShadow:
            "0 0 0 1px rgba(168,197,102,0.08) inset, 0 30px 80px -40px rgba(0,0,0,0.75)",
        }}
      >
        {/* Decorative halftone-ish radial accent so the hero isn't a
            flat rectangle. Comic-green at top, amber at bottom. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-0"
          style={{
            backgroundImage:
              "radial-gradient(circle at 90% 0%, rgba(168,197,102,0.18), transparent 55%)," +
              "radial-gradient(circle at 0% 100%, rgba(230,168,92,0.10), transparent 55%)",
          }}
        />
        {/* Faint dot grid — printed-comic halftone vibe. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-0 opacity-[0.08]"
          style={{
            backgroundImage:
              "radial-gradient(circle at center, rgba(244,239,232,0.8) 1px, transparent 1.5px)",
            backgroundSize: "8px 8px",
          }}
        />
        <div className="relative z-10 grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
          <div className="max-w-2xl">
            <div
              className="mb-4 inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
              style={{
                borderColor: "rgba(168,197,102,0.5)",
                color: "#A8C566",
                backgroundColor: "rgba(168,197,102,0.08)",
              }}
            >
              <Shield className="h-3 w-3" />
              Motta Financial Alliance &middot; Issue Vault
            </div>
            <h1
              className="font-sans text-4xl font-black uppercase italic leading-[0.95] tracking-tight text-balance md:text-6xl"
              style={{
                color: "#F4EFE8",
                textShadow:
                  "0 2px 0 rgba(0,0,0,0.6), 0 0 30px rgba(168,197,102,0.18)",
              }}
            >
              The <span style={{ color: "#A8C566" }}>A-Team</span>
            </h1>
            <p
              className="mt-3 font-sans text-base font-bold uppercase tracking-[0.12em]"
              style={{ color: "#D5D0C8" }}
            >
              Accounting Division
            </p>
            <p
              className="mt-5 text-sm leading-relaxed text-pretty"
              style={{ color: "#B8B3AA" }}
            >
              Fighting the IRS. Exposing fractional CFOs. Eradicating dinosaur
              tax preppers. The Motta Alliance is the in-universe comic series
              chronicling every hero who fights for financial clarity across
              the Taxverse. Click any cover to read, download to keep, or
              issue your own edition for the team.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={() => setDialogOpen(true)}
                className="font-bold uppercase tracking-wider"
                style={{
                  backgroundColor: "#A8C566",
                  color: "#0F140C",
                }}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Issue New Edition
              </Button>
              <a
                href="#hero-profiles"
                className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition-colors"
                style={{ color: "#A8C566" }}
              >
                <Users className="h-3.5 w-3.5" />
                Meet the Heroes
              </a>
            </div>
          </div>

          {/* Cover art — the actual MA cover image. Hidden on small
              screens so the headline stays the focal point on phones. */}
          <div className="relative hidden md:block">
            <div
              className="relative h-[360px] w-[260px] overflow-hidden rounded-md border-2"
              style={{
                borderColor: "rgba(168,197,102,0.35)",
                boxShadow:
                  "0 30px 60px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(168,197,102,0.15) inset",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={ALLIANCE_COVER_URL}
                alt="The A-Team: Accounting Division — Motta Financial Alliance Issue #1 cover"
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            <div
              aria-hidden
              className="absolute -bottom-3 -left-3 -right-3 -z-10 h-[360px] rounded-md"
              style={{
                backgroundColor: "rgba(168,197,102,0.18)",
                filter: "blur(24px)",
              }}
            />
          </div>

        </div>
      </header>

      {/* Latest Editions — DB-backed uploads. Hidden when none exist so
          the page doesn't show an empty section on first load. */}
      {dbIssues.length > 0 && (
        <section className="space-y-4">
          <ComicSectionHeader
            kicker="New From the Press"
            title="Latest Editions"
            subtitle="Newly issued via the Hub — announced to the team by ALFRED Ai with a story preview."
            count={dbIssues.length}
            countLabel={dbIssues.length === 1 ? "Edition" : "Editions"}
            icon={<Sparkles className="h-4 w-4" />}
          />
          <IssueGrid issues={dbIssues} />
        </section>
      )}

      {/* Team Issues — seeded constants. */}
      <section className="space-y-4">
        <ComicSectionHeader
          kicker="The Main Series"
          title="Team Issues"
          subtitle="The numbered series — the whole Alliance on a mission."
          count={TEAM_ISSUES.length}
          countLabel={TEAM_ISSUES.length === 1 ? "Issue" : "Issues"}
          icon={<BookOpen className="h-4 w-4" />}
        />
        <IssueGrid issues={TEAM_ISSUES} />
      </section>

      {/* Hero Volumes — seeded constants. */}
      <section className="space-y-4">
        <ComicSectionHeader
          kicker="Solo Spotlights"
          title="Hero Volumes"
          subtitle="Origin stories — one hero at a time."
          count={HERO_VOLUMES.length}
          countLabel={HERO_VOLUMES.length === 1 ? "Volume" : "Volumes"}
          icon={<Zap className="h-4 w-4" />}
        />
        <IssueGrid issues={HERO_VOLUMES} />
      </section>

      {/* Hero Profiles — gallery of the comic-book hero profile pages
          for each teammate. Linked from the page hero so anyone can jump
          straight into the roster. */}
      <section id="hero-profiles" className="space-y-4 scroll-mt-20">
        <ComicSectionHeader
          kicker="The Roster"
          title="Hero Profiles"
          subtitle="Powers, alignments, signature moves. The handbook for every member of the A-Team."
          count={HERO_PROFILES.length}
          countLabel={HERO_PROFILES.length === 1 ? "Hero" : "Heroes"}
          icon={<Users className="h-4 w-4" />}
        />
        <HeroProfileGrid />
      </section>

      {/* Footer note */}
      <footer
        className="rounded-xl border p-4 text-center"
        style={{
          backgroundColor: "rgba(168,197,102,0.04)",
          borderColor: "rgba(168,197,102,0.18)",
        }}
      >
        <p
          className="text-xs text-pretty"
          style={{ color: "#B8B3AA" }}
        >
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
    </div>
  )
}

/**
 * Section header reused across all of the gallery / profile rows.
 * Pulls the page out of the muted-foreground / border defaults of the
 * rest of the Hub and back into the dark-comic palette. Title is the
 * black-italic-comic treatment, subtitle stays calm beige.
 */
function ComicSectionHeader({
  kicker,
  title,
  subtitle,
  count,
  countLabel,
  icon,
}: {
  kicker: string
  title: string
  subtitle: string
  count: number
  countLabel: string
  icon?: React.ReactNode
}) {
  return (
    <div
      className="flex items-end justify-between gap-4 border-b pb-3"
      style={{ borderColor: "rgba(168,197,102,0.18)" }}
    >
      <div>
        <div
          className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em]"
          style={{ color: "#A8C566" }}
        >
          {icon}
          {kicker}
        </div>
        <h2
          className="font-sans text-2xl font-black uppercase italic tracking-tight md:text-3xl"
          style={{
            color: "#F4EFE8",
            textShadow: "0 1px 0 rgba(0,0,0,0.6)",
          }}
        >
          {title}
        </h2>
        <p className="mt-1 text-xs" style={{ color: "#B8B3AA" }}>
          {subtitle}
        </p>
      </div>
      <span
        className={cn(
          "rounded-sm border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest",
        )}
        style={{
          color: "#A8C566",
          borderColor: "rgba(168,197,102,0.4)",
          backgroundColor: "rgba(168,197,102,0.06)",
        }}
      >
        {count} {countLabel}
      </span>
    </div>
  )
}

/**
 * Roster grid — each card is a clickable thumbnail of the comic-book
 * hero-profile page. Clicking opens a modal with the full PNG so the
 * full sheet (Powers, Signature Move, In-Action panels) is readable.
 */
function HeroProfileGrid() {
  const [active, setActive] = useState<HeroProfile | null>(null)
  return (
    <>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {HERO_PROFILES.map((hero) => (
          <HeroProfileTile
            key={hero.slug}
            hero={hero}
            onOpen={() => setActive(hero)}
          />
        ))}
      </div>
      <HeroProfileDialog
        hero={active}
        open={!!active}
        onOpenChange={(open) => !open && setActive(null)}
      />
    </>
  )
}

function HeroProfileTile({
  hero,
  onOpen,
}: {
  hero: HeroProfile
  onOpen: () => void
}) {
  // Each tile renders a tightly-cropped thumbnail of the profile sheet
  // — `object-cover` + a generous portrait aspect-ratio focuses the
  // crop on the splash-art portion of the page (top half) so we don't
  // shrink the whole sheet to unreadable.
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative overflow-hidden rounded-md border text-left transition-all hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus:ring-2"
      style={{
        backgroundColor: "#0F140C",
        borderColor: "rgba(168,197,102,0.25)",
      }}
      aria-label={`Open hero profile for ${hero.name}`}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={hero.imageUrl}
          alt={`${hero.name} — ${hero.alias} — Motta Alliance hero profile`}
          className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-105"
          loading="lazy"
        />
        {/* Bottom gradient so the caption stays readable on any profile
            background (some sheets fade into bright power-level radars). */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-24"
          style={{
            backgroundImage:
              "linear-gradient(to top, rgba(15,20,12,0.95), transparent)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 p-3">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.18em]"
            style={{ color: "#A8C566" }}
          >
            {hero.alias}
          </div>
          <div
            className="mt-0.5 font-sans text-sm font-black uppercase italic tracking-tight"
            style={{ color: "#F4EFE8" }}
          >
            {hero.name}
          </div>
        </div>
      </div>
    </button>
  )
}

function HeroProfileDialog({
  hero,
  open,
  onOpenChange,
}: {
  hero: HeroProfile | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!hero) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92vh] max-w-3xl overflow-hidden border-2 p-0"
        style={{
          backgroundColor: "#0A0E08",
          borderColor: "rgba(168,197,102,0.4)",
        }}
      >
        <DialogTitle className="sr-only">
          {hero.name} — {hero.alias} — Motta Alliance Hero Profile
        </DialogTitle>
        <div className="max-h-[92vh] overflow-y-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hero.imageUrl}
            alt={`${hero.name} — ${hero.alias} — full hero profile sheet`}
            className="block h-auto w-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
