# Zoom App Marketplace — Submission Content (Motta Hub)

Copy-paste the sections below into the matching fields on the Zoom App
Marketplace "Production → App Submission" page. Every text block here is
sized to fit Zoom's field limits and is written to satisfy the security
reviewer's standard checklist.

---

## App Listing → App Information

### Short description (≤100 chars)

> Sync Zoom meetings, recordings, and call history into Motta Hub for the Motta Financial team.

### Long description

> Motta Hub is the internal operations platform used by Motta Financial, a
> CPA firm. The Zoom integration consolidates each team member's Zoom
> meeting metadata, cloud recording metadata, and phone call history into
> a single team calendar so accountants can see all client interactions in
> one place alongside their work-item, debrief, proposal, and invoice
> systems.
>
> Each team member installs the integration once from the Zoom App
> Marketplace and grants read access to their own meetings, recordings,
> and phone call history through standard OAuth 2.0. The integration reads
> only what is needed to populate the internal team calendar and recording
> archive. It does not create, modify, or delete any Zoom resources, and
> it does not access data belonging to users who have not personally
> authorized the app.

### Deep-link URL (where users initiate authorization)

```
https://motta.cpa/calendar/zoom
```

This is the in-app Zoom Team Calendar page. When a user lands here without
an active Zoom connection, the UI prompts them to click "Connect Zoom",
which initiates the OAuth authorization redirect.

---

## App Listing → Links & Support

### Documentation URL

```
https://motta.cpa/docs/zoom-integration
```

This page is publicly accessible (no Hub login required) and covers
install flow, scopes/data accessed, security model, deauthorization,
troubleshooting, and contact information. It is the canonical reference
the security reviewer should use to verify the technical claims in this
submission.

### Privacy Policy URL

```
https://motta.cpa/legal/privacy
```

### Terms of Service URL

```
https://motta.cpa/legal/terms
```

### Data Retention Policy URL (optional but recommended)

```
https://motta.cpa/legal/data-retention
```

### Support email

```
support@mottafinancial.com
```

---

## Technical Design → Overview

### Technology Stack (rich-text field)

> **Frontend**
> - Next.js 15 (App Router) deployed on Vercel
> - React 19 with Server Components
> - Tailwind CSS v4 for styling
> - shadcn/ui component library
>
> **Backend (serverless on Vercel)**
> - Next.js API routes (Node.js 20 runtime)
> - Standard library `node:crypto` for HMAC-SHA256 webhook verification
> - `postgres` (porsager/postgres) for direct SQL access
> - `@supabase/ssr` for cookie-based authenticated sessions
>
> **Database & Auth**
> - Supabase Postgres (managed PostgreSQL, AES-256 encryption at rest, US region)
> - Supabase Auth for team member identity (email + password, server-side sessions)
> - Row-Level Security policies keyed on `team_member_id`
>
> **Integrations called from this app**
> - Zoom OAuth 2.0 (`zoom.us/oauth/authorize`, `zoom.us/oauth/token`)
> - Zoom REST API v2 (`api.zoom.us/v2`)
> - Zoom Webhooks (HMAC-SHA256 verification, 5-minute timestamp tolerance)
>
> **Operational tooling**
> - Vercel CLI and Vercel REST API for deployment and environment management
> - GitHub (Motta-Financial/v0-motta-hub) for source control and CI
>
> **Specific Zoom endpoints the integration calls**
> 1. `GET /v2/users/me` — fetch the authorizing user's profile
> 2. `GET /v2/users/me/meetings` — list scheduled meetings
> 3. `GET /v2/users/{userId}/recordings` — list cloud recordings
> 4. `GET /v2/phone/call_history` — list phone call history
> 5. `POST /oauth/token` (refresh_token grant) — rotate access tokens
>
> The app does not call any write endpoint and does not access any other
> Zoom user's data.

### Architecture Diagram

Upload `/public/zoom-architecture-diagram.jpg`
(also available at `https://motta.cpa/zoom-architecture-diagram.jpg`).

### Application Development questions

1. **Do you have a secure software development process (SSDLC)?** No.
   Motta Hub is an internal-use platform built by a small team. We follow
   informal secure-development practices (code review on every change,
   secrets out of source, dependency updates) but do not maintain a
   formal SSDLC certification.
