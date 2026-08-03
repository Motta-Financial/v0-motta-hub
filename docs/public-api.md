# ALFRED Hub ↔ motta.cpa Integration Guide

The marketing site (`motta.cpa`, Vercel project
`prj_EuqYEqjELxtf52nD7RbY4XxGrlAp`) and the ALFRED Hub
(`hub.motta.cpa`, Vercel project `prj_VvPN85eN7oCBBRzcLD7YYokXbxo8`)
share **one Supabase instance**. The two projects stay deployed,
deployed, owned, and licensed independently — that separation is
deliberate, because ALFRED Ai will eventually be **licensed to other
firms** while motta.cpa stays Motta-only.

This document is the contract between the two projects.

---

## TL;DR architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                            Supabase                              │
│                      (single source of truth)                    │
│                                                                  │
│   public.*           ←─── Hub-only writes (service role)         │
│   marketing.*        ←─── created from Hub repo, exposed to anon │
│      ├── blog_posts  (anon SELECT where status='published')      │
│      ├── case_studies(anon SELECT where status='published')      │
│      ├── newsletter_subscribers (NO anon access)                 │
│      └── firm_stats_public_rpc() (anon EXECUTE, SECURITY DEFINER)│
└──────────────────────────────────────────────────────────────────┘
       ▲                                              ▲
       │ anon key                                     │ service role
       │ (read-only, RLS)                             │ key
       │                                              │
┌──────┴────────┐   server→server,   ┌────────────────┴──────────┐
│  motta.cpa    │   x-motta-public-  │  hub.motta.cpa            │
│  (marketing)  │ ◀ ─ secret ─ ─ ─ ▶ │  (ALFRED Hub)             │
│               │                    │                           │
│  - blog       │                    │  /api/public/contact      │
│  - case       │                    │  /api/public/intake       │
│    studies    │                    │  /api/public/newsletter   │
│  - intake     │                    │  /api/public/newsletter/  │
│  - contact    │                    │     confirm + unsubscribe │
│  - newsletter │                    │  /api/public/stats        │
│  - hero stats │                    │  /api/public/health       │
└───────────────┘                    └───────────────────────────┘
```

**Two trust paths into the Hub, both first-party:**

1. **Browser-direct via CORS.** Allowlisted origins (`motta.cpa`,
   `www.motta.cpa`, preview URLs) can `fetch()` Hub `/api/public/*`
   from the browser. The Hub validates the `Origin` header.
2. **Server-to-server with shared secret.** The marketing project's
   own API routes call the Hub with an `x-motta-public-secret`
   header. The secret never reaches the browser.

The Hub accepts **either** path. Use whichever fits the marketing
page — small forms can go browser-direct; anything that needs to
add an attachment or call a third party (Resend, etc.) on the way
through should proxy via a marketing-side API route.

---

## Required environment variables

### On the **Hub** project (`prj_VvPN85eN7oCBBRzcLD7YYokXbxo8`)

Already set; do not change without coordinating with the marketing
team.

- `MOTTA_PUBLIC_SECRET` — shared secret (set the same value on the
  marketing project)
- `WEBSITE_CONTACT_NOTIFY_TO` — comma-separated email list for the
  contact form ("[Website Contact]" emails)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — already configured
- `NEXT_PUBLIC_APP_URL` — `https://hub.motta.cpa` (so confirmation
  links the team email contains point at the Hub admin)

### On the **marketing** project (`prj_EuqYEqjELxtf52nD7RbY4XxGrlAp`)

Add these in Vercel → Project Settings → Environment Variables for
**Production**, **Preview**, and **Development**:

| Variable                          | Value                                                    | Visibility |
| --------------------------------- | -------------------------------------------------------- | ---------- |
| `MOTTA_HUB_URL`                   | `https://hub.motta.cpa`                                  | Server     |
| `MOTTA_PUBLIC_SECRET`             | (paste the value from the Hub — must match exactly)      | **Server** |
| `MOTTA_SITE_URL`                  | `https://motta.cpa`                                      | Server     |
| `NEXT_PUBLIC_SUPABASE_URL`        | (same as the Hub's `NEXT_PUBLIC_SUPABASE_URL`)           | Public     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | (same as the Hub's anon key, **NOT** the service role)   | Public     |

> **Never** put `SUPABASE_SERVICE_ROLE_KEY` on the marketing project.
> If you find yourself reaching for it, the operation belongs in a
> Hub `/api/public/*` route instead.

---

## Drop in the SDK

The Hub repo ships a pre-built TypeScript SDK at
`packages/motta-public-sdk/`. Copy that folder into the marketing
repo as either:

- `packages/motta-public-sdk/` (if you set up workspace aliasing), OR
- `lib/motta/` (simpler — no workspace config needed)

Then add a path alias to the marketing project's `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "paths": {
      "@motta/public-sdk": ["./lib/motta/index.ts"],
      "@motta/public-sdk/*": ["./lib/motta/*"]
    }
  }
}
```

Install the peer deps if they're not already in the marketing repo:

```bash
pnpm add @supabase/supabase-js
```

---

## Endpoint reference

All `/api/public/*` routes accept either CORS-allowlisted browsers
or shared-secret server callers. Successful responses are JSON.

### `GET /api/public/health`

Liveness probe. Always 200 if the route is up. No auth.

### `GET /api/public/stats`

Returns `{ active_clients, returns_filed_ytd, states_served, as_of }`.
Edge-cached for 5 minutes. Use this for the marketing hero strip.

```ts
// app/page.tsx (marketing project, RSC)
import type { FirmStatsPublic } from "@motta/public-sdk"

const res = await fetch(`${process.env.MOTTA_HUB_URL}/api/public/stats`, {
  headers: { "x-motta-public-secret": process.env.MOTTA_PUBLIC_SECRET! },
  next: { revalidate: 300 },
})
const stats = (await res.json()) as FirmStatsPublic
```

> Or read the same numbers DIRECTLY from Supabase via the anon key
> (`getPublicSupabase().rpc("firm_stats_public_rpc")`). Both work;
> the direct path skips the Hub entirely.

### `POST /api/public/contact`

Body matches `ContactSubmissionInput` from `@motta/public-sdk`.
Server-side flow:
- inserts into `public.website_contact_submissions`
- creates a Master Hub Contact via `findOrCreateHubContact`
- runs ALFRED enrichment + question research
- emails the Motta team with the prefilled draft

Honeypot field: `website` (must be empty).

### `POST /api/public/intake`

Full intake form receiver. Body matches `IntakeSubmissionInput`.
This pipes through the same Karbon-push / ProConnect-link / fee-
estimate pipeline as the legacy Jotform intake.

### `POST /api/public/newsletter`

Body: `{ email, full_name?, source?, utm_*?, website? }`.
- Inserts into `marketing.newsletter_subscribers` (unconfirmed)
- Sends a Resend confirmation email pointing at
  `https://motta.cpa/newsletter/confirm?token=...`
- Returns `{ ok: true, subscriber_id, already_confirmed? }`

Confirmation: `GET /api/public/newsletter/confirm?token=…` flips
`confirmed_at` and clears the token.

Unsubscribe: `POST /api/public/newsletter/unsubscribe { email }`.
Always returns 200 — never leaks list membership.

---

## Recipes

### Recipe 1: Newsletter signup form (browser-direct, fastest)

```tsx
// motta.cpa, app/_components/newsletter-form.tsx
"use client"

import { useState } from "react"

export function NewsletterForm() {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "err">("idle")
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        setState("loading")
        const fd = new FormData(e.currentTarget)
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_HUB_URL}/api/public/newsletter`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              email: fd.get("email"),
              source: "homepage_footer",
            }),
          },
        )
        setState(res.ok ? "ok" : "err")
      }}
    >
      <input name="email" type="email" required />
      {/* honeypot — keep hidden via CSS, leave it empty */}
      <input name="website" tabIndex={-1} autoComplete="off" hidden />
      <button disabled={state === "loading"}>Subscribe</button>
      {state === "ok" && <p>Check your inbox to confirm.</p>}
    </form>
  )
}
```

`NEXT_PUBLIC_HUB_URL` is the only thing the browser needs — the
secret is NOT used here because the request comes from an
allowlisted origin.

### Recipe 2: Contact form (server-proxy, more secure)

```ts
// motta.cpa, app/api/contact/route.ts
import { hubFetch } from "@motta/public-sdk"

