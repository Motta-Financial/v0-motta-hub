import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight, Check } from "lucide-react"

export const metadata: Metadata = {
  title: "ALFRED Hub — Welcome",
  description:
    "ALFRED is the operations Ai for Motta Financial — a tech-forward CPA firm established in 2023.",
}

// Anonymous landing surface for the ALFRED Hub. The visual system mirrors
// motta.cpa: cream #FBF8F2 page, dark forest #0F140C accent panels with the
// hero photograph, sage #A8C566 brand color for callouts and primary CTAs,
// Inter for everything. The page now leads with brand + story instead of
// intake forms — Motta keeps its public marketing forms on motta.cpa.
//
// Color tokens (Motta brand, sourced from motta.cpa):
//   --motta-cream      #FBF8F2  page surface
//   --motta-forest     #0F140C  dark hero / footer
//   --motta-forest-2   #1D2620  panel divider, secondary dark
//   --motta-sage       #A8C566  primary accent (CTA, eyebrow, checkmarks)
//   --motta-ink        #1D2620  body text on cream
//   --motta-ink-muted  #5C6356  secondary text on cream
const COLORS = {
  cream: "#FBF8F2",
  forest: "#0F140C",
  forest2: "#1D2620",
  sage: "#A8C566",
  sageDark: "#8FAE4F",
  ink: "#1D2620",
  inkMuted: "#5C6356",
  rule: "rgba(29,38,32,0.10)",
}

