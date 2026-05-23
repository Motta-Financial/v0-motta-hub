/**
 * Public New-Client Intake — paginated wizard.
 *
 * Designed to mirror the Cards-style flow at mottafinancial.com/intake-form
 * (Jotform): one focused step per screen, large tappable controls, a
 * progress bar, and conditional branches that skip irrelevant pages
 * (e.g. a personal-only prospect never sees business questions).
 *
 * Streamlining decisions (vs. the legacy Jotform):
 *  - Address inputs use Photon (komoot) autocomplete — free, no API key,
 *    OSM-backed — and ZIP entry auto-fills city/state via zippopotam.us.
 *    Both endpoints are CORS-enabled and graceful-degrade to manual
 *    typing if a network call fails.
 *  - We dropped the "new or existing business" gate — the AI brief on
 *    the prospect's freeform situation answers that question more
 *    fluently than a radio button could.
 *  - Detailed business operations (tax classification, entity types,
 *    accounting system, employee count, revenue range) are NOT
 *    required. They live behind an opt-in "Add more details" toggle so
 *    a prospect who just wants to talk can submit in ~90 seconds. The
 *    copy explains that filling them in shortens onboarding.
 *  - "Questions" and "Business summary" collapsed into a single
 *    freeform textarea — "How can Motta help?". The submit synthesizes
 *    that text into the existing `questions_or_concerns` field so
 *    ALFRED's question-research pass still runs.
 *  - ALFRED is introduced on the welcome screen and surfaces a one-
 *    line contextual tip on each step (an avatar + a short hint).
 *
 * The form payload remains a superset of the previous version, so
 * /api/public/intake → Karbon push → ALFRED enrichment → fee estimate
 * → team notify pipeline keeps working unchanged.
 *
 * Iframe target for the marketing site at motta.cpa. The embed
 * layout (app/embed/layout.tsx) strips Hub chrome; CSP
 * frame-ancestors is configured in next.config.mjs.
 */
"use client"

import { useEffect, useMemo, useRef, useState } from "react"

// ── Option sets (mirror the live Jotform vocabulary so the parser /
//    Karbon push / team email don't need to learn new terms) ───────

const SERVICE_FOCUS_OPTIONS = [
  {
    value: "Personal Only",
    label: "Personal",
    sub: "Individual taxes, planning, IRS support",
  },
  {
    value: "Business Only",
    label: "Business",
    sub: "Bookkeeping, payroll, business taxes, formation",
  },
  {
    value: "Both Personal & Business",
    label: "Both personal & business",
    sub: "Most owners pick this",
  },
] as const

const SERVICES = [
  { value: "Tax Preparation", category: "personal" as const },
  { value: "Tax Planning & Advisory", category: "personal" as const },
  { value: "IRS Support & Resolution", category: "personal" as const },
  {
    value: "Financial Planning & Wealth Management",
    category: "personal" as const,
  },
  { value: "Accounting & Bookkeeping", category: "business" as const },
  { value: "Payroll Services", category: "business" as const },
  { value: "Business Advisory", category: "business" as const },
  { value: "LLC Formation", category: "business" as const },
  { value: "Legal Entity Services", category: "business" as const },
] as const

const ENTITY_TYPES = [
  "Individual (1040)",
  "Single Member LLC (Sch C)",
  "Partnership (1065)",
  "S-Corp (1120-S)",
  "C-Corp (1120)",
  "Exempt Entity (990)",
] as const

const TAX_CLASSIFICATIONS = [
  "Sole Proprietorship",
  "LLC",
  "Partnership",
  "S-Corp",
  "C-Corp",
  "Nonprofit",
] as const

const REVENUE_RANGES = [
  "Under $50k",
  "$50k – $250k",
  "$250k – $500k",
  "$500k – $1M",
  "$1M+",
] as const

const US_STATES: { value: string; label: string }[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"], ["PR", "Puerto Rico"],
].map(([value, label]) => ({ value, label }))

// ── Form state shape ─────────────────────────────────────────────

interface FormState {
  first_name: string
  last_name: string
  email: string
  phone: string
  street_address: string
  city: string
  state: string
  zip: string

  service_focus: string
  services_requested: string[]

