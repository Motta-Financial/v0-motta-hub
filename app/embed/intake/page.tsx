/**
 * Public New-Client Intake — paginated wizard.
 *
 * Designed to mirror the Cards-style flow at mottafinancial.com/intake-form
 * (Jotform): one focused step per screen, large tappable controls, a
 * progress bar, and conditional branches that skip irrelevant pages
 * (e.g. a personal-only prospect never sees business questions).
 *
 * The submit payload remains identical to the previous single-page
 * version of this form, so /api/public/intake -> Karbon push ->
 * ALFRED enrichment -> team notify pipeline keeps working unchanged.
 *
 * No external state lib — a single useState bag holds the answers,
 * and a stepIndex pointer advances through a dynamically-built step
 * array. Steps are pure data (id + render fn + optional `when`
 * predicate); reordering or adding a step is one line.
 *
 * Iframe target for the marketing site at motta.cpa. The embed
 * layout (app/embed/layout.tsx) strips Hub chrome; CSP
 * frame-ancestors is configured in next.config.mjs.
 */
"use client"

import { useEffect, useMemo, useRef, useState } from "react"

// ── Option sets (mirror the live Jotform exactly so the parser /
//    Karbon push / team email don't need to learn new vocab) ───────

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

const BUSINESS_SITUATIONS = [
  {
    value: "I am seeking services for an existing business",
    label: "I have an existing business",
  },
  {
    value: "I am looking for help setting up a new business",
    label: "I'm setting up a new business",
  },
] as const

// US states — the picker is a `<select>` so people don't have to
// remember the two-letter code.
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

  service_focus: string // one of SERVICE_FOCUS_OPTIONS values
  services_requested: string[]
  entity_types: string[]
  business_situation: string

  business_name: string
  business_state: string
  business_email: string
  business_phone: string
  business_tax_classification: string
  business_revenue_range: string
  business_employee_count: string
  business_uses_accounting_system: string
  business_summary: string

  questions_or_concerns: string
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
  entity_types: [],
  business_situation: "",
  business_name: "",
  business_state: "",
  business_email: "",
  business_phone: "",
  business_tax_classification: "",
  business_revenue_range: "",
  business_employee_count: "",
  business_uses_accounting_system: "",
  business_summary: "",
  questions_or_concerns: "",
  referral_source: "",
  preferred_team_member: "",
  website: "",
}

// ── Helpers ──────────────────────────────────────────────────────

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())
}

function isPhone(v: string): boolean {
  // Allow anything with at least 7 digits; we don't enforce US format
  // because some prospects type +44, +1-555, etc.
  return v.replace(/\D/g, "").length >= 7
}

// ── Page ─────────────────────────────────────────────────────────

export default function IntakeWizardPage() {
  const [state, setState] = useState<FormState>(INITIAL_STATE)
  const [stepIndex, setStepIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Re-derive enabled steps every render — `when` predicates may
  // depend on the latest answers (e.g. "skip business steps if
  // Personal Only").
  const steps = useMemo(() => buildSteps(state), [state])
  const safeIndex = Math.min(stepIndex, steps.length - 1)
  const current = steps[safeIndex]
  const progress = Math.round(((safeIndex + 1) / steps.length) * 100)

  // If the user changes an earlier answer that removes some steps
  // ahead of them, snap back to the last valid step. (E.g. they
  // pick Personal Only after having seen the business pages.)
  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(steps.length - 1)
    }
  }, [steps.length, stepIndex])

  // Scroll the new step into view on advance/back. Prospects on
  // mobile especially appreciate this — without it the keyboard
  // can leave them looking at the bottom of an old step.
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
        business_situation: state.business_situation || undefined,

        business_name: state.business_name.trim() || undefined,
        business_state: state.business_state.trim() || undefined,
        business_email: state.business_email.trim() || undefined,
        business_phone: state.business_phone.trim() || undefined,
        business_tax_classification:
          state.business_tax_classification || undefined,
        business_revenue_range: state.business_revenue_range || undefined,
        business_employee_count:
          state.business_employee_count.trim() || undefined,
        business_uses_accounting_system:
          state.business_uses_accounting_system.trim() || undefined,
        business_summary: state.business_summary.trim() || undefined,

        questions_or_concerns: state.questions_or_concerns.trim() || undefined,
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

  // Pressing Enter in a single-line input advances. Multi-line
  // textareas use Cmd/Ctrl+Enter (the keyDown handler on the
  // textareas filters this).
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
          A teammate will review your intake and reach out within one
          business day to schedule your discovery call.
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

      {/* Tiny hint about Enter-to-advance */}
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
  validate?: (s: FormState) => string | null
  render: (p: StepProps) => React.ReactNode
}