2. **Does your application undergo SAST and/or DAST?** No. We rely on
   GitHub's built-in CodeQL alerts and Dependabot for dependency-level
   vulnerability scanning. We have not contracted dedicated SAST/DAST
   tooling.
3. **Does the application periodically undergo 3rd-party penetration
   testing?** No. As an internal-use app for a single CPA firm we have
   not contracted external penetration testing. We are open to doing so
   if Zoom's review process requires it.
4. **Additional documents (recommended).** Uploading:
   - Privacy Policy (`https://motta.cpa/legal/privacy`)
   - Data Retention Policy (`https://motta.cpa/legal/data-retention`)
   - Terms of Service (`https://motta.cpa/legal/terms`)

---

## Technical Design → Security

### Question 1: Does your app use TLS 1.2+ for all network traffic, including Zoom user's data?

**Yes.** All traffic to and from Motta Hub uses HTTPS terminated by Vercel's
edge network, which enforces TLS 1.2 or higher (TLS 1.3 by default). The
OAuth redirect URI (`https://motta.cpa/api/zoom/oauth/callback`) and the
webhook endpoint (`https://motta.cpa/api/zoom/webhook`) are both HTTPS-only.
All calls to `api.zoom.us` and `zoom.us/oauth/token` are made over HTTPS
using Node.js's built-in `fetch`, which uses the OS TLS stack on Vercel's
runtime.

### Question 2: Is the integration utilizing verification tokens or secret tokens and the x-zm-signature header to confirm incoming Webhook Events are coming from Zoom?

**Yes.** Every event delivered to `/api/zoom/webhook` is verified before
any processing:

1. The route reads `x-zm-request-timestamp` and `x-zm-signature` headers.
2. If the timestamp is more than 5 minutes from the server's current
   time, the request is rejected with HTTP 401 (replay protection).
3. The route recomputes `HMAC-SHA256("v0:" + timestamp + ":" + body,
   ZOOM_WEBHOOK_SECRET_TOKEN)` and compares it in constant time
   (`crypto.timingSafeEqual`) against the received signature.
4. Only on a successful match does the route proceed to handle the
   event payload.

The `endpoint.url_validation` challenge handshake is implemented per
Zoom's spec and was successfully validated by Zoom on May 10, 2026.

### Question 3: Does your application collect, store, log, or retain Zoom user data, including Zoom OAuth Tokens?

**Yes.** The full data inventory is published at
`https://motta.cpa/legal/data-retention`. In summary:

- **OAuth tokens** (access & refresh): stored in the `zoom_connections`
  table in Supabase Postgres, encrypted at rest by Supabase using
  AES-256. Cleared immediately on disconnect or `app_deauthorized`.
- **Zoom user profile cache** (name, email, account ID, time zone):
  stored on the same row.
- **Meeting metadata** (meeting ID, topic, host, start time, duration,
  join URL): stored in `zoom_meetings`.
- **Recording metadata** (recording ID, host, file types, Zoom-hosted
  download URL, transcript URL): stored in `zoom_recordings`. We do
  **not** download recording media files.
- **Phone call history** (caller, callee, direction, duration,
  timestamps): stored in `zoom_phone_calls`.
- **Raw webhook event payloads**: stored in `zoom_webhook_events` for
  30 days for audit purposes, then automatically purged.
- **Application logs**: Vercel's default 30-day log retention.

Row-level security policies in Postgres restrict access to each team
member's records by `team_member_id`. The Supabase `service_role` key
required to read these rows is held only by the Vercel server-side
runtime and is never exposed to the browser.

---

## Notes for the Reviewer

- **Scope footprint.** Motta Hub currently has a broad set of read scopes
  enabled in anticipation of future internal features (meeting analytics,
  recording summaries, phone-call linking to client records). The code
  deployed today calls only the five endpoints listed under "Technology
  Stack" above. We are happy to provide a per-scope justification on
  request and to trim scopes that the review team feels are not
  sufficiently justified.
- **User base.** Motta Hub is used exclusively by Motta Financial
  employees and authorized collaborators. There is no general-public
  signup. Each authorizing Zoom user is therefore a known internal user.
- **No meeting joining or RTMS.** The integration does not join meetings,
  does not use the OBF/ZAK/RTMS APIs, and is unaffected by the March 2,
  2026 meeting-authorization requirement shown at the top of the
  Marketplace dashboard.
