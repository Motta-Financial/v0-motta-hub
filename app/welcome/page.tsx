import Link from "next/link"
import Image from "next/image"
import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Sparkles,
  ShieldCheck,
  Workflow,
  FileSearch,
  Database,
  Calendar,
} from "lucide-react"

export const metadata: Metadata = {
  title: "Motta Financial — Welcome",
  description:
    "Tech-forward CPAs. Powered by ALFRED Ai. Tax, Accounting, and Advisory for owners and operators.",
}

// Anonymous landing surface served on motta.cpa AND hub.motta.cpa.
//
// The visual language intentionally mirrors motta.cpa: cream background
// (#FBF8F2), dark sage / forest greens, generous serif-feeling display
// type (Inter at heavy weights, tight tracking), and the Mottainai
// philosophy. We do NOT recreate the full marketing site — this page is
// a bridge from the public web into the Hub: hero → ALFRED panel →
// practice areas → CTA. Staff sign-in lives at /login.
//
// Brand palette (locked to match motta.cpa):
//   --motta-cream      #FBF8F2  (page background)
//   --motta-cream-soft #F4EFE8  (cards, header)
//   --motta-ink        #1F261C  (primary text + dark sections)
//   --motta-sage       #5C6B43  (primary brand green)
//   --motta-sage-light #A8C566  (accents / chips)
//   --motta-rule       #E5DFD3  (hairlines on cream)

const PRACTICE_AREAS = [
  {
    title: "Tax Planning & Preparation",
    body: "Year-round tax strategy and stress-free filing for individuals, families, and business owners. ALFRED Ai drafts your return in minutes so your CPA can focus on saving you money.",
  },
  {
    title: "Tax Advisory",
    body: "Practical advice for the moments that matter: starting a business, picking the right entity, navigating stock options (RSUs, ISOs, ESPPs), buying real estate, or operating across state lines.",
  },
  {
    title: "Accounting & Bookkeeping",
    body: "Clean books, on-time payroll, monthly reporting, and a fractional CFO when you need one — so you always know where your business stands.",
  },
  {
    title: "Business AI Transformation",
    body: "Our AI-certified team rebuilds the way your business runs — replacing manual work with smart automation so your people focus on the things that actually grow the company.",
  },
  {
    title: "Financial Planning",
    body: "A single plan that ties together your taxes, investments, retirement, and estate — led by a CFP through Motta Wealth Management.",
  },
]

const ALFRED_PILLARS = [
  {
    icon: Database,
    title: "Client Intelligence",
    body: "Every conversation, document, and engagement detail unified into one view — pulling from Karbon, scheduling tools, and our financial systems.",
  },
  {
    icon: FileSearch,
    title: "Lead Intake & Research",
    body: "ALFRED researches prospects, drafts partner-ready answers to tax questions, and routes leads with full context — cold to warm in minutes.",
  },
  {
    icon: Workflow,
    title: "Engagement Workflow",
    body: "Proposals, payments (Stripe), scheduling (Calendly/Zoom), and onboarding coordinated end-to-end. Clients sign once, pay once, get to work.",
  },
  {
    icon: Calendar,
    title: "Internal Operations",
    body: "Daily briefings, weekly performance recaps, team recognition, and early surfacing of issues. The firm runs without anyone chasing status.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance & Audit Trail",
    body: "Every AI interaction logged, every model decision auditable, every prompt version-controlled — for clients and regulators.",
  },
]

const ABOUT_BULLETS = [
  "Proactive tax strategy & planning",
  "Office of the CFO under one roof",
  "ALFRED Ai automation & faster turnaround",
  "Partner-led, senior-level engagements",
]