  business_name: string
  business_state: string
  business_email: string
  business_phone: string
  // "Same as my personal contact info" toggle — when true we copy
  // email/phone at submit time. We keep the boolean in state so the
  // toggle survives back-navigation.
  business_contact_same_as_personal: boolean

  // Opt-in detailed fields. The wizard hides them behind a
  // "Add more details" disclosure on the business step.
  show_business_details: boolean
  entity_types: string[]
  business_tax_classification: string
  business_revenue_range: string
  business_employee_count: string
  business_uses_accounting_system: string

  /** Combined "How can Motta help / your current situation?" textarea —
   * we send this verbatim as `questions_or_concerns` so ALFRED's
   * question-research pass picks it up.  */
  situation: string

  referral_source: string
  preferred_team_member: string

  // Honeypot — must stay empty.
  website: string
}

const INITIAL_STATE: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  street_address: "",
  city: "",
  state: "",
  zip: "",
  service_focus: "",
  services_requested: [],
  business_name: "",
  business_state: "",
  business_email: "",
  business_phone: "",
  business_contact_same_as_personal: true,
  show_business_details: false,
  entity_types: [],
  business_tax_classification: "",
  business_revenue_range: "",
  business_employee_count: "",
  business_uses_accounting_system: "",
  situation: "",
  referral_source: "",
  preferred_team_member: "",
  website: "",
}

// ── Helpers ──────────────────────────────────────────────────────

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

function isPhone(v: string): boolean {
  return v.replace(/\D/g, "").length >= 7
}

// ── Page ─────────────────────────────────────────────────────────

