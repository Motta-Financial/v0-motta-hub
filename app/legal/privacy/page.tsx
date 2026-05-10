import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Privacy Policy | Motta Hub",
  description:
    "Privacy Policy for Motta Hub, covering data collection, storage, and handling of information from integrated services including Zoom.",
}

export default function PrivacyPolicyPage() {
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
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Last updated: {lastUpdated}</p>
        </header>

        <article className="prose prose-neutral max-w-none text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">1. Who We Are</h2>
            <p className="leading-relaxed">
              Motta Hub (&quot;the Platform&quot;) is an internal business operations platform
              operated by Motta Financial, LLC (&quot;Motta Financial&quot;, &quot;we&quot;, &quot;us&quot;).
              This Privacy Policy explains how we collect, use, store, share, and protect
              information processed by the Platform, including data obtained from
              integrated third-party services such as Zoom.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">2. Scope</h2>
            <p className="leading-relaxed">
              This policy applies to all users of the Platform, including Motta Financial
              employees and authorized collaborators, and to all personal data we receive
              from integrated services on behalf of those users. The Platform is intended
              for internal business use; it is not a consumer-facing product.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">3. Information We Collect</h2>
            <p className="leading-relaxed mb-4">We collect the following categories of information:</p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>
                <strong>Account information.</strong> Name, work email address, and role
                of each authorized Motta Hub user, managed through Supabase Auth.
              </li>
              <li>
                <strong>Zoom data.</strong> When you connect a Zoom account, we receive
                your Zoom user profile (name, email, account ID, time zone), your scheduled
                and past meeting metadata, your cloud recording metadata and download URLs,
                and your phone call history. We do not download recording media files; we
                store only the metadata and the Zoom-hosted URL.
              </li>
              <li>
                <strong>Zoom webhook events.</strong> Real-time event payloads delivered
                by Zoom for events your authorized scopes subscribe to (for example
                meeting started, meeting ended, recording completed, app deauthorized).
              </li>
              <li>
                <strong>OAuth tokens.</strong> Access tokens and refresh tokens issued by
                Zoom and other integrated services so the Platform can call those services
                on your behalf.
              </li>
              <li>
                <strong>Operational data.</strong> Work items, debriefs, proposals,
                invoices, and other internal records you or your colleagues create inside
                the Platform.
              </li>
              <li>
                <strong>Technical logs.</strong> Standard application logs (timestamps,
                IP addresses, request paths, error traces) used for debugging and
                security monitoring.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">4. How We Use Information</h2>
            <p className="leading-relaxed mb-4">We use the information described above to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Display your meetings, recordings, and call history inside the Platform</li>
              <li>Surface contextual information (for example linking a Zoom meeting to a client work item)</li>
              <li>Refresh expired access tokens with Zoom and other providers</li>
              <li>Verify the authenticity of incoming Zoom webhooks via HMAC-SHA256 signatures</li>
              <li>Detect, investigate, and respond to security incidents</li>
              <li>Comply with applicable legal obligations</li>
            </ul>
            <p className="leading-relaxed mt-4">
              We do not use Zoom data for advertising, do not sell Zoom data to any third
              party, and do not use Zoom data to train any machine learning model.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">5. Where Data Is Stored</h2>
            <p className="leading-relaxed mb-4">
              All Motta Hub data, including Zoom data, is stored in Supabase Postgres
              hosted in the United States. The database is encrypted at rest using AES-256
              and is accessed only by the Motta Hub application running on Vercel.
              Row-level security policies isolate each team member&apos;s connection
              records and tokens.
            </p>
            <p className="leading-relaxed">
              All network traffic between the user&apos;s browser, the Platform, Zoom,
              and Supabase uses HTTPS with TLS 1.2 or higher.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">6. How We Share Information</h2>
            <p className="leading-relaxed mb-4">
              We do not sell or rent personal information. We share data only with:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Service providers</strong> that host the Platform on our behalf
                (Vercel for compute and edge networking, Supabase for the database and
                authentication, Resend for transactional email, Vercel Blob for file
                storage). Each provider is contractually bound to handle data only on
                our instructions.
              </li>
              <li>
                <strong>The integrated source service</strong> (for example Zoom) when
                we call its API on your behalf using your authorized credentials.
              </li>
              <li>
                <strong>Legal and regulatory authorities</strong> when required by a
                valid legal request.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">7. Data Retention</h2>
            <p className="leading-relaxed">
              Detailed retention periods for each category of data are listed in our{" "}
              <Link
                href="/legal/data-retention"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Data Retention Policy
              </Link>
              . In summary: Zoom OAuth tokens are retained until you disconnect or until
              Zoom revokes them, Zoom meeting and recording metadata is retained for as
              long as it is operationally useful or until you request deletion, and raw
              webhook event payloads are retained for 30 days for audit purposes and then
              automatically purged.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">8. Your Rights and Choices</h2>
            <p className="leading-relaxed mb-4">You may, at any time:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Disconnect Zoom</strong> from the Platform settings or from the
                Zoom App Marketplace. We will immediately stop calling Zoom on your
                behalf and stop accepting new webhook events from your account.
              </li>
              <li>
                <strong>Request deletion</strong> of all your Zoom-derived data stored
                in the Platform by emailing the address in Section 11. We will honor
                deletion requests within 30 days.
              </li>
              <li>
                <strong>Request a copy</strong> of the personal data we hold about you.
              </li>
              <li>
                <strong>Correct</strong> inaccurate personal data through the Platform
                interface or by contacting us.
              </li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">9. Security</h2>
            <p className="leading-relaxed mb-4">
              We implement administrative, technical, and physical safeguards designed
              to protect personal information, including:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>TLS 1.2+ for all data in transit</li>
              <li>AES-256 encryption at rest for the Supabase Postgres database</li>
              <li>Row-level security policies that restrict access to each team member&apos;s records</li>
              <li>HMAC-SHA256 verification of all incoming Zoom webhook events with a 5-minute timestamp tolerance to prevent replay attacks</li>
              <li>Secrets stored as environment variables scoped to the Production environment, never committed to source control</li>
              <li>Principle-of-least-privilege access to production infrastructure</li>
            </ul>
            <p className="leading-relaxed mt-4">
              No method of transmission or storage is 100% secure. While we strive to
              protect personal information, we cannot guarantee absolute security.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">10. Children&apos;s Privacy</h2>
            <p className="leading-relaxed">
              The Platform is not directed to children under 16 and we do not knowingly
              collect personal information from children under 16.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">11. Contact Us</h2>
            <p className="leading-relaxed">
              For privacy-related questions, deletion requests, or to exercise any right
              described above, contact us at{" "}
              <a
                href="mailto:support@mottafinancial.com"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                support@mottafinancial.com
              </a>
              .
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">12. Changes to This Policy</h2>
            <p className="leading-relaxed">
              We may update this Privacy Policy from time to time. The &quot;Last updated&quot;
              date at the top of this page reflects the most recent revision. Material
              changes will be communicated through the Platform or via email.
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