export async function POST(req: Request) {
  const body = await req.json()
  const ip = req.headers.get("x-forwarded-for") ?? ""
  const ua = req.headers.get("user-agent") ?? ""
  const result = await hubFetch("/api/public/contact", { body, ip, ua })
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : result.status,
    headers: { "content-type": "application/json" },
  })
}
```

This path is preferred for the contact form because the marketing
site can do its own logging / rate-limiting first and the secret
never touches the browser.

### Recipe 3: Live blog index (browser-direct, RLS-safe)

```tsx
// motta.cpa, app/blog/page.tsx (RSC)
import { getPublicSupabase, type BlogPost } from "@motta/public-sdk"

export default async function BlogIndex() {
  const supabase = getPublicSupabase()
  const { data } = await supabase
    .schema("marketing")
    .from("blog_posts")
    .select(
      "slug, title, excerpt, cover_image_url, published_at, author_name",
    )
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(20)
  const posts = (data ?? []) as Pick<
    BlogPost,
    "slug" | "title" | "excerpt" | "cover_image_url" | "published_at" | "author_name"
  >[]
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.slug}>
          <a href={`/blog/${p.slug}`}>{p.title}</a>
        </li>
      ))}
    </ul>
  )
}
```

No Hub round-trip — Supabase serves the request directly under the
anon RLS policy.

### Recipe 4: Live hero stats

```tsx
// motta.cpa, components/hero-stats.tsx
"use client"
import { useFirmStats } from "@motta/public-sdk/react"

export function HeroStats() {
  const stats = useFirmStats()
  if (!stats) return null
  return (
    <div className="flex gap-8">
      <Stat label="Active clients" value={stats.active_clients} />
      <Stat label="Returns filed YTD" value={stats.returns_filed_ytd} />
      <Stat label="States served" value={stats.states_served} />
    </div>
  )
}
```

---

## Operational rules (do not regress)

1. **Migrations are Hub-only.** All `marketing.*` DDL ships from
   `Motta-Financial/v0-motta-hub/scripts/NNN_*.sql`. The marketing
   project never runs migrations.
2. **No service-role key on motta.cpa.** Ever. If you need bypass-RLS
   behavior, add a Hub `/api/public/*` route and call it.
3. **Domains:** `motta.cpa` = marketing, `hub.motta.cpa` = Hub. Auth
   lives only on the Hub. If a visitor needs to log in, redirect to
   `hub.motta.cpa`.
4. **Anon-readable schema = `marketing.*` only.** Don't add `anon`
   policies to `public.*` tables — that's how PII leaks.
5. **Welcome / brand copy on motta.cpa**: do not name the firm's
   third-party tools (Karbon, Calendly, Zoom, Ignition, Resend).
   ProConnect is the one allowed exception (Intuit-allow-listed for
   marketing).
6. **License-readiness:** ALFRED Ai will be licensed to other firms.
   When adding logic to the Hub that touches `marketing.*` or
   `motta.cpa`-specific copy, isolate it from ALFRED's core flows so
   it doesn't ship to other tenants.
</content>
