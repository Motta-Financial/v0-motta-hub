"use client"

import { useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { UploadedResources } from "@/components/resources/uploaded-resources"
import {
  RESOURCE_TABS,
  ALFRED_OVERVIEW,
  FEATURE_AREAS,
  INTEGRATIONS,
  SOPS,
  FAQS,
  CLIENT_RESOURCES,
  TEMPLATES,
  type ResourceTab,
  type LucideName,
} from "@/lib/resources/content"
import {
  Compass,
  ClipboardList,
  HelpCircle,
  FolderKanban,
  FileText,
  Bot,
  Users,
  Calendar,
  Video,
  Calculator,
  Receipt,
  Workflow,
  Database,
  Mail,
  CreditCard,
  Briefcase,
  CheckSquare,
  MessageSquare,
  TrendingUp,
  Upload,
  ShieldCheck,
  Inbox,
  Search,
  ArrowRight,
  Copy,
  Check,
  ChevronDown,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

const ICONS: Record<LucideName, LucideIcon> = {
  Compass,
  ClipboardList,
  HelpCircle,
  FolderKanban,
  FileText,
  Bot,
  Users,
  Calendar,
  Video,
  Calculator,
  Receipt,
  Workflow,
  Database,
  Mail,
  CreditCard,
  Briefcase,
  CheckSquare,
  MessageSquare,
  TrendingUp,
  Upload,
  ShieldCheck,
  Inbox,
}

function Icon({ name, className }: { name: LucideName; className?: string }) {
  const Cmp = ICONS[name] ?? FileText
  return <Cmp className={className} />
}

export function ResourcesHub() {
  const searchParams = useSearchParams()
  const initial = (searchParams.get("tab") as ResourceTab) || "hub-guide"
  const validInitial = RESOURCE_TABS.some((t) => t.id === initial)
    ? initial
    : "hub-guide"
  const [tab, setTab] = useState<ResourceTab>(validInitial)

  const active = RESOURCE_TABS.find((t) => t.id === tab) ?? RESOURCE_TABS[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-amber-600">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider">
            Knowledge Base
          </span>
        </div>
        <h1 className="text-pretty text-2xl font-bold text-stone-900 md:text-3xl">
          Resources
        </h1>
        <p className="max-w-2xl text-pretty leading-relaxed text-stone-600">
          Team instructions, standard operating procedures, a bank of client
          resources, and reusable templates — everything you need to run ALFRED
          Hub with confidence.
        </p>
      </header>

      {/* Mobile tab strip */}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
        {RESOURCE_TABS.map((t) => {
          const Cmp = ICONS[t.icon] ?? Compass
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "border-stone-900 bg-stone-900 text-stone-50"
                  : "border-stone-200 bg-white text-stone-600 hover:bg-stone-50",
              )}
            >
              <Cmp className="h-3.5 w-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="flex gap-6">
        {/* Desktop sidebar */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav className="sticky top-20 space-y-1">
            {RESOURCE_TABS.map((t) => {
              const Cmp = ICONS[t.icon] ?? Compass
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                    tab === t.id
                      ? "bg-stone-900 text-stone-50"
                      : "text-stone-700 hover:bg-stone-100",
                  )}
                >
                  <Cmp
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      tab === t.id ? "text-amber-400" : "text-stone-400",
                    )}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">{t.label}</span>
                    <span
                      className={cn(
                        "block text-xs leading-snug",
                        tab === t.id ? "text-stone-300" : "text-stone-500",
                      )}
                    >
                      {t.blurb}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Content */}
        <section className="min-w-0 flex-1">
          {tab === "hub-guide" && <HubGuide />}
          {tab === "sops" && <Sops />}
          {tab === "faq" && <Faq />}
          {tab === "client-resources" && <ClientResources />}
          {tab === "templates" && <Templates />}
          <p className="mt-8 text-xs text-stone-400">{active.blurb}</p>
        </section>
      </div>
    </div>
  )
}

// ── Hub Guide ────────────────────────────────────────────────────────────────
function HubGuide() {
  return (
    <div className="space-y-8">
      {/* ALFRED hero */}
      <Card className="overflow-hidden border-stone-200">
        <div className="bg-stone-900 p-6 text-stone-50 md:p-8">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 ring-1 ring-amber-400/40">
              <Bot className="h-6 w-6 text-amber-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold">{ALFRED_OVERVIEW.title}</h2>
              <p className="text-sm font-medium text-amber-300">
                {ALFRED_OVERVIEW.tagline}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {ALFRED_OVERVIEW.body.map((p, i) => (
              <p key={i} className="text-pretty text-sm leading-relaxed text-stone-300">
                {p}
              </p>
            ))}
          </div>
        </div>
        <div className="grid gap-px bg-stone-200 sm:grid-cols-2">
          {ALFRED_OVERVIEW.capabilities.map((c) => (
            <div key={c} className="flex items-center gap-2 bg-white px-5 py-3">
              <Check className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="text-sm text-stone-700">{c}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Feature areas */}
      <div className="space-y-3">
        <SectionTitle
          icon={<Compass className="h-4 w-4" />}
          title="What's in the Hub"
          subtitle="Every major area and the systems behind it."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {FEATURE_AREAS.map((f) => (
            <Link key={f.path} href={f.path}>
              <Card className="group h-full border-stone-200 p-5 transition-colors hover:border-stone-300 hover:bg-stone-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                    <Icon name={f.icon} className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-500" />
                </div>
                <h3 className="mt-3 font-semibold text-stone-900">{f.name}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{f.what}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {f.integrations.map((i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="bg-stone-100 text-[11px] font-medium text-stone-600"
                    >
                      {i}
                    </Badge>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Integration architecture */}
      <div className="space-y-3">
        <SectionTitle
          icon={<Workflow className="h-4 w-4" />}
          title="How the systems connect"
          subtitle="The Hub is the center; ALFRED is the liaison between every tool."
        />

        {/* Hub-and-spoke diagram */}
        <Card className="border-stone-200 p-6">
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-col items-center gap-1 rounded-xl bg-stone-900 px-6 py-4 text-center text-stone-50">
              <Database className="h-5 w-5 text-amber-400" />
              <span className="text-sm font-bold">ALFRED Hub</span>
              <span className="text-[11px] text-stone-400">Master client record</span>
            </div>
            <div className="h-5 w-px bg-stone-300" aria-hidden />
            <div className="flex flex-wrap justify-center gap-2">
              {INTEGRATIONS.filter((i) => i.name !== "Supabase").map((i) => (
                <div
                  key={i.name}
                  className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700"
                >
                  <Icon name={i.icon} className="h-3.5 w-3.5 text-stone-500" />
                  {i.name}
                </div>
              ))}
            </div>
            <p className="max-w-md text-center text-xs leading-relaxed text-stone-500">
              Each system links back to one master record, so a client looks the
              same everywhere. ALFRED Ai reads across all of it to answer
              questions in plain language.
            </p>
          </div>
        </Card>

        {/* Integration detail cards */}
        <div className="grid gap-4 sm:grid-cols-2">
          {INTEGRATIONS.map((i) => (
            <Card key={i.name} className="border-stone-200 p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                  <Icon name={i.icon} className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="font-semibold leading-tight text-stone-900">{i.name}</h3>
                  <p className="text-xs font-medium text-amber-600">{i.role}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-stone-600">{i.detail}</p>
              <div className="mt-3 flex items-start gap-2 rounded-md bg-stone-50 px-3 py-2">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400" />
                <span className="text-xs leading-relaxed text-stone-500">{i.dataFlow}</span>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── SOPs ──────────────────────────────────────────────────────────────────────
function Sops() {
  return (
    <div className="space-y-5">
      <SectionTitle
        icon={<ClipboardList className="h-4 w-4" />}
        title="Standard Operating Procedures"
        subtitle="Follow these step-by-step for consistent, cross-system work."
      />
      {SOPS.map((sop) => (
        <Card key={sop.id} className="border-stone-200 p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-100">
              <Icon name={sop.icon} className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-stone-900">{sop.title}</h3>
                <Badge variant="secondary" className="bg-stone-100 text-[11px] text-stone-600">
                  {sop.audience}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-stone-600">{sop.summary}</p>

              <ol className="mt-4 space-y-3">
                {sop.steps.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-900 text-xs font-semibold text-stone-50">
                      {i + 1}
                    </span>
                    <div className="space-y-0.5 pt-0.5">
                      <p className="text-sm font-medium text-stone-900">{step.title}</p>
                      <p className="text-sm leading-relaxed text-stone-600">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>

              {sop.tips && sop.tips.length > 0 && (
                <div className="mt-4 space-y-1.5 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                  {sop.tips.map((tip) => (
                    <div key={tip} className="flex items-start gap-2">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <span className="text-xs leading-relaxed text-amber-800">{tip}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── FAQ ────────────────────────────────────────────────────────────────────────
function Faq() {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQS
    return FAQS.map((cat) => ({
      ...cat,
      items: cat.items.filter(
        (it) => it.q.toLowerCase().includes(q) || it.a.toLowerCase().includes(q),
      ),
    })).filter((cat) => cat.items.length > 0)
  }, [query])

  return (
    <div className="space-y-5">
      <SectionTitle
        icon={<HelpCircle className="h-4 w-4" />}
        title="Frequently Asked Questions"
        subtitle="Search or browse by category."
      />
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions..."
          className="border-stone-200 pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <Card className="border-stone-200 p-8 text-center text-sm text-stone-500">
          No questions match &ldquo;{query}&rdquo;.
        </Card>
      ) : (
        filtered.map((cat) => (
          <div key={cat.category} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-stone-500">
              {cat.category}
            </h3>
            <Card className="divide-y divide-stone-100 border-stone-200">
              {cat.items.map((item) => (
                <Collapsible key={item.q}>
                  <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
                    <span className="text-sm font-medium text-stone-900">{item.q}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-stone-400 transition-transform group-data-[state=open]:rotate-180" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="px-5 pb-4 text-sm leading-relaxed text-stone-600">
                      {item.a}
                    </p>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </Card>
          </div>
        ))
      )}
    </div>
  )
}

// ── Client Resources ────────────────────────────────────────────────────────
function ClientResources() {
  const categories = useMemo(() => {
    const map = new Map<string, typeof CLIENT_RESOURCES>()
    for (const r of CLIENT_RESOURCES) {
      const list = map.get(r.category) ?? []
      list.push(r)
      map.set(r.category, list)
    }
    return Array.from(map.entries())
  }, [])

  return (
    <div className="space-y-6">
      <SectionTitle
        icon={<FolderKanban className="h-4 w-4" />}
        title="Client Resources"
        subtitle="Vetted, on-brand materials to share with clients."
      />
      {categories.map(([category, items]) => (
        <div key={category} className="space-y-2">
          <h3 className="px-1 text-xs font-semibold uppercase tracking-wider text-stone-500">
            {category}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((r) => (
              <Card
                key={r.title}
                className="flex items-start gap-3 border-stone-200 p-4 transition-colors hover:border-stone-300 hover:bg-stone-50"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                  <Icon name={r.icon} className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-stone-900">{r.title}</h4>
                  <p className="mt-0.5 text-sm leading-relaxed text-stone-600">
                    {r.description}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}
      <Card className="border-dashed border-stone-300 bg-stone-50 p-5 text-center">
        <p className="text-sm text-stone-500">
          More resources are added over time. Need something specific? Ask in the
          team channel and we&apos;ll add it here.
        </p>
      </Card>
    </div>
  )
}

// ── Templates ────────────────────────────────────────────────────────────────
function Templates() {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (title: string, body?: string) => {
    if (!body) return
    try {
      await navigator.clipboard.writeText(body)
      setCopied(title)
      setTimeout(() => setCopied((c) => (c === title ? null : c)), 2000)
    } catch {
      // clipboard unavailable; no-op
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        icon={<FileText className="h-4 w-4" />}
        title="Templates"
        subtitle="Copy, personalize the {{fields}}, and send."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {TEMPLATES.map((t) => (
          <Card key={t.title} className="flex flex-col border-stone-200 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-stone-100 text-stone-700">
                  <Icon name={t.icon} className="h-4.5 w-4.5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-stone-900">{t.title}</h3>
                  <Badge variant="secondary" className="mt-0.5 bg-stone-100 text-[11px] text-stone-600">
                    {t.type}
                  </Badge>
                </div>
              </div>
              <button
                onClick={() => copy(t.title, t.body)}
                className="flex shrink-0 items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50"
              >
                {copied === t.title ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-amber-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </button>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{t.description}</p>
            {t.body && (
              <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 font-sans text-xs leading-relaxed text-stone-600">
                {t.body}
              </pre>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

// ── Shared ───────────────────────────────────────────────────────────────────
function SectionTitle({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-amber-600">{icon}</span>
      <div>
        <h2 className="text-lg font-bold text-stone-900">{title}</h2>
        <p className="text-sm text-stone-500">{subtitle}</p>
      </div>
    </div>
  )
}
