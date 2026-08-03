import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Zoom Integration | Motta Hub",
  description:
    "How the Motta Hub Zoom integration works: installation, permissions, data handling, security, and how to disconnect.",
}

export default function ZoomIntegrationDocsPage() {
  const lastUpdated = "May 10, 2026"

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <header className="mb-12">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; Back to Motta Hub
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Zoom Integration
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
          <p className="mt-6 text-pretty leading-relaxed text-muted-foreground">
            This page explains how the Motta Hub Zoom integration works, what data it
            accesses, how that data is stored and protected, and how to install, use, or
            disconnect the integration.
          </p>
        </header>

        <article className="prose prose-neutral max-w-none text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground prose-code:text-foreground">
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">1. Overview</h2>
            <p className="leading-relaxed mb-4">
              Motta Hub is an internal operations platform for Motta Financial, a CPA
              firm. The Zoom integration ingests meeting metadata, cloud recordings, and
              call history from each authorized team member&apos;s Zoom account so that
              accountants can view client meeting context alongside the rest of their
              workflow (work items, debriefs, proposals, invoices) in a single
              dashboard.
            </p>
            <p className="leading-relaxed">
              The integration is a <strong>read-only consumer</strong> of Zoom data. It
              does not create, modify, or delete any Zoom resources, and it does not
              access any user&apos;s data unless that user has personally authorized the
              app through standard OAuth 2.0.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">2. Installation</h2>
            <ol className="list-decimal pl-6 space-y-2 mb-4">
              <li>
                Sign in to Motta Hub and navigate to <strong>Calendar &rarr; Zoom</strong>.
              </li>
              <li>
                Click <strong>Connect Zoom</strong>. You will be redirected to Zoom and
                asked to authorize Motta Hub against your Zoom account.
              </li>
              <li>
                Review the requested permissions on the Zoom consent screen and click{" "}
                <strong>Allow</strong>.
              </li>
              <li>
                You will be redirected back to Motta Hub. The Zoom Team Calendar page
                will display your meetings, recordings, and call history.
              </li>
            </ol>
            <p className="leading-relaxed">
              Each team member installs the integration once. The app cannot impersonate
              users who have not personally authorized it.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">3. What the integration accesses</h2>
            <p className="leading-relaxed mb-4">
              Motta Hub currently calls the following Zoom API endpoints. Every call is
              made on behalf of the authorizing user and is restricted to that
              user&apos;s own data.
            </p>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="w-full text-sm border border-border rounded-md">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-4 py-2 font-medium text-foreground border-b border-border">
                      Endpoint
                    </th>
                    <th className="px-4 py-2 font-medium text-foreground border-b border-border">
                      Purpose
                    </th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="px-4 py-2 align-top">
                      <code className="text-xs">GET /v2/users/me</code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      Fetch the authorizing user&apos;s Zoom profile (display name,
                      email, Zoom user id).
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2 align-top">
                      <code className="text-xs">GET /v2/users/me/meetings</code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      List scheduled meetings to populate the Zoom Team Calendar.
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2 align-top">
                      <code className="text-xs">
                        GET /v2/users/&#123;userId&#125;/recordings
                      </code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      List cloud recordings owned by the authorizing user for archival
                      and debrief review.
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="px-4 py-2 align-top">
                      <code className="text-xs">GET /v2/phone/call_history</code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      Populate the firm&apos;s internal call-history view (Zoom Phone
                      customers only).
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 align-top">
                      <code className="text-xs">POST /oauth/token</code>
                    </td>
                    <td className="px-4 py-2 align-top">
                      Rotate access tokens via the standard refresh-token grant.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="leading-relaxed mt-4">
              The integration may request additional read-only scopes that are not
              currently exercised by deployed code; these are reserved for planned
              features (meeting transcripts, webinar attendance, team-admin reporting)
              and will only be used after those features are released and documented
              here.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">4. Webhook events</h2>
            <p className="leading-relaxed mb-4">
              Motta Hub subscribes to the following Zoom webhook events at{" "}
              <code className="text-xs">https://hub.motta.cpa/api/zoom/webhook</code>. Every
              incoming event is verified before processing using the{" "}
              <code className="text-xs">x-zm-signature</code> header and the app&apos;s
              Secret Token (HMAC-SHA256). Requests with a timestamp more than five
              minutes off are rejected to prevent replay.
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <code className="text-xs">meeting.started</code> /{" "}
                <code className="text-xs">meeting.ended</code> &mdash; keep the team
                calendar in sync without polling.
              </li>
              <li>
                <code className="text-xs">recording.completed</code> &mdash; ingest new
                cloud recordings as they become available.
              </li>
              <li>
                <code className="text-xs">app_deauthorized</code> &mdash; immediately
                invalidate stored tokens when a user uninstalls the app from their Zoom
                account (see <a href="#disconnect" className="text-primary underline underline-offset-2 hover:text-primary/80">Section 7</a>).
              </li>
              <li>
                <code className="text-xs">endpoint.url_validation</code> &mdash; Zoom&apos;s
                handshake used during webhook URL setup.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">5. Data storage and retention</h2>
            <p className="leading-relaxed mb-4">
              Data fetched from Zoom is stored in a managed Supabase Postgres database
              that is encrypted at rest using AES-256. Access to the database is
              restricted to server-side environments using a privileged
              service-role key; row-level security policies further restrict access on
              a per-team-member basis.
            </p>
            <p className="leading-relaxed mb-4">
              The integration stores the following Zoom-derived data:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>
                <strong>OAuth tokens</strong> in <code className="text-xs">zoom_connections</code>:
                access token, refresh token, expiry, granted scopes, Zoom user id, and
                Zoom email. Used only to authenticate Zoom API requests on behalf of the
                user.
              </li>
              <li>
                <strong>Meeting metadata</strong> in{" "}
                <code className="text-xs">zoom_meetings</code>: topic, start/end times,
                duration, host id, join URL. Used to render the Zoom Team Calendar.
              </li>
              <li>
                <strong>Recording metadata</strong> in{" "}
                <code className="text-xs">zoom_recordings</code>: recording id, file
                size, duration, download URL, transcript URL. Used to list and link to
                Zoom&apos;s own recording-playback page; recordings themselves are
                streamed from Zoom, not copied.
              </li>
              <li>
                <strong>Webhook event payloads</strong> in{" "}
                <code className="text-xs">zoom_webhook_events</code>: raw event payload
                plus signature-verification result. Retained for 30 days for audit and
                debugging, then automatically purged by a daily cron.
              </li>
            </ul>
            <p className="leading-relaxed">
              Motta Hub does not download, redistribute, or re-host any Zoom recording
              media or transcript files. Click-throughs to recordings are served by
              Zoom&apos;s own infrastructure using time-limited download URLs.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">6. Security</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Transport security:</strong> all traffic to and from Zoom uses
                HTTPS with TLS 1.2 or above, terminated at Vercel&apos;s edge.
              </li>
              <li>
                <strong>Webhook verification:</strong> every Zoom event is verified by
                recomputing <code className="text-xs">HMAC-SHA256</code> over{" "}
                <code className="text-xs">v0:&lt;timestamp&gt;:&lt;body&gt;</code> using
                the Secret Token, then compared in constant time against the{" "}
                <code className="text-xs">x-zm-signature</code> header. Replay
                protection is enforced via a five-minute timestamp tolerance.
              </li>
              <li>
                <strong>Secret handling:</strong> the Zoom Client ID, Client Secret, and
                webhook Secret Token are stored exclusively as encrypted server-side
                environment variables. They are never committed to source, never sent
                to the browser, and never logged.
              </li>
              <li>
                <strong>Token rotation:</strong> refresh-token grants return a new
                refresh token, which is persisted before the next refresh. If Zoom
                rejects a refresh (token revoked, app uninstalled), the connection is
                marked inactive and the user is prompted to reconnect.
              </li>
              <li>
                <strong>Authentication:</strong> Motta Hub uses Supabase Auth for user
                sessions; all routes that read Zoom data require an authenticated Hub
                session and verify the request belongs to the connection owner.
              </li>
            </ul>
          </section>

          <section id="disconnect" className="mb-10">
            <h2 className="text-xl font-semibold mb-4">7. Disconnecting the integration</h2>
            <p className="leading-relaxed mb-4">
              You may disconnect Motta Hub from your Zoom account at any time using
              either of these methods:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>
                <strong>From Motta Hub:</strong> open <strong>Calendar &rarr; Zoom</strong>{" "}
                and click <strong>Disconnect</strong>. This deletes your access and
                refresh tokens from the database immediately.
              </li>
              <li>
                <strong>From the Zoom App Marketplace:</strong> sign in to Zoom, open{" "}
                <strong>Manage &rarr; Installed Apps</strong>, find Motta Hub, and click{" "}
                <strong>Remove</strong>. Zoom will send our webhook an{" "}
                <code className="text-xs">app_deauthorized</code> event; we
                automatically clear your tokens and mark the connection inactive on
                receipt.
              </li>
            </ul>
            <p className="leading-relaxed">
              After disconnection, no new Zoom data will be ingested. Existing
              Zoom-derived rows (meeting metadata, recording metadata) can be deleted
              from your account by emailing <a href="mailto:support@mottafinancial.com" className="text-primary underline underline-offset-2 hover:text-primary/80">
                support@mottafinancial.com
              </a>{" "}
              with a deletion request; we honor such requests within 30 days.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">8. Troubleshooting</h2>
            <p className="leading-relaxed mb-4">
              <strong>The Zoom Team Calendar shows &quot;0 users connected.&quot;</strong>{" "}
              Click <strong>Connect Zoom</strong> to start the OAuth flow. If you
              previously connected and were later prompted to reconnect, this is
              expected after any change to the app&apos;s scope list &mdash; your
              previous grant must be re-issued to cover the new scopes.
            </p>
            <p className="leading-relaxed mb-4">
              <strong>I see &quot;Zoom rejected the token exchange.&quot;</strong> This
              means the OAuth code returned by Zoom could not be exchanged for an access
              token. Try the Connect flow again from a fresh browser tab. If the error
              persists, contact support &mdash; it usually indicates a credential or
              redirect-URI configuration issue on our side.
            </p>
            <p className="leading-relaxed">
              <strong>My meetings aren&apos;t syncing.</strong> Click <strong>Sync All</strong>{" "}
              on the Zoom Team Calendar page to force an immediate refresh. If meetings
              still don&apos;t appear after a minute, verify that your Zoom account
              owns the meetings in question &mdash; the integration only displays
              meetings hosted by the connected user.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">9. Support and legal</h2>
            <p className="leading-relaxed mb-4">
              For questions, account issues, or data-deletion requests:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>
                Email:{" "}
                <a
                  href="mailto:support@mottafinancial.com"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  support@mottafinancial.com
                </a>
              </li>
              <li>
                Terms of Service:{" "}
                <Link
                  href="/legal/terms"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  /legal/terms
                </Link>
              </li>
              <li>
                Privacy Policy:{" "}
                <a
                  href="https://www.mottafinancial.com/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:text-primary/80"
                >
                  mottafinancial.com/privacy
                </a>
              </li>
            </ul>
            <p className="leading-relaxed">
              This integration is provided by Motta Financial for use by its team
              members. Use of the integration is subject to the Motta Hub Terms of
              Service and Privacy Policy linked above, and your use of Zoom is
              additionally governed by{" "}
              <a
                href="https://explore.zoom.us/en/terms/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Zoom&apos;s Terms of Service
              </a>
              .
            </p>
          </section>
        </article>

        <footer className="mt-16 pt-8 border-t border-border">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Motta Financial. All rights reserved.
          </p>
        </footer>
      </div>
    </main>
  )
}
