/**
 * Public Contact-Form embed.
 *
 * Iframe target for the marketing site's "Contact Us" page. Posts to
 * /api/public/contact (CORS-protected; same-origin POST from this
 * page bypasses CORS entirely). The standalone embed page is a
 * fallback path — the website team's primary integration is a JSON
 * fetch from their own React form. See WEBSITE_INTEGRATION.md.
 */
"use client"

import { useState } from "react"

export default function ContactEmbedPage() {
  const [status, setStatus] = useState<"idle" | "submitting" | "ok" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus("submitting")
    setErrorMsg(null)

    const fd = new FormData(e.currentTarget)
    const payload = {
      name: String(fd.get("name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      phone: String(fd.get("phone") ?? "").trim() || undefined,
      company: String(fd.get("company") ?? "").trim() || undefined,
      topic: String(fd.get("topic") ?? "").trim() || undefined,
      subject: String(fd.get("subject") ?? "").trim() || undefined,
      message: String(fd.get("message") ?? "").trim(),
      // Honeypot — must stay empty.
      website: String(fd.get("website") ?? "").trim(),
      source_page:
        typeof window !== "undefined" && window.parent !== window
          ? document.referrer || undefined
          : window.location.href,
    }

    try {
      const res = await fetch("/api/public/contact", {
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
      // Tell the parent frame the submit completed so it can scroll
      // the iframe back to the top, run analytics, etc.
      try {
        window.parent?.postMessage(
          { type: "motta:contact:success", submission_id: data.submission_id },
          "*",
        )
      } catch {
        /* parent may have a stricter postMessage policy — ignore */
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
          Thanks for reaching out
        </h1>
        <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
          We&apos;ve received your message and someone from our team will be in
          touch within one business day.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-2 text-balance text-2xl font-semibold text-foreground">
        Contact Motta
      </h1>
      <p className="mb-6 text-pretty text-sm leading-relaxed text-muted-foreground">
        Tell us a bit about what you&apos;re looking for and we&apos;ll get
        back to you within one business day.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {/* Honeypot. Visually hidden + aria-hidden so users + screen
            readers ignore it; bots happily fill it and we drop the
            submission server-side. */}
        <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="website">Website (do not fill)</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
          />
        </div>

        <Field label="Name" name="name" required maxLength={200} />
        <Field label="Email" name="email" type="email" required maxLength={320} />
        <Field label="Phone" name="phone" type="tel" maxLength={40} />
        <Field label="Company (optional)" name="company" maxLength={200} />

        <div className="flex flex-col gap-2">
          <label htmlFor="topic" className="text-sm font-medium text-foreground">
            What can we help with?
          </label>
          <select
            id="topic"
            name="topic"
            defaultValue=""
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            <option value="">Select a topic…</option>
            <option value="individual-tax">Individual tax</option>
            <option value="business-tax">Business tax</option>
            <option value="advisory">Advisory / planning</option>
            <option value="bookkeeping">Bookkeeping</option>
            <option value="other">Other</option>
          </select>
        </div>

        <Field label="Subject (optional)" name="subject" maxLength={200} />

        <div className="flex flex-col gap-2">
          <label htmlFor="message" className="text-sm font-medium text-foreground">
            Message
          </label>
          <textarea
            id="message"
            name="message"
            required
            minLength={5}
            maxLength={5000}
            rows={5}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
        </div>

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
          {status === "submitting" ? "Sending…" : "Send message"}
        </button>
      </form>
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
