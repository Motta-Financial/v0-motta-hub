/**
 * Public New-Client Intake embed.
 *
 * Iframe target for the marketing site's "Get Started" / "New Client"
 * page. Posts to /api/public/intake which routes the submission
 * through the existing Jotform intake pipeline (Master Hub Contact
 * created, Karbon push automatic, team email notify, ALFRED
 * enrichment) — see lib/jotform/ingest.ts.
 *
 * This page is the fallback path; the website team's primary
 * integration is a JSON fetch from their own native React form.
 * Both routes hit the same /api/public/intake endpoint.
 */
"use client"

import { useState } from "react"

const SERVICE_OPTIONS = [
  { value: "individual-tax", label: "Individual tax preparation" },
  { value: "business-tax", label: "Business tax preparation" },
  { value: "tax-planning", label: "Tax planning / advisory" },
  { value: "bookkeeping", label: "Bookkeeping" },
  { value: "payroll", label: "Payroll" },
  { value: "entity-formation", label: "Entity formation" },
  { value: "other", label: "Other" },
]

const ENTITY_OPTIONS = [
  "Sole proprietorship",
  "LLC (single-member)",
  "LLC (multi-member)",
  "S-Corp",
  "C-Corp",
  "Partnership",
  "Non-profit",
]

export default function IntakeEmbedPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus("submitting")
    setErrorMsg(null)

    const fd = new FormData(e.currentTarget)
    const payload = {
      first_name: trimOrUndef(fd.get("first_name")),
      last_name: trimOrUndef(fd.get("last_name")),
      email: trimOrUndef(fd.get("email")),
      phone: trimOrUndef(fd.get("phone")),
      city: trimOrUndef(fd.get("city")),
      state: trimOrUndef(fd.get("state")),
      zip: trimOrUndef(fd.get("zip")),

      services_requested: fd.getAll("services_requested").map(String).filter(Boolean),
      service_focus: trimOrUndef(fd.get("service_focus")),
      entity_types: fd.getAll("entity_types").map(String).filter(Boolean),

      business_name: trimOrUndef(fd.get("business_name")),
      business_state: trimOrUndef(fd.get("business_state")),
      business_revenue_range: trimOrUndef(fd.get("business_revenue_range")),
      business_summary: trimOrUndef(fd.get("business_summary")),

      questions_or_concerns: trimOrUndef(fd.get("questions_or_concerns")),
      referral_source: trimOrUndef(fd.get("referral_source")),

      website: trimOrUndef(fd.get("website")), // honeypot
      page_url:
        typeof window !== "undefined" && window.parent !== window
          ? document.referrer || undefined
          : window.location.href,
    }

    try {
      const res = await fetch("/api/public/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatus("error")
        setErrorMsg(data?.error ?? "Submission failed. Please try again.")
        return
      }
      setStatus("ok")
      try {
        window.parent?.postMessage(
          { type: "motta:intake:success", submission_id: data.submission_id },
          "*",
        )
      } catch {
        /* parent may have a stricter postMessage policy */
      }
    } catch {
      setStatus("error")
      setErrorMsg("Network error. Please try again.")
    }
  }

  if (status === "ok") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-4 py-12 text-center">
        <h1 className="text-balance text-2xl font-semibold text-foreground">
          Thanks — we&apos;ve got it
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          Someone from our team will review your intake and reach out
          within one business day to schedule a discovery call.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-2 text-balance text-2xl font-semibold text-foreground">
        New Client Intake
      </h1>
      <p className="mb-6 text-pretty text-sm leading-relaxed text-muted-foreground">
        A few quick questions so we can route you to the right person on
        our team. Takes about three minutes.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        {/* Honeypot */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <Section title="Your information">
          <Grid cols={2}>
            <Field label="First name" name="first_name" required />
            <Field label="Last name" name="last_name" required />
          </Grid>
          <Grid cols={2}>
            <Field label="Email" name="email" type="email" required />
            <Field label="Phone" name="phone" type="tel" />
          </Grid>
          <Grid cols={3}>
            <Field label="City" name="city" />
            <Field label="State" name="state" maxLength={2} />
            <Field label="ZIP" name="zip" maxLength={10} />
          </Grid>
        </Section>

        <Section title="What can we help with?">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Services (check all that apply)
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SERVICE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="services_requested"
                    value={opt.value}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring/40"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <label htmlFor="service_focus" className="text-sm font-medium text-foreground">
              Briefly, what&apos;s most important to you right now?
            </label>
            <textarea
              id="service_focus"
              name="service_focus"
              rows={3}
              maxLength={1000}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </Section>

        <Section title="Business details (skip if individual)">
          <Field label="Business name" name="business_name" />
          <Grid cols={2}>
            <Field label="Business state" name="business_state" maxLength={2} />
            <div className="flex flex-col gap-2">
              <label
                htmlFor="business_revenue_range"
                className="text-sm font-medium text-foreground"
              >
                Annual revenue
              </label>
              <select
                id="business_revenue_range"
                name="business_revenue_range"
                defaultValue=""
                className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
              >
                <option value="">Select…</option>
                <option value="under-100k">Under $100k</option>
                <option value="100k-500k">$100k – $500k</option>
                <option value="500k-1m">$500k – $1M</option>
                <option value="1m-5m">$1M – $5M</option>
                <option value="5m-plus">$5M+</option>
              </select>
            </div>
          </Grid>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium text-foreground">
              Entity type (check all that apply)
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ENTITY_OPTIONS.map((opt) => (
                <label
                  key={opt}
                  className="flex items-center gap-2 text-sm text-foreground"
                >
                  <input
                    type="checkbox"
                    name="entity_types"
                    value={opt}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-2 focus:ring-ring/40"
                  />
                  {opt}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-2">
            <label htmlFor="business_summary" className="text-sm font-medium text-foreground">
              Short summary of the business
            </label>
            <textarea
              id="business_summary"
              name="business_summary"
              rows={3}
              maxLength={1000}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
        </Section>

        <Section title="Anything else?">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="questions_or_concerns"
              className="text-sm font-medium text-foreground"
            >
              Questions or concerns
            </label>
            <textarea
              id="questions_or_concerns"
              name="questions_or_concerns"
              rows={3}
              maxLength={2000}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <Field label="How did you hear about us?" name="referral_source" />
        </Section>

        {errorMsg ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMsg}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={status === "submitting"}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "submitting" ? "Submitting…" : "Submit intake"}
        </button>
      </form>
    </div>
  )
}

function trimOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

function Grid({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 ${cols === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
    >
      {children}
    </div>
  )
}

function Field({
  label,
  name,
  type = "text",
  required = false,
  maxLength,
}: {
  label: string
  name: string
  type?: string
  required?: boolean
  maxLength?: number
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={name} className="text-sm font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
      />
    </div>
  )
}