export default function IntakeWizardPage() {
  const [state, setState] = useState<FormState>(INITIAL_STATE)
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const steps = useMemo(() => buildSteps(state), [state])
  const safeIndex = Math.min(stepIndex, steps.length - 1)
  const current = steps[safeIndex]
  const progress = Math.round(((safeIndex + 1) / steps.length) * 100)

  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(steps.length - 1)
    }
  }, [steps.length, stepIndex])

  const stageRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [safeIndex])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  function next() {
    setError(null)
    const err = current.validate?.(state)
    if (err) {
      setError(err)
      return
    }
    if (safeIndex >= steps.length - 1) {
      void onSubmit()
      return
    }
    setStepIndex(safeIndex + 1)
  }

  function back() {
    setError(null)
    if (safeIndex > 0) setStepIndex(safeIndex - 1)
  }

  async function onSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      // Resolve "same as personal" right at submit time — we never
      // mutate the personal fields, just mirror them onto the business
      // payload so the existing API contract stays unchanged.
      const businessEmail = state.business_contact_same_as_personal
        ? state.email
        : state.business_email
      const businessPhone = state.business_contact_same_as_personal
        ? state.phone
        : state.business_phone

      const payload = {
        first_name: state.first_name.trim() || undefined,
        last_name: state.last_name.trim() || undefined,
        email: state.email.trim() || undefined,
        phone: state.phone.trim() || undefined,
        street_address: state.street_address.trim() || undefined,
        city: state.city.trim() || undefined,
        state: state.state.trim() || undefined,
        zip: state.zip.trim() || undefined,

        service_focus: state.service_focus || undefined,
        services_requested:
          state.services_requested.length > 0 ? state.services_requested : undefined,
        entity_types:
          state.entity_types.length > 0 ? state.entity_types : undefined,

        business_name: state.business_name.trim() || undefined,
        business_state: state.business_state.trim() || undefined,
        business_email: businessEmail.trim() || undefined,
        business_phone: businessPhone.trim() || undefined,
        business_tax_classification:
          state.business_tax_classification || undefined,
        business_revenue_range: state.business_revenue_range || undefined,
        business_employee_count:
          state.business_employee_count.trim() || undefined,
        business_uses_accounting_system:
          state.business_uses_accounting_system.trim() || undefined,

        // Single combined textarea. Sent as `questions_or_concerns` so
        // research-questions.ts processes it. We do NOT also send it
        // as `business_summary` — extracting biz facts from it is
        // ALFRED's enrichment job.
        questions_or_concerns: state.situation.trim() || undefined,

        referral_source: state.referral_source.trim() || undefined,
        preferred_team_member:
          state.preferred_team_member.trim() || undefined,

        website: state.website || undefined, // honeypot
        page_url:
          typeof window !== "undefined" && window.parent !== window
            ? document.referrer || undefined
            : typeof window !== "undefined"
              ? window.location.href
              : undefined,
      }

      const res = await fetch("/api/public/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSubmitting(false)
        setError(
          (data && (data.error as string)) ??
            "We couldn't process your submission. Please try again.",
        )
        return
      }
      setDone(true)
      try {
        window.parent?.postMessage(
          { type: "motta:intake:success", submission_id: data.submission_id },
          "*",
        )
      } catch {
        /* parent may have a stricter postMessage policy */
      }
    } catch {
      setSubmitting(false)
      setError("Network error. Please try again.")
    }
  }

  function onFormKeyDown(e: React.KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA") {
      e.preventDefault()
      next()
    }
  }

  if (done) {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <CheckIcon />
        </div>
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          Thanks{state.first_name ? `, ${state.first_name}` : ""} — we&apos;ve got it
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          ALFRED is preparing a research brief for our team right now.
          A teammate will follow up within one business day to schedule
          your discovery call on Zoom.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-2xl flex-col px-4 py-6 sm:py-10">
      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {safeIndex + 1} of {steps.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stage */}
      <div ref={stageRef} className="flex-1">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            next()
          }}
          onKeyDown={onFormKeyDown}
          className="flex flex-col gap-5"
        >
          {/* Honeypot — hidden, must stay empty */}
          <div
            aria-hidden="true"
            className="absolute left-[-9999px] h-0 w-0 overflow-hidden"
          >
            <label htmlFor="website-hp">Website</label>
            <input
              id="website-hp"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={state.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </div>

          <div key={current.id} className="animate-fadein">
            {current.alfred ? <AlfredHint message={current.alfred} /> : null}
            {current.render({ state, update })}
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {/* Footer / nav */}
          <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={back}
              disabled={safeIndex === 0 || submitting}
              className="inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeftIcon />
              <span className="ml-1">Back</span>
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? "Submitting…"
                : safeIndex === steps.length - 1
                  ? "Submit intake"
                  : current.cta ?? "Continue"}
              {!submitting && safeIndex < steps.length - 1 ? (
                <span className="ml-1.5">
                  <ArrowRightIcon />
                </span>
              ) : null}
            </button>
          </div>
        </form>
      </div>

      <p className="mt-6 text-center text-[11px] text-muted-foreground/70">
        Press <kbd className="rounded border bg-muted px-1 font-sans">Enter</kbd>{" "}
        to continue
      </p>
    </div>
  )
}

// ── Step definitions ─────────────────────────────────────────────

interface StepProps {
  state: FormState
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void
}

interface Step {
  id: string
  cta?: string
  /** Optional ALFRED-voiced one-liner shown above the step heading. */
  alfred?: string
  validate?: (s: FormState) => string | null
  render: (p: StepProps) => React.ReactNode
}

