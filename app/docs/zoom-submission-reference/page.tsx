import type { Metadata } from "next"
import Link from "next/link"
import { CopyBlock } from "./copy-block"

export const metadata: Metadata = {
  title: "Zoom Marketplace Submission Reference | Motta Hub",
  description:
    "Internal reference page containing every text block, URL, and answer needed to fill out the Zoom App Marketplace submission form for Motta Hub.",
  robots: {
    index: false,
    follow: false,
  },
}

export default function ZoomSubmissionReferencePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
          <Link
            href="/meetings/zoom"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Zoom
          </Link>
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Internal reference
          </span>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-6 py-12 prose prose-neutral dark:prose-invert prose-headings:font-sans prose-headings:tracking-tight prose-h1:text-4xl prose-h1:font-bold prose-h2:mt-12 prose-h2:text-2xl prose-h2:font-semibold prose-h3:mt-8 prose-h3:text-lg prose-h3:font-semibold prose-p:leading-relaxed prose-li:leading-relaxed prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:font-mono prose-code:before:content-none prose-code:after:content-none">
        <h1>Zoom Marketplace Submission Reference</h1>
        <p className="lead text-muted-foreground">
          Every text block, URL, and answer needed to fill out the Zoom App
          Marketplace submission form for Motta Hub. Click the copy button next
          to any field to grab its value, then paste it into the matching field
          at{" "}
          <a
            href="https://marketplace.zoom.us/develop/apps"
            target="_blank"
            rel="noreferrer"
          >
            marketplace.zoom.us → Production → App Submission
          </a>
          .
        </p>

        <p className="text-sm text-muted-foreground">
          The full markdown source for this page lives at{" "}
          <code>docs/zoom-marketplace-submission-content.md</code> in the
          repository.
        </p>

        <hr />

        <h2>App Listing → App Information</h2>

        <h3>Short description (≤100 chars)</h3>
        <CopyBlock label="Short description">
          Sync Zoom meetings, recordings, and call history into Motta Hub for
          the Motta Financial team.
        </CopyBlock>

        <h3>Long description</h3>
        <CopyBlock label="Long description" multiline>
          {`Motta Hub is the internal operations platform used by Motta Financial, a CPA firm. The Zoom integration consolidates each team member's Zoom meeting metadata, cloud recording metadata, and phone call history into a single team calendar so accountants can see all client interactions in one place alongside their work-item, debrief, proposal, and invoice systems.

Each team member installs the integration once from the Zoom App Marketplace and grants read access to their own meetings, recordings, and phone call history through standard OAuth 2.0. The integration reads only what is needed to populate the internal team calendar and recording archive. It does not create, modify, or delete any Zoom resources, and it does not access data belonging to users who have not personally authorized the app.`}
        </CopyBlock>

        <h3>Deep-link URL (where users initiate authorization)</h3>
        <CopyBlock label="Deep-link URL">
          https://motta.cpa/calendar/zoom
        </CopyBlock>
        <p>
          This is the in-app Zoom Team Calendar page. When a user lands here
          without an active Zoom connection, the UI prompts them to click{" "}
          <em>Connect Zoom</em>, which initiates the OAuth authorization
          redirect.
        </p>

        <hr />

        <h2>App Listing → Links & Support</h2>

        <h3>Documentation URL</h3>
        <CopyBlock label="Documentation URL">
          https://motta.cpa/docs/zoom-integration
        </CopyBlock>
        <p>
          This page is publicly accessible (no Hub login required) and covers
          install flow, scopes/data accessed, security model, deauthorization,
          troubleshooting, and contact information. It is the canonical
          reference the security reviewer should use to verify the technical
          claims in this submission.
        </p>

        <h3>Privacy Policy URL</h3>
        <CopyBlock label="Privacy Policy URL">
          https://motta.cpa/legal/privacy
        </CopyBlock>

        <h3>Terms of Service URL</h3>
        <CopyBlock label="Terms of Service URL">
          https://motta.cpa/legal/terms
        </CopyBlock>

        <h3>Data Retention Policy URL (optional but recommended)</h3>
        <CopyBlock label="Data Retention Policy URL">
          https://motta.cpa/legal/data-retention
        </CopyBlock>

        <h3>Support email</h3>
        <CopyBlock label="Support email">
          support@mottafinancial.com
        </CopyBlock>

        <hr />

        <h2>Technical Design → Overview</h2>

        <h3>Technology Stack (rich-text field)</h3>
        <CopyBlock label="Technology Stack" multiline>
          {`Frontend
- Next.js 15 (App Router) deployed on Vercel
- React 19 with Server Components
- Tailwind CSS v4 for styling
- shadcn/ui component library

Backend (serverless on Vercel)
- Next.js API routes (Node.js 20 runtime)
- Standard library node:crypto for HMAC-SHA256 webhook verification
- postgres (porsager/postgres) for direct SQL access
- @supabase/ssr for cookie-based authenticated sessions

Database & Auth
- Supabase Postgres (managed PostgreSQL, AES-256 encryption at rest, US region)
- Supabase Auth for team member identity (email + password, server-side sessions)
- Row-Level Security policies keyed on team_member_id

Integrations called from this app
- Zoom OAuth 2.0 (zoom.us/oauth/authorize, zoom.us/oauth/token)
- Zoom REST API v2 (api.zoom.us/v2)
- Zoom Webhooks (HMAC-SHA256 verification, 5-minute timestamp tolerance)

Operational tooling
- Vercel CLI and Vercel REST API for deployment and environment management
- GitHub (Motta-Financial/v0-motta-hub) for source control and CI

Specific Zoom endpoints the integration calls
1. GET /v2/users/me — fetch the authorizing user's profile
2. GET /v2/users/me/meetings — list scheduled meetings
3. GET /v2/users/{userId}/recordings — list cloud recordings
4. GET /v2/phone/call_history — list phone call history
5. POST /oauth/token (refresh_token grant) — rotate access tokens

The app does not call any write endpoint and does not access any other Zoom user's data.`}
        </CopyBlock>

        <h3>Architecture Diagram</h3>
        <p>
          Upload the file at <code>/public/zoom-architecture-diagram.jpg</code>{" "}
          (also publicly served at{" "}
          <a
            href="/zoom-architecture-diagram.jpg"
            target="_blank"
            rel="noreferrer"
          >
            https://motta.cpa/zoom-architecture-diagram.jpg
          </a>
          ).
        </p>
        <p>
          <a
            href="/zoom-architecture-diagram.jpg"
            target="_blank"
            rel="noreferrer"
            className="not-prose inline-block rounded-lg border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
          >
            Open architecture diagram in new tab
          </a>
        </p>

        <h3>Application Development questions</h3>
        <ol>
          <li>
            <strong>
              Do you have a secure software development process (SSDLC)?
            </strong>{" "}
            <em>No.</em> Motta Hub is an internal-use platform built by a small
            team. We follow informal secure-development practices (code review
            on every change, secrets out of source, dependency updates) but do
            not maintain a formal SSDLC certification.
          </li>
          <li>
            <strong>Does your application undergo SAST and/or DAST?</strong>{" "}
            <em>No.</em> We rely on GitHub&apos;s built-in CodeQL alerts and
            Dependabot for dependency-level vulnerability scanning. We have not
            contracted dedicated SAST/DAST tooling.
          </li>
          <li>
            <strong>
              Does the application periodically undergo 3rd-party penetration
              testing?
            </strong>{" "}
            <em>No.</em> As an internal-use app for a single CPA firm we have
            not contracted external penetration testing. We are open to doing
            so if Zoom&apos;s review process requires it.
          </li>
          <li>
            <strong>Additional documents (recommended).</strong> Upload these
            three URLs as documentation:
            <ul>
              <li>
                Privacy Policy —{" "}
                <a href="/legal/privacy">https://motta.cpa/legal/privacy</a>
              </li>
              <li>
                Data Retention Policy —{" "}
                <a href="/legal/data-retention">
                  https://motta.cpa/legal/data-retention
                </a>
              </li>
              <li>
                Terms of Service —{" "}
                <a href="/legal/terms">https://motta.cpa/legal/terms</a>
              </li>
            </ul>
          </li>
        </ol>

        <hr />

        <h2>Technical Design → Security</h2>

        <h3>
          Q1. Does your app use TLS 1.2+ for all network traffic, including
          Zoom user&apos;s data?
        </h3>
        <p>
          <strong>Answer: Yes.</strong>
        </p>
        <CopyBlock label="Q1 explanation" multiline>
          {`Yes. All traffic to and from Motta Hub uses HTTPS terminated by Vercel's edge network, which enforces TLS 1.2 or higher (TLS 1.3 by default). The OAuth redirect URI (https://hub.motta.cpa/api/zoom/oauth/callback) and the webhook endpoint (https://hub.motta.cpa/api/zoom/webhook) are both HTTPS-only. All calls to api.zoom.us and zoom.us/oauth/token are made over HTTPS using Node.js's built-in fetch, which uses the OS TLS stack on Vercel's runtime.`}
        </CopyBlock>

        <h3>
          Q2. Is the integration utilizing verification tokens or secret tokens
          and the x-zm-signature header to confirm incoming Webhook Events are
          coming from Zoom?
        </h3>
        <p>
          <strong>Answer: Yes.</strong>
        </p>
        <CopyBlock label="Q2 explanation" multiline>
          {`Yes. Every event delivered to /api/zoom/webhook is verified before any processing:

1. The route reads x-zm-request-timestamp and x-zm-signature headers.
2. If the timestamp is more than 5 minutes from the server's current time, the request is rejected with HTTP 401 (replay protection).
3. The route recomputes HMAC-SHA256("v0:" + timestamp + ":" + body, ZOOM_WEBHOOK_SECRET_TOKEN) and compares it in constant time (crypto.timingSafeEqual) against the received signature.
4. Only on a successful match does the route proceed to handle the event payload.

The endpoint.url_validation challenge handshake is implemented per Zoom's spec and was successfully validated by Zoom on May 10, 2026.`}
        </CopyBlock>

        <h3>
          Q3. Does your application collect, store, log, or retain Zoom user
          data, including Zoom OAuth Tokens?
        </h3>
        <p>
          <strong>Answer: Yes.</strong>
        </p>
        <CopyBlock label="Q3 explanation" multiline>
          {`Yes. The full data inventory is published at https://motta.cpa/legal/data-retention. In summary:

- OAuth tokens (access & refresh): stored in the zoom_connections table in Supabase Postgres, encrypted at rest by Supabase using AES-256. Cleared immediately on disconnect or app_deauthorized.
- Zoom user profile cache (name, email, account ID, time zone): stored on the same row.
- Meeting metadata (meeting ID, topic, host, start time, duration, join URL): stored in zoom_meetings.
- Recording metadata (recording ID, host, file types, Zoom-hosted download URL, transcript URL): stored in zoom_recordings. We do NOT download recording media files.
- Phone call history (caller, callee, direction, duration, timestamps): stored in zoom_phone_calls.
- Raw webhook event payloads: stored in zoom_webhook_events for 30 days for audit purposes, then automatically purged.
- Application logs: Vercel's default 30-day log retention.

Row-level security policies in Postgres restrict access to each team member's records by team_member_id. The Supabase service_role key required to read these rows is held only by the Vercel server-side runtime and is never exposed to the browser.`}
        </CopyBlock>

        <hr />

        <h2>Notes for the Reviewer</h2>
        <p>
          If Zoom&apos;s review form has a free-text &quot;notes for
          reviewer&quot; field, paste this. Otherwise, keep it ready for the
          first reviewer reply.
        </p>
        <CopyBlock label="Reviewer notes" multiline>
          {`- Scope footprint. Motta Hub currently has a broad set of read scopes enabled in anticipation of future internal features (meeting analytics, recording summaries, phone-call linking to client records). The code deployed today calls only the five endpoints listed under "Technology Stack" above. We are happy to provide a per-scope justification on request and to trim scopes that the review team feels are not sufficiently justified.

- User base. Motta Hub is used exclusively by Motta Financial employees and authorized collaborators. There is no general-public signup. Each authorizing Zoom user is therefore a known internal user.

- No meeting joining or RTMS. The integration does not join meetings, does not use the OBF/ZAK/RTMS APIs, and is unaffected by the March 2, 2026 meeting-authorization requirement shown at the top of the Marketplace dashboard.`}
        </CopyBlock>
      </article>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Internal reference — not indexed by search engines.</span>
          <Link href="/" className="hover:text-foreground">
            Motta Hub home →
          </Link>
        </div>
      </footer>
    </main>
  )
}
