import type { Metadata } from "next"
import Link from "next/link"

export const metadata: Metadata = {
  title: "Terms of Service | Motta Hub",
  description: "Terms of Service for Motta Hub and integrated services",
}

export default function TermsOfServicePage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
        </header>

        <article className="prose prose-neutral max-w-none text-foreground prose-headings:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground prose-strong:text-foreground">
          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">1. Acceptance of Terms</h2>
            <p className="leading-relaxed">
              By accessing or using Motta Hub (&quot;the Platform&quot;), including any integrations 
              with third-party services such as Zoom, Calendly, Karbon, and others, you agree 
              to be bound by these Terms of Service. If you do not agree to these terms, 
              please do not use the Platform.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
            <p className="leading-relaxed">
              Motta Hub is an internal business platform operated by Motta Financial that 
              provides workflow management, client relationship tools, and integrations with 
              third-party services. The Platform is intended for use by authorized Motta 
              Financial team members and their designated collaborators.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">3. Third-Party Integrations</h2>
            <p className="leading-relaxed mb-4">
              The Platform integrates with third-party services including but not limited to:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li><strong>Zoom</strong> — Meeting scheduling, recordings, and transcripts</li>
              <li><strong>Calendly</strong> — Appointment scheduling</li>
              <li><strong>Karbon</strong> — Practice management and workflow</li>
              <li><strong>Stripe</strong> — Payment processing</li>
            </ul>
            <p className="leading-relaxed">
              When you connect a third-party service to Motta Hub, you authorize us to access 
              and process data from that service on your behalf. Your use of third-party 
              services is also subject to the terms and privacy policies of those services.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">4. Zoom Integration</h2>
            <p className="leading-relaxed mb-4">
              When you connect your Zoom account to Motta Hub, you authorize us to:
            </p>
            <ul className="list-disc pl-6 space-y-2 mb-4">
              <li>Access your Zoom meeting information, recordings, and transcripts</li>
              <li>Receive webhook notifications about meeting events</li>
              <li>Store meeting metadata and recordings for workflow purposes</li>
              <li>Display meeting information within the Platform</li>
            </ul>
            <p className="leading-relaxed">
              You may disconnect your Zoom account at any time through the Platform settings 
              or through the Zoom App Marketplace. Upon disconnection, we will cease accessing 
              new data from your Zoom account and will handle existing data in accordance with 
              our Privacy Policy and Zoom&apos;s data compliance requirements.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">5. Data Handling and Privacy</h2>
            <p className="leading-relaxed">
              Your use of the Platform is also governed by our{" "}
              <a
                href="https://www.mottafinancial.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                Privacy Policy
              </a>
              , which describes how we collect, use, and protect your information. We are 
              committed to maintaining the confidentiality and security of all data processed 
              through the Platform.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">6. User Responsibilities</h2>
            <p className="leading-relaxed mb-4">As a user of Motta Hub, you agree to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Use the Platform only for lawful purposes and in accordance with these Terms</li>
              <li>Maintain the confidentiality of your account credentials</li>
              <li>Notify us immediately of any unauthorized access to your account</li>
              <li>Not attempt to interfere with or disrupt the Platform&apos;s operation</li>
              <li>Comply with all applicable laws and regulations</li>
            </ul>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">7. Intellectual Property</h2>
            <p className="leading-relaxed">
              The Platform and its original content, features, and functionality are owned by 
              Motta Financial and are protected by copyright, trademark, and other intellectual 
              property laws. You may not copy, modify, distribute, or create derivative works 
              based on the Platform without our express written permission.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">8. Disclaimer of Warranties</h2>
            <p className="leading-relaxed">
              The Platform is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any 
              kind, either express or implied. We do not warrant that the Platform will be 
              uninterrupted, secure, or error-free.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">9. Limitation of Liability</h2>
            <p className="leading-relaxed">
              To the fullest extent permitted by law, Motta Financial shall not be liable for 
              any indirect, incidental, special, consequential, or punitive damages arising 
              from your use of the Platform or any third-party integrations.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">10. Changes to Terms</h2>
            <p className="leading-relaxed">
              We reserve the right to modify these Terms at any time. We will provide notice 
              of material changes through the Platform or via email. Your continued use of 
              the Platform after such modifications constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section className="mb-10">
            <h2 className="text-xl font-semibold mb-4">11. Contact Information</h2>
            <p className="leading-relaxed">
              If you have any questions about these Terms of Service, please contact us at:{" "}
              <a
                href="mailto:support@mottafinancial.com"
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                support@mottafinancial.com
              </a>
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