function buildSteps(state: FormState): Step[] {
  const wantsBusiness =
    state.service_focus === "Business Only" ||
    state.service_focus === "Both Personal & Business"

  const all: (Step | false)[] = [
    // 1 — Welcome
    {
      id: "welcome",
      cta: "Get started",
      render: () => (
        <StepShell eyebrow="New client intake">
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Let&apos;s get to know you
          </h1>
          <p className="text-pretty text-base leading-relaxed text-muted-foreground">
            A few quick questions so we can route you to the right person on
            our team. Most folks finish this in about three minutes — your
            answers save as you go.
          </p>
        </StepShell>
      ),
    },

    // 2 — Name
    {
      id: "name",
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
      validate: (s) => {
        if (!s.email.trim()) return "Please enter your email."
        if (!isEmail(s.email)) return "That email doesn't look quite right."
        if (s.phone.trim() && !isPhone(s.phone))
          return "That phone number doesn't look quite right."
        return null
      },
      render: ({ state, update }) => (
        <StepShell
          eyebrow="About you"
          title="How can we reach you?"
          subtitle="We&rsquo;ll only use this to schedule your discovery call."
        >
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

    // 4 — Address
    {
      id: "address",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="About you"
          title="Where are you based?"
          subtitle="Helps us match you with a teammate licensed in your state. Optional."
        >
          <Field
            autoFocus
            label="Street address"
            value={state.street_address}
            onChange={(v) => update("street_address", v)}
            placeholder="123 Main St"
            autoComplete="street-address"
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
            <Field
              label="ZIP"
              value={state.zip}
              onChange={(v) => update("zip", v)}
              autoComplete="postal-code"
              maxLength={10}
              inputMode="numeric"
              className="sm:w-28"
            />
          </div>
        </StepShell>
      ),
    },

    // 5 — Service focus (the gating question)
    {
      id: "service-focus",
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
            subtitle="Pick everything that applies — we'll narrow down on the call."
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

    // 7 — Entity types (business only)
    wantsBusiness && {
      id: "entity-types",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Your business"
          title="What types of entities are we working with?"
          subtitle="Pick all that apply. Don't worry if you're not sure — we can sort it out together."
        >
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
        </StepShell>
      ),
    },

    // 8 — Existing or new business
    wantsBusiness && {
      id: "business-situation",
      validate: (s) =>
        !s.business_situation ? "Please pick one to continue." : null,
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Your business"
          title="Which best describes your situation?"
        >
          <div className="flex flex-col gap-2.5">
            {BUSINESS_SITUATIONS.map((opt) => (
              <RadioCard
                key={opt.value}
                name="business_situation"
                value={opt.value}
                label={opt.label}
                checked={state.business_situation === opt.value}
                onChange={() => update("business_situation", opt.value)}
              />
            ))}
          </div>
        </StepShell>
      ),
    },

    // 9 — Business basics (name, state, summary)
    wantsBusiness && {
      id: "business-basics",
      render: ({ state, update }) => {
        const isNew =
          state.business_situation ===
          "I am looking for help setting up a new business"
        return (
          <StepShell
            eyebrow="Your business"
            title={isNew ? "Tell us about the new business" : "Tell us about your business"}
            subtitle="Whatever you know — leave the rest blank."
          >
            <Field
              autoFocus
              label={isNew ? "Proposed business name" : "Business name"}
              value={state.business_name}
              onChange={(v) => update("business_name", v)}
              placeholder="Acme LLC"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField
                label={isNew ? "State of operation" : "Business state"}
                value={state.business_state}
                onChange={(v) => update("business_state", v)}
                options={US_STATES}
                placeholder="—"
              />
              <SelectField
                label="Annual revenue"
                value={state.business_revenue_range}
                onChange={(v) => update("business_revenue_range", v)}
                options={REVENUE_RANGES.map((r) => ({ value: r, label: r }))}
                placeholder="Pick a range"
              />
            </div>
            <Textarea
              label={isNew ? "Brief summary of the new business" : "Brief summary of the business"}
              value={state.business_summary}
              onChange={(v) => update("business_summary", v)}
              placeholder="What you do, who your customers are, anything else relevant."
              rows={4}
            />
          </StepShell>
        )
      },
    },

    // 10 — Business operations
    wantsBusiness && {
      id: "business-ops",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Your business"
          title="A few more business details"
          subtitle="Optional — helps us hit the ground running."
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Tax classification"
              value={state.business_tax_classification}
              onChange={(v) => update("business_tax_classification", v)}
              options={TAX_CLASSIFICATIONS.map((t) => ({ value: t, label: t }))}
              placeholder="Pick one"
            />
            <Field
              label="Number of employees"
              value={state.business_employee_count}
              onChange={(v) => update("business_employee_count", v)}
              placeholder="e.g. 12"
              inputMode="numeric"
            />
          </div>
          <Field
            label="Accounting system in use"
            value={state.business_uses_accounting_system}
            onChange={(v) => update("business_uses_accounting_system", v)}
            placeholder="e.g. QuickBooks Online, Xero, none yet"
          />
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
        </StepShell>
      ),
    },

    // 11 — Anything else (questions, referral, preferred team member)
    {
      id: "anything-else",
      render: ({ state, update }) => (
        <StepShell
          eyebrow="Wrapping up"
          title="Anything else we should know?"
          subtitle="All optional."
        >
          <Textarea
            autoFocus
            label="Questions or concerns you'd like us to address"
            value={state.questions_or_concerns}
            onChange={(v) => update("questions_or_concerns", v)}
            placeholder="Anything keeping you up at night — back taxes, an audit notice, planning a sale, etc."
            rows={4}
          />
          <Field
            label="Who sent you our way?"
            value={state.referral_source}
            onChange={(v) => update("referral_source", v)}
            placeholder="A friend's name, a podcast, a search…"
          />
          <Field
            label="Is there a specific team member you'd like to meet with?"
            value={state.preferred_team_member}
            onChange={(v) => update("preferred_team_member", v)}
            placeholder="No preference is fine — we'll match you up."
          />
        </StepShell>
      ),
    },

    // 12 — Review & submit
    {
      id: "review",
      cta: "Submit intake",
      render: ({ state }) => <ReviewStep state={state} />,
    },
  ]
  return all.filter(Boolean) as Step[]
}

// ── Reusable step shell + field primitives ───────────────────────

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

function ReviewStep({ state }: { state: FormState }) {
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
    {
      label: "Entity types",
      value:
        state.entity_types.length > 0 ? state.entity_types.join(", ") : null,
    },
    { label: "Business name", value: state.business_name || null },
    {
      label: "Revenue range",
      value: state.business_revenue_range || null,
    },
    {
      label: "Tax classification",
      value: state.business_tax_classification || null,
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
      subtitle="Make sure this looks right — you can hit Back to fix anything."
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
      {state.questions_or_concerns ? (
        <div className="rounded-lg border bg-card px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
            {state.questions_or_concerns}
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