export default function WelcomePage() {
  return (
    <main
      className="min-h-screen font-sans"
      style={{ backgroundColor: COLORS.cream, color: COLORS.ink }}
    >
      {/* Top thin announcement strip — same pattern motta.cpa uses to
          surface the ALFRED Ai positioning above the main nav. */}
      <div
        className="border-b text-xs uppercase tracking-[0.2em]"
        style={{
          backgroundColor: COLORS.forest,
          color: COLORS.cream,
          borderColor: "rgba(168,197,102,0.15)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5">
          <span style={{ color: COLORS.sage }}>Powered by ALFRED Ai</span>
          <span className="hidden sm:inline" style={{ color: "rgba(244,239,232,0.7)" }}>
            Tech-forward CPAs &middot; Est. 2023
          </span>
        </div>
      </div>

      {/* Header / nav */}
      <header
        className="border-b"
        style={{ backgroundColor: COLORS.cream, borderColor: COLORS.rule }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/welcome" className="flex items-center gap-3">
            <img
              src="/images/alfred-wordmark.png"
              alt="ALFRED"
              className="h-9 w-auto"
            />
            <span
              className="hidden text-xs font-semibold uppercase tracking-[0.22em] sm:inline"
              style={{ color: COLORS.inkMuted }}
            >
              Hub
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <a
              href="https://motta.cpa"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden rounded-full px-4 py-2 text-sm font-medium transition-colors sm:inline-block"
              style={{ color: COLORS.ink }}
            >
              motta.cpa
            </a>
            <Link
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors hover:opacity-90"
              style={{ backgroundColor: COLORS.forest, color: COLORS.cream }}
            >
              Log in
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero — dark forest panel with the motta.cpa hero photograph,
          using the same image-over-gradient treatment as the public site. */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: COLORS.forest, color: COLORS.cream }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: "url('/welcome/hero.jpg')",
            backgroundSize: "cover",
            backgroundPosition: "center",
            opacity: 0.25,
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(15,20,12,0.55) 0%, rgba(15,20,12,0.92) 70%, rgba(15,20,12,1) 100%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 lg:py-32">
          <div className="max-w-3xl space-y-6">
            <p
              className="text-xs font-semibold uppercase tracking-[0.28em]"
              style={{ color: COLORS.sage }}
            >
              Welcome to ALFRED
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[64px]">
              The operations Ai for a tech-forward CPA firm.
            </h1>
            <p
              className="max-w-2xl text-pretty text-lg leading-relaxed"
              style={{ color: "rgba(244,239,232,0.78)" }}
            >
              ALFRED is the in-house assistant powering Motta Financial. He
              drafts tax returns, briefs the team before every meeting, and
              quietly keeps engagements on track — so the humans can focus on
              the work that matters.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5"
                style={{ backgroundColor: COLORS.sage, color: COLORS.forest }}
              >
                Team log in
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="https://motta.cpa"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition-colors"
                style={{
                  borderColor: "rgba(244,239,232,0.4)",
                  color: COLORS.cream,
                }}
              >
                Visit motta.cpa
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* About — text-only, no photograph. The composition centers the
          firm's story with the Motta brand colors only. */}
      <section
        className="mx-auto max-w-4xl px-6 py-24 text-center lg:py-28"
      >
        <p
          className="text-xs font-semibold uppercase tracking-[0.28em]"
          style={{ color: COLORS.sageDark }}
        >
          About Motta Financial
        </p>
        <h2 className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          A modern firm built around the work, not the busywork.
        </h2>
        <p
          className="mx-auto mt-6 max-w-2xl text-pretty leading-relaxed"
          style={{ color: COLORS.inkMuted }}
        >
          Motta Financial was founded in 2023 to be a different kind of CPA
          firm — one where technology handles the repetition so the team can
          spend their time advising. ALFRED is how we deliver on that promise
          across tax, advisory, and bookkeeping.
        </p>
        <div className="mt-6 flex justify-center">
          <span
            className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.22em]"
            style={{
              backgroundColor: COLORS.forest,
              borderColor: COLORS.forest,
              color: COLORS.cream,
            }}
          >
            <span style={{ color: COLORS.sage }}>Established</span>
            <span>2023</span>
          </span>
        </div>
        <ul className="mx-auto mt-12 grid max-w-3xl gap-3 text-left sm:grid-cols-2">
          {[
            "Drafted tax returns in minutes, not days",
            "Pre-meeting briefs for every engagement",
            "Always-on document organization",
            "Calendar, Zoom, and email kept in sync",
          ].map((point) => (
            <li key={point} className="flex items-start gap-3">
              <span
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: COLORS.sage, color: COLORS.forest }}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span style={{ color: COLORS.ink }}>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ALFRED Ai dark panel — mirrors motta.cpa's signature dark green
          differentiator section. */}
      <section
        className="relative"
        style={{ backgroundColor: COLORS.forest, color: COLORS.cream }}
      >
        <div className="mx-auto max-w-6xl px-6 py-24 lg:py-28">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <div className="space-y-6">
              <p
                className="text-xs font-semibold uppercase tracking-[0.28em]"
                style={{ color: COLORS.sage }}
              >
                Powered by ALFRED Ai
              </p>
              <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                The quiet partner inside every Motta engagement.
              </h2>
              <p
                className="text-pretty leading-relaxed"
                style={{ color: "rgba(244,239,232,0.78)" }}
              >
                ALFRED is the connective tissue between ProConnect, Karbon,
                Calendly, Zoom, and the rest of the firm&apos;s stack. The
                team sees one calm dashboard. ALFRED handles everything else.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: "Tax returns, drafted in minutes",
                  body: "Phase 1 import + computed lines + carryovers, ready for review.",
                  highlight: true,
                },
                {
                  title: "Always meeting-ready",
                  body: "Pre-call briefs assembled from Karbon, ProConnect, and prior chats.",
                },
                {
                  title: "Engagements on track",
                  body: "ALFRED watches deadlines, work statuses, and waiting items.",
                },
                {
                  title: "Tag, every time",
                  body: "Calendly + Zoom auto-tagged to clients, work items, and services.",
                },
              ].map((card) => (
                <div
                  key={card.title}
                  className="rounded-md border p-5"
                  style={{
                    backgroundColor: card.highlight
                      ? COLORS.sage
                      : COLORS.forest2,
                    borderColor: card.highlight
                      ? COLORS.sageDark
                      : "rgba(168,197,102,0.20)",
                    color: card.highlight ? COLORS.forest : COLORS.cream,
                  }}
                >
                  <div className="text-base font-semibold leading-snug">
                    {card.title}
                  </div>
                  <div
                    className="mt-2 text-sm leading-relaxed"
                    style={{
                      color: card.highlight
                        ? "rgba(29,38,32,0.78)"
                        : "rgba(244,239,232,0.72)",
                    }}
                  >
                    {card.body}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="border-t"
        style={{ backgroundColor: COLORS.cream, borderColor: COLORS.rule }}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <img
              src="/images/alfred-wordmark.png"
              alt="ALFRED"
              className="h-7 w-auto opacity-80"
            />
            <span
              className="text-sm"
              style={{ color: COLORS.inkMuted }}
            >
              &copy; {new Date().getFullYear()} Motta Financial &middot; Est. 2023
            </span>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <a
              href="https://motta.cpa"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:opacity-70"
              style={{ color: COLORS.inkMuted }}
            >
              motta.cpa
            </a>
            <Link
              href="/legal/terms"
              className="transition-colors hover:opacity-70"
              style={{ color: COLORS.inkMuted }}
            >
              Terms
            </Link>
            <Link
              href="/legal/privacy"
              className="transition-colors hover:opacity-70"
              style={{ color: COLORS.inkMuted }}
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="font-semibold transition-colors hover:opacity-70"
              style={{ color: COLORS.ink }}
            >
              Team log in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
