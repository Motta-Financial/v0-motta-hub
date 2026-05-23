# Motta Hub — Public API for the Website Team

This document is for whoever owns the public marketing site
(`motta.cpa`, the `newmottawebsite` repo). It describes how to wire
the website's Contact and Intake forms into the Motta Hub backend so
submissions land directly in Supabase + Karbon — no Jotform, no
Zapier, no third-party hop.

The Hub lives at **`https://hub.motta.cpa`** and exposes two
purpose-built public endpoints. The Login button on the marketing
site should link to `https://hub.motta.cpa/login` (or just
`https://hub.motta.cpa/` — anonymous visitors are redirected to
login automatically).

There are **two ways** to integrate, listed in order of preference:

1. **JSON POST** to the public APIs. Best UX, full styling control,
   recommended for the new website.
2. **Iframe embed** of a Hub-hosted form. Drop-in fallback if you
   ever need a form working in 5 minutes without writing handlers.

Both options write to the same place.

---

## 1. JSON POST (recommended)

### Contact form → `POST https://hub.motta.cpa/api/public/contact`

For the generic "send us a message" form. Creates a row in
`website_contact_submissions`, emails the Motta team, and (if an
email address is provided) auto-creates or matches a Master Hub
Contact tagged `source='website_contact'`.

**Request**

```http
POST /api/public/contact
Content-Type: application/json
Origin: https://motta.cpa
```

```json
{
  "full_name": "Jane Doe",
  "email": "jane@example.com",
  "phone": "+1 555 123 4567",
  "company": "Doe Family LLC",
  "message": "I'd like to talk about getting my taxes done.",
  "subject": "Tax help",
  "page_url": "https://motta.cpa/contact",
  "_hp": ""
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `full_name` | yes | Trim before send. Used as the contact display name. |
| `email` | yes-ish | If omitted no Hub contact is created — the message still emails the team. Strongly recommend you make this required in the form UI. |
| `phone` | no | E.164 or US-formatted both fine. |
| `company` | no | Maps to organization name. |
| `message` | yes | Free text. No length limit on our side; cap at 5000 in the UI. |
| `subject` | no | Renders as the email subject prefix. |
| `page_url` | no | We log this so we know which page the visitor was on. |
| `_hp` | required, must be `""` | Honeypot. Render as a hidden input named `_hp`. Bots fill everything; if `_hp` is non-empty we silently 200 and drop the submission. |

**Response (success)**

```json
{
  "ok": true,
  "submission_id": "uuid",
  "contact_id": "uuid-or-null"
}
```

**Failure modes**

| HTTP | Meaning | What to show the user |
| --- | --- | --- |
| 400 | Validation (missing required field, bad email) | Inline field error |
| 403 | Origin not in allowlist | Generic "couldn't send, try again" |
| 429 | Rate-limited (10 / 10 min / IP) | "Too many submissions, wait a moment" |
| 500 | Server error | Generic error |

### Intake form → `POST https://hub.motta.cpa/api/public/intake`

For the new client intake form (the one currently powered by
Jotform). Creates a row in `jotform_intake_submissions` with
`form_id='website'`, runs the same downstream pipeline as the real
Jotform forms (Karbon contact create / match, ALFRED enrichment,
team notify email, post-intake Karbon note), and links the row to a
Master Hub Contact.

**Request**

```http
POST /api/public/intake
Content-Type: application/json
Origin: https://motta.cpa
```

```json
{
  "submitter": {
    "first_name": "Jane",
    "last_name": "Doe",
    "email": "jane@example.com",
    "phone": "+15551234567",
    "city": "Tampa",
    "state": "FL",
    "zip": "33602"
  },
  "engagement": {
    "service_focus": "tax",
    "services_requested": ["1040 return", "tax planning"],
    "entity_types": ["1040", "1120-S"]
  },
  "business": {
    "name": "Doe Family LLC",
    "email": "info@doefamily.com",
    "phone": "+15559998888",
    "state": "FL",
    "tax_classification": "S-Corp",
    "revenue_range": "$500k–$1M",
    "employee_count": "5–10",
    "uses_accounting_system": "QuickBooks Online",
    "situation": "Recently formed, no prior CPA",
    "summary": "Need full-service tax + bookkeeping"
  },
  "notes": "Referred by Sam Wilson",
  "page_url": "https://motta.cpa/get-started",
  "_hp": ""
}
```