function buildSteps(state: FormState): Step[] {
  const wantsBusiness =
    state.service_focus === "Business Only" ||
    state.service_focus === "Both Personal & Business"

  const all: (Step | false)[] = [
    // 1 — Welcome (introduces ALFRED)
    {
      id: "welcome",
      cta: "Let's go",
      render: () => (
        <StepShell eyebrow="New client intake">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Let&apos;s get to know you
          </h1>
          <p className="text-pretty text-base leading-relaxed text-muted-foreground">
            Most folks finish this in about three minutes. After you submit,
            we&apos;ll email you a link to book a Zoom discovery call with the
            right teammate.
          </p>
          <div className="mt-2 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
            <AlfredAvatar />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                Hi, I&apos;m ALFRED — Motta&apos;s in-house Ai assistant
              </p>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                I&apos;ll quietly research your situation while you fill this
                out, so the teammate who calls you already knows the basics.
                Anything you share here saves us time on the call.
              </p>
            </div>
          </div>
        </StepShell>
      ),
    },

    // 2 — Name
    {
      id: "name",
      alfred: "Just your legal first and last name is fine.",
      validate: (s) =>
        !s.first_name.trim() || !s.last_name.trim()
          ? "Please share your first and last name."
          : null,
      render: ({ state, update }) => (
        <StepShell eyebrow="About you" title="What's your name?">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              autoFocus
              label="First name"
              value={state.first_name}
              onChange={(v) => update("first_name", v)}
              placeholder="Jane"
              autoComplete="given-name"
              required
            />
            <Field
              label="Last name"
              value={state.last_name}
              onChange={(v) => update("last_name", v)}
              placeholder="Doe"
              autoComplete="family-name"
              required
            />
          </div>
        </StepShell>
      ),
    },

    // 3 — Email & phone
    {
      id: "contact",
      alfred:
        "We only use this to schedule your discovery call — no marketing.",
      validate: (s) => {
        if (!s.email.trim()) return "Please enter your email."
        if (!isEmail(s.email)) return "That email doesn't look quite right."
        if (s.phone.trim() && !isPhone(s.phone))
          return "That phone number doesn't look quite right."
        return null
      },
      render: ({ state, update }) => (
        <StepShell eyebrow="About you" title="How can we reach you?">
          <Field
            autoFocus
            label="Email"
            type="email"
            value={state.email}
            onChange={(v) => update("email", v)}
            placeholder="you@example.com"
            autoComplete="email"
            required
            inputMode="email"
          />
          <Field
            label="Phone"
            type="tel"
            value={state.phone}
            onChange={(v) => update("phone", v)}
            placeholder="(555) 123-4567"
            autoComplete="tel"
            inputMode="tel"
          />
        </StepShell>
      ),
    },

    // 4 — Address (Photon autocomplete + ZIP autofill)
    {
      id: "address",
      alfred:
        "Helps me match you with a teammate licensed in your state. Type your address — I&apos;ll autocomplete it.",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="About you"
          title="Where are you based?"
          subtitle="Optional, but it speeds up the routing."
        >
          <AddressAutocomplete
            label="Street address"
            value={state.street_address}
            onChange={(v) => update("street_address", v)}
            onSelect={(addr) => {
              if (addr.street) update("street_address", addr.street)
              if (addr.city) update("city", addr.city)
              if (addr.state) update("state", addr.state)
              if (addr.zip) update("zip", addr.zip)
            }}
            autoFocus
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto]">
            <Field
              label="City"
              value={state.city}
              onChange={(v) => update("city", v)}
              autoComplete="address-level2"
            />
            <SelectField
              label="State"
              value={state.state}
              onChange={(v) => update("state", v)}
              options={US_STATES}
              placeholder="—"
            />
            <ZipField
              label="ZIP"
              value={state.zip}
              onChange={(v) => update("zip", v)}
              onAutofill={(addr) => {
                if (!state.city && addr.city) update("city", addr.city)
                if (!state.state && addr.state) update("state", addr.state)
              }}
              className="sm:w-28"
            />
          </div>
        </StepShell>
      ),
    },

    // 5 — Service focus (the gating question)
    {
      id: "service-focus",
      alfred: "Pick the one that&apos;s closest — we can adjust on the call.",
      validate: (s) =>
        !s.service_focus ? "Please pick one to continue." : null,
      render: ({ state, update }) => (
        <StepShell
          eyebrow="What you need"
          title="What can we help with?"
          subtitle="This shapes the rest of the form so you only see questions that matter to you."
        >
          <div className="flex flex-col gap-2.5">
            {SERVICE_FOCUS_OPTIONS.map((opt) => (
              <RadioCard
                key={opt.value}
                name="service_focus"
                value={opt.value}
                label={opt.label}
                description={opt.sub}
                checked={state.service_focus === opt.value}
                onChange={() => update("service_focus", opt.value)}
              />
            ))}
          </div>
        </StepShell>
      ),
    },

    // 6 — Services (multi-select chips, filtered by focus)
    {
      id: "services",
      alfred: "Pick everything that applies — we&apos;ll narrow down on the call.",
      render: ({ state, update }) => {
        const focus = state.service_focus
        const filtered = SERVICES.filter((s) => {
          if (focus === "Personal Only") return s.category === "personal"
          if (focus === "Business Only") return s.category === "business"
          return true
        })
        return (
          <StepShell
            eyebrow="What you need"
            title="Which services are you interested in?"
          >
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {filtered.map((svc) => {
                const checked = state.services_requested.includes(svc.value)
                return (
                  <CheckCard
                    key={svc.value}
                    label={svc.value}
                    checked={checked}
                    onChange={() => {
                      update(
                        "services_requested",
                        checked
                          ? state.services_requested.filter(
                              (v) => v !== svc.value,
                            )
                          : [...state.services_requested, svc.value],
                      )
                    }}
                  />
                )
              })}
            </div>
          </StepShell>
        )
      },
    },

    // 7 — Business basics (only if business). Replaces the old
    //     "entity types" + "existing/new" + "business basics" + "ops"
    //     trio. The detail-heavy fields are opt-in via a disclosure.
    wantsBusiness && {
      id: "business",
      alfred:
        "Just the name and state are needed. The rest is optional — but the more I know, the smoother onboarding goes.",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Your business"
          title="Tell us about your business"
        >
          <Field
            autoFocus
            label="Business name"
            value={state.business_name}
            onChange={(v) => update("business_name", v)}
            placeholder="Acme LLC (or proposed name if you&apos;re still forming it)"
          />
          <SelectField
            label="State of operation"
            value={state.business_state}
            onChange={(v) => update("business_state", v)}
            options={US_STATES}
            placeholder="—"
          />

          <CheckboxRow
            checked={state.business_contact_same_as_personal}
            onChange={(checked) =>
              update("business_contact_same_as_personal", checked)
            }
            label="Business contact info is the same as my personal info"
          />
          {!state.business_contact_same_as_personal ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Business email"
                type="email"
                value={state.business_email}
                onChange={(v) => update("business_email", v)}
                placeholder="info@acme.com"
                inputMode="email"
              />
              <Field
                label="Business phone"
                type="tel"
                value={state.business_phone}
                onChange={(v) => update("business_phone", v)}
                placeholder="(555) 555-0100"
                inputMode="tel"
              />
            </div>
          ) : null}

          {/* Opt-in details disclosure */}
          <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/30 p-4">
            <button
              type="button"
              onClick={() =>
                update("show_business_details", !state.show_business_details)
              }
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">
                  Add more details about your business
                </span>
                <span className="text-xs text-muted-foreground">
                  Optional — sharing your entity type, accounting system, and
                  rough revenue means our first call can skip the basics and go
                  straight to value.
                </span>
              </div>
              <span
                aria-hidden="true"
                className={`flex-none text-muted-foreground transition-transform ${
                  state.show_business_details ? "rotate-180" : ""
                }`}
              >
                <ChevronDownIcon />
              </span>
            </button>
            {state.show_business_details ? (
              <div className="mt-4 flex flex-col gap-3.5">
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-foreground">
                    Entity types you operate
                  </span>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ENTITY_TYPES.map((e) => {
                      const checked = state.entity_types.includes(e)
                      return (
                        <CheckCard
                          key={e}
                          label={e}
                          checked={checked}
                          onChange={() => {
                            update(
                              "entity_types",
                              checked
                                ? state.entity_types.filter((v) => v !== e)
                                : [...state.entity_types, e],
                            )
                          }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <SelectField
                    label="Tax classification"
                    value={state.business_tax_classification}
                    onChange={(v) => update("business_tax_classification", v)}
                    options={TAX_CLASSIFICATIONS.map((t) => ({
                      value: t,
                      label: t,
                    }))}
                    placeholder="Pick one"
                  />
                  <SelectField
                    label="Annual revenue"
                    value={state.business_revenue_range}
                    onChange={(v) => update("business_revenue_range", v)}
                    options={REVENUE_RANGES.map((r) => ({
                      value: r,
                      label: r,
                    }))}
                    placeholder="Pick a range"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label="Number of employees"
                    value={state.business_employee_count}
                    onChange={(v) => update("business_employee_count", v)}
                    placeholder="e.g. 12"
                    inputMode="numeric"
                  />
                  <Field
                    label="Accounting system"
                    value={state.business_uses_accounting_system}
                    onChange={(v) =>
                      update("business_uses_accounting_system", v)
                    }
                    placeholder="QuickBooks, Xero, none yet…"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </StepShell>
      ),
    },

    // 8 — Single freeform "How can Motta help?" textarea
    {
      id: "situation",
      alfred:
        "Type freely — anything from &ldquo;I got an IRS notice&rdquo; to &ldquo;I want to plan a business sale.&rdquo; I&apos;ll research your questions before the call.",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Your situation"
          title="How can Motta help?"
          subtitle="Tell us about your current situation, what&apos;s prompting this conversation, or any specific questions on your mind."
        >
          <Textarea
            autoFocus
            label="In your own words"
            value={state.situation}
            onChange={(v) => update("situation", v)}
            placeholder="e.g. I just incorporated my second business and need help thinking through how to pay myself, what entity to file as, and how to clean up last year&apos;s books."
            rows={6}
          />
        </StepShell>
      ),
    },

    // 9 — Referral + preferred teammate (optional)
    {
      id: "referral",
      alfred: "All optional — skip if you&apos;d rather we pick.",
      render: ({ state, update }) => (
        <StepShell eyebrow="Wrapping up" title="Anything else?">
          <Field
            label="Who sent you our way?"
            value={state.referral_source}
            onChange={(v) => update("referral_source", v)}
            placeholder="A friend&apos;s name, a podcast, a search…"
          />
          <Field
            label="A specific teammate you&apos;d like to meet with?"
            value={state.preferred_team_member}
            onChange={(v) => update("preferred_team_member", v)}
            placeholder="No preference is fine — we&apos;ll match you up."
          />
        </StepShell>
      ),
    },

    // 10 — Review & submit
    {
      id: "review",
      cta: "Submit intake",
      alfred:
        "When you submit, I&apos;ll start researching and the team will email you a link to schedule a Zoom discovery call.",
      render: ({ state }) => <ReviewStep state={state} />,
    },
  ]
  return all.filter(Boolean) as Step[]
}

// ── Step shell + field primitives ────────────────────────────────

function StepShell({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string
  title?: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      {(eyebrow || title || subtitle) && (
        <div className="flex flex-col gap-2">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          {title ? (
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {title}
            </h2>
          ) : null}
          {subtitle ? (
            <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
        </div>
      )}
      {children ? <div className="flex flex-col gap-3.5">{children}</div> : null}
    </div>
  )
}

function AlfredHint({ message }: { message: string }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-md border border-primary/15 bg-primary/[0.04] px-3 py-2.5">
      <AlfredAvatar small />
      <p
        className="text-pretty text-xs leading-relaxed text-foreground/80"
        // ALFRED hints contain entity escapes (e.g. &apos;) that we
        // author inline; render them as HTML so the right-single-quote
        // shows up cleanly without bloating each step's JSX.
        dangerouslySetInnerHTML={{
          __html: `<span class="font-semibold text-foreground">ALFRED:</span> ${message}`,
        }}
      />
    </div>
  )
}

function AlfredAvatar({ small }: { small?: boolean } = {}) {
  // Inline SVG mark — no remote dependency, looks deliberate next to
  // ALFRED's voice. Letters "AL" inside a primary-tinted disc.
  const size = small ? "h-6 w-6" : "h-8 w-8"
  return (
    <span
      aria-hidden="true"
      className={`inline-flex flex-none items-center justify-center rounded-full bg-primary text-primary-foreground ${size}`}
    >
      <span className={small ? "text-[9px] font-bold" : "text-[11px] font-bold"}>
        AL
      </span>
    </span>
  )
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  required,
  autoFocus,
  autoComplete,
  inputMode,
  maxLength,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  autoFocus?: boolean
  autoComplete?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  maxLength?: number
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <span className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="ml-1 text-destructive">*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        className="rounded-md border border-input bg-background px-3.5 py-3 text-base text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-3 text-base text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      >
        <option value="">{placeholder ?? "Select…"}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Textarea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  autoFocus?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className="rounded-md border border-input bg-background px-3.5 py-3 text-base text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </label>
  )
}

function RadioCard({
  name,
  value,
  label,
  description,
  checked,
  onChange,
}: {
  name: string
  value: string
  label: string
  description?: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      className={`group flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-4 transition-colors ${
        checked
          ? "border-primary bg-primary/5"
          : "border-border hover:border-foreground/30 hover:bg-muted/40"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition-colors ${
          checked
            ? "border-primary bg-primary"
            : "border-input bg-background group-hover:border-foreground/40"
        }`}
      >
        {checked ? (
          <span className="h-2 w-2 rounded-full bg-primary-foreground" />
        ) : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  )
}

function CheckCard({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-lg border bg-card px-3.5 py-3 text-sm transition-colors ${
        checked
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-foreground hover:border-foreground/30 hover:bg-muted/40"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 flex-none items-center justify-center rounded border-2 transition-colors ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background"
        }`}
      >
        {checked ? <CheckIcon small /> : null}
      </span>
      <span>{label}</span>
    </label>
  )
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1 text-sm text-foreground">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`flex h-5 w-5 flex-none items-center justify-center rounded border-2 transition-colors ${
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-background"
        }`}
      >
        {checked ? <CheckIcon small /> : null}
      </span>
      <span>{label}</span>
    </label>
  )
}

// ── Address autocomplete (Photon / komoot — free, no key) ───────

interface PhotonHit {
  street?: string
  city?: string
  state?: string
  zip?: string
  display: string
}

function AddressAutocomplete({
  label,
  value,
  onChange,
  onSelect,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSelect: (addr: PhotonHit) => void
  autoFocus?: boolean
}) {
  const [hits, setHits] = useState<PhotonHit[]>([])
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastQueryRef = useRef<string>("")

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = value.trim()
    if (q.length < 4) {
      setHits([])
      return
    }
    if (q === lastQueryRef.current) return
    debounceRef.current = setTimeout(async () => {
      lastQueryRef.current = q
      try {
        // Photon — komoot's geocoder. CORS-enabled; no API key needed.
        // We bias to US results because the firm only serves the US.
        const url =
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}` +
          `&limit=6&osm_tag=highway&lang=en`
        const res = await fetch(url)
        if (!res.ok) {
          setHits([])
          return
        }
        const data = (await res.json()) as {
          features?: Array<{
            properties?: {
              housenumber?: string
              street?: string
              name?: string
              city?: string
              state?: string
              postcode?: string
              country?: string
              countrycode?: string
            }
          }>
        }
        const out: PhotonHit[] = []
        for (const f of data.features ?? []) {
          const p = f.properties ?? {}
          // Photon returns global hits — only show US matches.
          const cc = (p.countrycode ?? p.country ?? "").toUpperCase()
          if (cc && !cc.startsWith("US")) continue
          const streetParts = [p.housenumber, p.street ?? p.name].filter(
            Boolean,
          )
          const street = streetParts.join(" ")
          const stateAbbr = guessStateAbbr(p.state)
          const display = [
            street,
            [p.city, stateAbbr, p.postcode].filter(Boolean).join(", "),
          ]
            .filter(Boolean)
            .join(" — ")
          if (!street && !p.city) continue
          out.push({
            street: street || undefined,
            city: p.city,
            state: stateAbbr,
            zip: p.postcode,
            display: display || (p.name ?? ""),
          })
        }
        setHits(out)
        setOpen(out.length > 0)
        setHighlight(0)
      } catch {
        setHits([])
      }
    }, 220)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [value])

  function pick(hit: PhotonHit) {
    onSelect(hit)
    setOpen(false)
    setHits([])
  }

  return (
    <label className="relative flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onBlur={() => {
          // Delay so click on a suggestion can register first.
          setTimeout(() => setOpen(false), 150)
        }}
        onKeyDown={(e) => {
          if (!open || hits.length === 0) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, hits.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === "Enter") {
            e.preventDefault()
            pick(hits[highlight]!)
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
        placeholder="Start typing your address…"
        autoFocus={autoFocus}
        autoComplete="street-address"
        className="rounded-md border border-input bg-background px-3.5 py-3 text-base text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
      {open && hits.length > 0 ? (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.display}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  i === highlight
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <span aria-hidden="true" className="mt-0.5 flex-none text-muted-foreground">
                  <PinIcon />
                </span>
                <span className="flex-1">{h.display}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </label>
  )
}

/**
 * State-name → 2-letter abbreviation. Photon returns the full state
 * name (e.g. "California"); the form expects the abbreviation
 * (`CA`) so the existing parser writes it onto submitter_state.
 */
function guessStateAbbr(stateName?: string): string | undefined {
  if (!stateName) return undefined
  const found = US_STATES.find(
    (s) => s.label.toLowerCase() === stateName.toLowerCase(),
  )
  return found?.value
}

// ZIP field with autofill via api.zippopotam.us. Free, CORS-enabled,
// no API key. We only fire when the ZIP looks complete (5 digits).
function ZipField({
  label,
  value,
  onChange,
  onAutofill,
  className,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onAutofill: (addr: { city?: string; state?: string }) => void
  className?: string
}) {
  const lastFiredRef = useRef<string>("")
  useEffect(() => {
    const z = value.replace(/\D/g, "")
    if (z.length !== 5) return
    if (z === lastFiredRef.current) return
    lastFiredRef.current = z
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`https://api.zippopotam.us/us/${z}`)
        if (!res.ok || cancelled) return
        const data = (await res.json()) as {
          places?: Array<{
            "place name"?: string
            "state abbreviation"?: string
          }>
        }
        const place = data.places?.[0]
        if (!place) return
        onAutofill({
          city: place["place name"],
          state: place["state abbreviation"],
        })
      } catch {
        /* no-op — manual fill still works */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [value, onAutofill])

  return (
    <Field
      label={label}
      value={value}
      onChange={onChange}
      autoComplete="postal-code"
      maxLength={10}
      inputMode="numeric"
      className={className}
    />
  )
}

function ReviewStep({ state }: { state: FormState }) {
  const businessEmail = state.business_contact_same_as_personal
    ? state.email
    : state.business_email
  const businessPhone = state.business_contact_same_as_personal
    ? state.phone
    : state.business_phone

  const rows: { label: string; value: string | null }[] = [
    {
      label: "Name",
      value: [state.first_name, state.last_name].filter(Boolean).join(" ") || null,
    },
    { label: "Email", value: state.email || null },
    { label: "Phone", value: state.phone || null },
    {
      label: "Location",
      value:
        [state.city, state.state, state.zip].filter(Boolean).join(", ") ||
        state.street_address ||
        null,
    },
    { label: "Focus", value: state.service_focus || null },
    {
      label: "Services",
      value:
        state.services_requested.length > 0
          ? state.services_requested.join(", ")
          : null,
    },
    { label: "Business name", value: state.business_name || null },
    { label: "Business state", value: state.business_state || null },
    { label: "Business email", value: businessEmail || null },
    { label: "Business phone", value: businessPhone || null },
    {
      label: "Entity types",
      value:
        state.entity_types.length > 0 ? state.entity_types.join(", ") : null,
    },
    {
      label: "Tax classification",
      value: state.business_tax_classification || null,
    },
    {
      label: "Revenue range",
      value: state.business_revenue_range || null,
    },
    { label: "Referred by", value: state.referral_source || null },
    {
      label: "Preferred teammate",
      value: state.preferred_team_member || null,
    },
  ].filter((r) => r.value)

  return (
    <StepShell
      eyebrow="Almost done"
      title="Quick review"
      subtitle="Make sure this looks right — Back to fix anything."
    >
      <dl className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[160px_1fr] sm:gap-4"
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {r.label}
            </dt>
            <dd className="text-sm text-foreground">{r.value}</dd>
          </div>
        ))}
      </dl>
      {state.situation ? (
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your situation
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {state.situation}
          </p>
        </div>
      ) : null}
    </StepShell>
  )
}

// ── Tiny inline icons (avoid an extra dep) ───────────────────────

function CheckIcon({ small }: { small?: boolean } = {}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={small ? 3 : 2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={small ? "h-3 w-3" : "h-6 w-6"}
      aria-hidden="true"
    >
      <path d="M4 10.5l4 4 8-8" />
    </svg>
  )
}

function ArrowLeftIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M12 4l-6 6 6 6M6 10h10" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M8 4l6 6-6 6M14 10H4" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 17s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" />
      <circle cx="10" cy="7" r="2" />
    </svg>
  )
}
