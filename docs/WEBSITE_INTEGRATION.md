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

The payload is **flat** — there are no `submitter` / `business` /
`engagement` wrapper objects. (Earlier revisions of this document
showed a nested shape that the API never accepted; a nested payload
returns `200 ok` with every field null, so it fails without looking
like it failed.)

```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone": "+15551234567",
  "street_address": "100 Main St",
  "city": "Tampa",
  "state": "FL",
  "zip": "33602",

  "service_focus": "Both Personal & Business",
  "services_requested": ["Tax Preparation", "Tax Planning & Advisory"],
  "entity_types": ["Individual (1040)", "S-Corp (1120-S)"],

  "business_name": "Doe Family LLC",
  "business_email": "info@doefamily.com",
  "business_phone": "+15559998888",
  "business_state": "FL",
  "business_tax_classification": "S-Corp",
  "business_revenue_range": "$500k – $1M",
  "business_employee_count": "5",
  "business_uses_accounting_system": "QuickBooks Online",
  "business_summary": "Need full-service tax + bookkeeping",

  "questions_or_concerns": "We're behind on 2024 and just got an IRS letter.",
  "additional_notes": "Prefer mornings",
  "referral_source": "Sam Wilson",
  "preferred_team_member": "Dat Le",

  "utm_source": "google",
  "utm_medium": "cpc",
  "utm_campaign": "tax-2026",
  "page_url": "https://motta.cpa/get-started",
  "website": ""
}
```

**Required:** one of `email` or `phone` — we need a way to reach them.
Everything else is optional server-side (mark what you like as required
in the form UI). We strongly recommend collecting `service_focus` and
either `business_name` or `entity_types` so the team email and the
ALFRED fee estimate have something to work with.

**Honeypot:** the field is named **`website`**, not `_hp` (the contact
form uses `_hp` — they differ). Render it as a hidden input and leave
it empty; a non-empty value gets the submission silently dropped with
`200 { ok: false }`.

**Optional qualifying fields** — accepted but not currently on the
Hub's own form. Sending them lights up extra rows in the team email:
`behind_on_filings`, `pending_tax_notices`, `current_cpa_status`,
`cpa_switch_reason`.

**Response (success)**

```json
{
  "ok": true,
  "submission_id": "web_9f1c…",
  "booking_url": "https://calendly.com/motta-financial/discovery-meeting?name=Jane+Doe&email=…&salesforce_uuid=…",
  "contact_id": "uuid-or-null",
  "organization_id": "uuid-or-null"
}
```

### ⚠️ Use `booking_url` — don't hardcode a Calendly link

`booking_url` is the discovery-call link for **this specific
prospect**. Show it as the next step on your confirmation screen
("Book your discovery call"). It is:

- **prefilled** with their name and email, so they don't retype;
- **routed** to the teammate they asked for in `preferred_team_member`,
  when that person has an active Discovery event type;
- **tagged** with a `salesforce_uuid` that ties the resulting booking
  back to this intake submission.

A hardcoded generic Calendly link loses all three, and in particular
breaks conversion reporting — the Hub would no longer be able to tell
which bookings came from the form. The Hub also emails this same link
to the prospect, so a visitor who closes the tab can still book.

`booking_url` is `null` only if the Hub couldn't resolve one; render a
plain thank-you in that case.

### Ask *who* before showing a calendar — `booking_hosts`

The same response carries `booking_hosts`: everyone who takes discovery
calls, each with their own prefilled, attribution-stamped URL.

```json
"booking_hosts": [
  {
    "teamMemberId": "21969201-…",
    "name": "Dat Le",
    "role": "Partner",
    "title": "Managing Partner",
    "avatarUrl": "https://…",
    "url": "https://calendly.com/dat-le-motta/discovery-meeting-first-meeting-with-motta?name=…&salesforce_uuid=…",
    "isTeam": false
  }
]
```

Render this as a "Who would you like to speak with?" picker, with a
**"No preference"** option that uses the top-level `booking_url` (the
firm round-robin, which books soonest). When the prospect named someone
in `preferred_team_member`, pre-select that host.

**Use the `url` from the host you selected — never a person's plain
Calendly page.** A person-level URL like `calendly.com/caleb-long-…`
renders that person's *entire* event-type menu — Coffee Chat, Client
Check-In, Kickoff Meeting — and a brand-new prospect will book the wrong
one. Every `url` here is scoped to the 30-minute discovery call.

Membership of the list is driven by Calendly itself: anyone with an
active "Discovery Meeting" event type appears. Nobody needs to maintain
a second list in the Hub, and someone who shouldn't take first meetings
simply doesn't have that event type.

If you need the list outside the submit response — a standalone "book a
call" page, or a re-render after the response is gone — call:

```http
GET /api/public/booking-hosts?submission_id=<row_id>&name=Jane+Doe&email=jane@example.com
→ { "ok": true, "hosts": [...], "default_url": "https://calendly.com/motta-financial/discovery-meeting?…" }
```

All three query params are optional. `submission_id` is what ties the
resulting booking back to the intake, so pass it when you have one.

### Embedding the calendar

Calendly renders fine in a plain `<iframe>` — no widget script needed.
Append `embed_type=Inline` and `embed_domain=<your-hostname>` to the
host's `url`, and keep an "Open in a new tab" fallback for browsers that
block third-party frames:

```tsx
const src = new URL(host.url)
src.searchParams.set("embed_type", "Inline")
src.searchParams.set("embed_domain", window.location.hostname)

<iframe src={src.toString()} title="Book your discovery call" style={{ width: "100%", height: 680, border: 0 }} />
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

For the intake form, swap the URL to `/api/public/intake`, shape the
body to match section 1 (above), and note two differences: the
honeypot field is named **`website`** rather than `_hp`, and the
success handler should render the booking step from `booking_url`:

```tsx
const data = await res.json()
setBookingUrl(data.booking_url ?? null)   // then render the CTA below
```

```tsx
{bookingUrl ? (
  <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
    Book your discovery call →
  </a>
) : (
  <p>Thanks — a teammate will follow up within one business day.</p>
)}
```

If you keep the Hub's iframe embed instead, it already renders this
step itself and also posts the url out to the parent window:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "motta:intake:success") {
    // e.data.submission_id, e.data.booking_url
  }
})
```

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
