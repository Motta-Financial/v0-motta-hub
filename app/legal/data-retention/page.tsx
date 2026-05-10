import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Data Retention Policy | Motta Hub",
  description:
    "How long Motta Hub retains data from integrated services (including Zoom) and how deletion requests are handled.",
}

export default function DataRetentionPolicyPage() {
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
            Data Retention Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </header>

        <article className="prose prose-neutral max-w-none text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">1. Purpose</h2>
            <p className="leading-relaxed">
              This policy describes how long Motta Hub (&quot;the Platform&quot;), operated by
              Motta Financial, LLC, retains personal and business data, with particular
              attention to data obtained from integrated services such as Zoom. It is
              intended to satisfy the data-handling and deletion requirements of those
              services&apos; marketplace policies and applicable privacy law.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">2. Retention Periods at a Glance</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 font-semibold">Data category</th>
                    <th className="text-left py-2 pr-4 font-semibold">Retention</th>
                    <th className="text-left py-2 font-semibold">Trigger to delete</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom OAuth access &amp; refresh tokens</td>
                    <td className="py-2 pr-4">Until disconnection</td>
                    <td className="py-2">User disconnect or <code>app_deauthorized</code> event</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom user profile cache</td>
                    <td className="py-2 pr-4">Until disconnection</td>
                    <td className="py-2">Disconnection or deletion request</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom meeting metadata</td>
                    <td className="py-2 pr-4">Operational lifetime</td>
                    <td className="py-2">Deletion request, or when no longer needed</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom recording metadata (no media)</td>
                    <td className="py-2 pr-4">Operational lifetime</td>
                    <td className="py-2">Deletion request, or when no longer needed</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom phone call history</td>
                    <td className="py-2 pr-4">Operational lifetime</td>
                    <td className="py-2">Deletion request, or when no longer needed</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Zoom webhook event payloads (raw)</td>
                    <td className="py-2 pr-4">30 days</td>
                    <td className="py-2">Automatic daily purge</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 pr-4">Application logs</td>
                    <td className="py-2 pr-4">30 days (Vercel default)</td>
                    <td className="py-2">Automatic rotation</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">Internal Hub records (work items, debriefs, etc.)</td>
                    <td className="py-2 pr-4">As long as the team member account is active</td>
                    <td className="py-2">Account deletion or explicit request</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">3. Zoom Data &mdash; Detailed</h2>

            <h3 className="text-lg font-semibold mt-6 mb-3">3.1 OAuth Tokens</h3>
            <p className="leading-relaxed">
              Access tokens and refresh tokens are stored in the <code>zoom_connections</code>
              table in our Supabase Postgres database. Tokens are retained for as long as
              the connection is active. When a user disconnects (from within the Platform
              or from the Zoom App Marketplace), or when Zoom delivers an
              <code> app_deauthorized</code> event for that user, the corresponding
              connection row is set to <code>is_active = false</code> and the token columns
              are cleared within minutes. The row itself is retained without tokens for
              auditability and is fully deleted on explicit request.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-3">3.2 Meeting and Recording Metadata</h3>
            <p className="leading-relaxed">
              We store meeting metadata (meeting ID, topic, host, start time, duration,
              join URL) and recording metadata (recording ID, host, start time, file types,
              Zoom-hosted download URL, transcript URL) in dedicated tables. We do not
              download recording media files; we store only the metadata and the
              Zoom-hosted URL, which remains subject to Zoom&apos;s own retention.
              Metadata is retained for as long as it is operationally useful to the team
              (for example to link a past meeting to a client work item) and is deleted
              on explicit user request or when the user&apos;s account is removed from
              the Platform.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-3">3.3 Webhook Event Payloads</h3>
            <p className="leading-relaxed">
              Every webhook delivered by Zoom is recorded in the
              <code> zoom_webhook_events</code> table along with the signed headers,
              raw body, signature verification result, and any error. These records are
              used for debugging and audit. A daily scheduled job purges rows older than
              30 days.
            </p>

            <h3 className="text-lg font-semibold mt-6 mb-3">3.4 Deauthorization Handling</h3>
            <p className="leading-relaxed">
              Motta Hub implements the Zoom App Marketplace
              <code> app_deauthorized</code> event. When Zoom notifies us that a user has
              uninstalled or revoked the app, we immediately mark the connection inactive,
              clear the stored tokens, and stop calling the Zoom API on that user&apos;s
              behalf. No further Zoom data is collected for that user until they
              reauthorize.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">4. Deletion Requests</h2>
            <p className="leading-relaxed mb-4">
              Users may request deletion of personal data by emailing the address in
              Section 7. Each request is acknowledged within 5 business days and
              completed within 30 days. Deletion is performed as follows:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Tokens.</strong> Immediately cleared from the
                <code> zoom_connections</code> row.
              </li>
              <li>
                <strong>Zoom-derived metadata.</strong> Rows in
                <code> zoom_meetings</code>, <code> zoom_recordings</code>, and
                <code> zoom_phone_calls</code> that are linked to the user are deleted.
              </li>
              <li>
                <strong>Webhook history.</strong> Webhook events tied to the user&apos;s
                Zoom account are deleted ahead of the normal 30-day purge.
              </li>
              <li>
                <strong>Backups.</strong> Supabase&apos;s point-in-time backups roll off
                automatically; we do not restore from backup to recover deleted data.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">5. Legal Holds</h2>
            <p className="leading-relaxed">
              In rare cases we may retain data beyond the periods stated above when
              required by law, regulation, or a valid legal process (for example
              litigation hold, subpoena, or regulatory inquiry). In such cases we will
              retain only the minimum data necessary and for only the period necessary.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">6. Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Data Retention Policy from time to time. The
              &quot;Last updated&quot; date at the top of this page reflects the most
              recent revision. Material changes will be communicated through the
              Platform or via email. See also our{" "}
              <Link
                href="/legal/privacy"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link
                href="/legal/terms"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Terms of Service
              </Link>
              .
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">7. Contact</h2>
            <p className="leading-relaxed">
              Send retention or deletion questions to{" "}
              <a
                href="mailto:support@mottafinancial.com"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                support@mottafinancial.com
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