`submitter.first_name`, `submitter.last_name`, and `submitter.email`
are required. Everything else is optional but we strongly recommend
collecting `service_focus` and either `business.name` or
`entity_types` so the team email surfaces useful context.

**Response (success)**

```json
{
  "ok": true,
  "submission_id": "uuid",
  "contact_id": "uuid",
  "organization_id": "uuid-or-null"
}
```

Same failure-mode table as the contact form.

---

## 2. Iframe embed (fallback)

Two pre-built pages, brand-styled, no auth, ready to drop into an
`<iframe>`:

- `https://hub.motta.cpa/embed/contact`
- `https://hub.motta.cpa/embed/intake`

```html
<iframe
  src="https://hub.motta.cpa/embed/intake"
  title="New client intake"
  loading="lazy"
  style="width:100%;min-height:1100px;border:0"
></iframe>
```

The pages set `frame-ancestors` to allow embedding from `motta.cpa`,
`*.motta.cpa`, `*.vercel.app`, and `www.mottafinancial.com`. Submissions
go through the exact same APIs as Option 1, so behavior is
identical.

---

## 3. CORS allowlist

The Hub allows requests from these origins:

- `https://motta.cpa`
- `https://www.motta.cpa`
- `https://newmottawebsite.vercel.app`
- `https://*.vercel.app` (preview deploys)
- `https://www.mottafinancial.com` (transitional, will be removed)

If you spin up a new domain that needs access, ask the Hub team to
add it to `PUBLIC_CORS_ALLOWED_ORIGINS` in Vercel.

`OPTIONS` preflight is handled automatically; you do not need to do
anything special on the website side beyond `Content-Type: application/json`.

---

## 4. Reference React snippet

Copy-paste-ready. Drop in any RSC-tolerant client component.

```tsx
"use client"

import { useState } from "react"

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus("loading")
    setError(null)
    const fd = new FormData(e.currentTarget)
    const payload = {
      full_name: fd.get("full_name"),
      email: fd.get("email"),
      phone: fd.get("phone"),
      company: fd.get("company"),
      message: fd.get("message"),
      subject: fd.get("subject"),
      page_url: typeof window !== "undefined" ? window.location.href : null,
      _hp: fd.get("_hp"),
    }
    try {
      const res = await fetch("https://hub.motta.cpa/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      setStatus("ok")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
      setStatus("error")
    }
  }

  if (status === "ok") return <p>Thanks — we'll be in touch shortly.</p>

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* honeypot — must be present, must stay empty */}
      <input
        type="text"
        name="_hp"
        tabIndex={-1}
        autoComplete="off"
        defaultValue=""
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        aria-hidden="true"
      />

      <input name="full_name" required placeholder="Full name" />
      <input name="email" type="email" required placeholder="Email" />
      <input name="phone" placeholder="Phone (optional)" />
      <input name="company" placeholder="Company (optional)" />
      <input name="subject" placeholder="Subject (optional)" />
      <textarea name="message" required placeholder="How can we help?" rows={6} />

      <button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Sending…" : "Send message"}
      </button>
      {status === "error" && (
        <p role="alert">Couldn't send: {error}. Please try again.</p>
      )}
    </form>
  )
}
```

For the intake form, swap the URL to `/api/public/intake` and shape
the body to match section 1 (above). Same honeypot rule applies.

---

## 5. Login button

```tsx
<a href="https://hub.motta.cpa/login" className="...">
  Log In
</a>
```

That's it — no SSO handshake on the marketing site. The Hub owns
auth (Auth0).

---

## 6. Questions / changes

If you need a new field, a new endpoint, or a tweak to the email
template, open an issue on `Motta-Financial/v0-motta-hub` and tag
`@hub-team`. The relevant files are:

- API routes: `app/api/public/intake/route.ts`,
  `app/api/public/contact/route.ts`
- Embed pages: `app/embed/intake/page.tsx`,
  `app/embed/contact/page.tsx`
- CORS allowlist: `lib/cors.ts`
- Hub-contact resolver: `lib/hub/find-or-create-contact.ts`
- Email templates: `lib/email.ts`

Database tables this writes to:

- `website_contact_submissions` (general contact form)
- `jotform_intake_submissions` with `form_id='website'` (intake form)
- `contacts` / `organizations` (the Master Hub Contact records)