export default function WelcomePage() {
  return (
    <main
      className="min-h-screen font-sans"
      style={{ backgroundColor: "#FBF8F2", color: "#1F261C" }}
    >
      {/* Top announcement strip — mirrors the dark sage banner on motta.cpa */}
      <div
        className="w-full text-sm"
        style={{
          background:
            "linear-gradient(90deg, #1F261C 0%, #2C3527 50%, #1F261C 100%)",
          color: "#F4EFE8",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-6 py-2.5 text-center">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: "rgba(168,197,102,0.15)",
              color: "#A8C566",
            }}
          >
            <Sparkles className="h-3 w-3" />
            ALFRED Ai
          </span>
          <p className="text-[13px] leading-snug text-[#E5DFD3]">
            Routine tax prep, drafted in minutes — so our CPAs can spend their
            time on planning, not data entry.
          </p>
        </div>
      </div>

      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{
          backgroundColor: "rgba(251,248,242,0.92)",
          borderColor: "#E5DFD3",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/welcome" className="flex items-center gap-3">
            <Image
              src="/welcome/motta-logo.png"
              alt="Motta — Tax | Accounting | Advisory"
              width={170}
              height={48}
              priority
              className="h-10 w-auto"
            />
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            <a
              href="https://motta.cpa/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1F261C] transition-colors hover:text-[#5C6B43]"
            >
              Home
            </a>
            <a
              href="https://motta.cpa/about-us"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1F261C] transition-colors hover:text-[#5C6B43]"
            >
              About Us
            </a>
            <a
              href="https://motta.cpa/services"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1F261C] transition-colors hover:text-[#5C6B43]"
            >
              Services
            </a>
            <a
              href="https://motta.cpa/contact"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-[#1F261C] transition-colors hover:text-[#5C6B43]"
            >
              Contact
            </a>
          </nav>
          <Button
            asChild
            size="sm"
            className="rounded-full px-5 font-medium"
            style={{
              backgroundColor: "#5C6B43",
              color: "#FBF8F2",
            }}
          >
            <Link href="/login">Log In</Link>
          </Button>
        </div>
      </header>

      {/* Hero — mirrors the dark hero on motta.cpa with photo + sage overlay */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "url(/welcome/hero.jpg)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(120deg, rgba(31,38,28,0.92) 0%, rgba(31,38,28,0.78) 55%, rgba(31,38,28,0.55) 100%)",
          }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-6 py-24 text-[#F4EFE8] lg:py-32">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{
              backgroundColor: "rgba(168,197,102,0.18)",
              color: "#C7D89A",
              border: "1px solid rgba(168,197,102,0.35)",
            }}
          >
            <Sparkles className="h-3 w-3" />
            Powered by ALFRED Ai
          </span>
          <h1 className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl lg:text-[64px]">
            Tax · Accounting · Advisory.
            <br />
            <span style={{ color: "#A8C566" }}>Drafted in minutes.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-[#E5DFD3] sm:text-lg">
            Founded in 2023 by Big Four alumni in Boston and Las Vegas, Motta
            Financial pairs hands-on tax and accounting advice with our own AI
            platform — so your CPA spends time on you and your goals, not on
            paperwork.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="rounded-full px-7 font-medium"
              style={{ backgroundColor: "#A8C566", color: "#1F261C" }}
            >
              <a
                href="https://motta.cpa/intake"
                target="_blank"
                rel="noopener noreferrer"
              >
                Boot up an engagement
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-[#E5DFD3]/40 bg-transparent px-7 font-medium text-[#F4EFE8] hover:bg-[#F4EFE8]/10 hover:text-[#F4EFE8]"
            >
              <Link href="/login">
                Hub log in
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* About — cream section with photo + bullets, mirroring motta.cpa */}
      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="relative">
            <div
              className="absolute -left-3 -top-3 h-20 w-20 rounded-md"
              style={{ backgroundColor: "#A8C566" }}
              aria-hidden
            />
            <div
              className="relative overflow-hidden rounded-md border"
              style={{ borderColor: "#E5DFD3" }}
            >
              <Image
                src="/welcome/about.jpg"
                alt="Motta Financial team"
                width={1200}
                height={800}
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5C6B43]">
              About Motta Financial
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-[42px]">
              Tech-forward CPAs powered by ALFRED Ai — for clients who want a
              firm that thinks ahead.
            </h2>
            <p className="mt-5 text-pretty text-base leading-relaxed text-[#3F4A38]">
              Motta Financial is a modern CPA firm built around proactive tax
              strategy, integrated advisory, and the full Office of the CFO. We
              serve business owners, executives, and channel partners
              nationally — pairing senior-level relationships with our
              proprietary AI platform to deliver sophisticated work product at
              speeds traditional firms can&apos;t match.
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {ABOUT_BULLETS.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ color: "#5C6B43" }}
                  />
                  <span className="text-[#1F261C]">{b}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                asChild
                className="rounded-full px-5"
                style={{ backgroundColor: "#1F261C", color: "#FBF8F2" }}
              >
                <a
                  href="https://motta.cpa/about-us"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  About Motta
                  <ArrowRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                className="rounded-full border-[#5C6B43]/40 bg-transparent px-5 text-[#1F261C] hover:bg-[#5C6B43]/10"
              >
                <a
                  href="https://motta.cpa/about-us#team"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Meet the Team
                </a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ALFRED dark-green section — mirrors the deep forest panel on motta.cpa */}
      <section
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #1F261C 0%, #2C3527 60%, #1F261C 100%)",
          color: "#F4EFE8",
        }}
      >
        <div className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[#A8C566]/30 bg-[#A8C566]/10">
              <Image
                src="/welcome/alfred-ai.png"
                alt="ALFRED Ai"
                width={48}
                height={48}
                className="h-10 w-10"
              />
            </div>
            <p
              className="text-xs font-semibold uppercase tracking-[0.22em]"
              style={{ color: "#A8C566" }}
            >
              The AI platform powering Motta
            </p>
            <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-[44px]">
              ALFRED Ai eliminates the administrative drag holding traditional
              firms back.
            </h2>
            <p className="mt-5 text-pretty text-[#D6CFC1] sm:text-lg">
              Motta is built on the Japanese principle of{" "}
              <em className="font-medium" style={{ color: "#F4EFE8" }}>
                Mottainai
              </em>{" "}
              — too good to waste. ALFRED Ai is how we live that philosophy: a
              proprietary AI platform that lets our team focus entirely on the
              work that actually moves clients forward.
            </p>
          </div>

          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ALFRED_PILLARS.map((p) => {
              const Icon = p.icon
              return (
                <div
                  key={p.title}
                  className="rounded-md border p-6 transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.03)",
                    borderColor: "rgba(168,197,102,0.18)",
                  }}
                >
                  <div
                    className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md"
                    style={{
                      backgroundColor: "rgba(168,197,102,0.15)",
                      color: "#A8C566",
                    }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-base font-semibold tracking-tight text-[#F4EFE8]">
                    {p.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#C9C2B3]">
                    {p.body}
                  </p>
                </div>
              )
            })}

            {/* Strategic differentiator card — mirrors the highlighted card on motta.cpa */}
            <div
              className="rounded-md border p-6 lg:col-span-3"
              style={{
                background:
                  "linear-gradient(135deg, rgba(168,197,102,0.18) 0%, rgba(168,197,102,0.06) 100%)",
                borderColor: "rgba(168,197,102,0.45)",
              }}
            >
              <div className="grid items-center gap-6 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <p
                    className="text-xs font-semibold uppercase tracking-[0.22em]"
                    style={{ color: "#A8C566" }}
                  >
                    Strategic differentiator
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-tight text-[#F4EFE8] sm:text-3xl">
                    Tax returns, drafted in minutes.
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#D6CFC1] sm:text-base">
                    Motta has partner-grade access to Intuit ProConnect&apos;s
                    API, which lets ALFRED Ai prepare your return in minutes.
                    That means a faster turnaround for you and more time for
                    your CPA to spend looking for ways to save you money.
                  </p>
                </div>
                <div className="flex justify-start lg:justify-end">
                  <Button
                    asChild
                    className="rounded-full px-6"
                    style={{ backgroundColor: "#A8C566", color: "#1F261C" }}
                  >
                    <a
                      href="https://motta.cpa/services/tax"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Learn more
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Five practice areas */}
      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#5C6B43]">
            What we deliver
          </p>
          <h2 className="mt-3 text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-[42px]">
            Five practice areas, one team that talks to each other.
          </h2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PRACTICE_AREAS.map((p, i) => (
            <article
              key={p.title}
              className="group rounded-md border bg-white/40 p-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ borderColor: "#E5DFD3" }}
            >
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.2em]"
                style={{ color: "#5C6B43" }}
              >
                {String(i + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-2 text-lg font-semibold tracking-tight text-[#1F261C]">
                {p.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[#3F4A38]">
                {p.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Final CTA — sage panel */}
      <section
        className="relative overflow-hidden"
        style={{ backgroundColor: "#5C6B43", color: "#F4EFE8" }}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-6 py-16 lg:flex-row lg:items-center lg:justify-between lg:py-20">
          <div className="max-w-2xl">
            <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Ready to talk to a tech-forward CPA?
            </h2>
            <p className="mt-3 text-[#E5DFD3]">
              Tell us about your situation and a member of the Motta team will
              follow up within one business day. New clients can move straight
              into our intake to get scoped faster — existing clients can reach
              us through the client portal.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              size="lg"
              className="rounded-full px-6"
              style={{ backgroundColor: "#A8C566", color: "#1F261C" }}
            >
              <a
                href="https://motta.cpa/intake"
                target="_blank"
                rel="noopener noreferrer"
              >
                Boot up an engagement
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-[#F4EFE8]/40 bg-transparent px-6 text-[#F4EFE8] hover:bg-[#F4EFE8]/10 hover:text-[#F4EFE8]"
            >
              <a
                href="https://motta.cpa/contact"
                target="_blank"
                rel="noopener noreferrer"
              >
                Send us a message
              </a>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="rounded-full px-6 text-[#F4EFE8] hover:bg-[#F4EFE8]/10 hover:text-[#F4EFE8]"
            >
              <Link href="/login">
                Open the portal
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="border-t"
        style={{ backgroundColor: "#F4EFE8", borderColor: "#E5DFD3" }}
      >
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <Image
              src="/welcome/motta-logo.png"
              alt="Motta"
              width={140}
              height={40}
              className="h-8 w-auto opacity-90"
            />
            <span className="text-xs text-[#3F4A38]">
              &copy; {new Date().getFullYear()} Motta Financial. All rights
              reserved.
            </span>
          </div>
          <div className="flex items-center gap-5 text-sm">
            <Link
              href="/legal/terms"
              className="text-[#3F4A38] transition-colors hover:text-[#1F261C]"
            >
              Terms
            </Link>
            <Link
              href="/legal/privacy"
              className="text-[#3F4A38] transition-colors hover:text-[#1F261C]"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="text-[#3F4A38] transition-colors hover:text-[#1F261C]"
            >
              Hub log in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
