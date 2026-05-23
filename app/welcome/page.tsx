import Link from "next/link"
import type { Metadata } from "next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ArrowRight, FileText, MessageSquare, ExternalLink } from "lucide-react"

export const metadata: Metadata = {
  title: "Motta Financial — Welcome",
  description:
    "Motta Financial is a boutique CPA firm building modern accounting, tax, and advisory experiences for owners and operators.",
}

// Anonymous landing surface served on motta.cpa. Staff sign-in lives at
// /login; this page is what the public sees instead of being immediately
// bounced to the auth screen. Kept intentionally light — it's a bridge,
// not the marketing site (which lives at mottafinancial.com).
export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/welcome" className="flex items-center gap-2">
            <span className="text-lg font-semibold tracking-tight">
              MOTTA <span className="text-muted-foreground">FINANCIAL</span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <a
                href="https://www.mottafinancial.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Marketing site
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href="/login">
                Log in
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-3xl space-y-6">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Welcome to Motta
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            A boutique CPA firm built for modern owners and operators.
          </h1>
          <p className="text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
            We work with growth-stage businesses, professionals, and families on
            tax, accounting, and advisory — backed by ALFRED, our in-house Ai
            assistant that keeps every engagement responsive and well-prepared.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild size="lg">
              <a
                href="https://www.mottafinancial.com/intake-form"
                target="_blank"
                rel="noopener noreferrer"
              >
                Become a client
                <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">Team log in</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <FileText className="h-5 w-5 text-primary" />
              <CardTitle className="mt-3 text-base">New client intake</CardTitle>
              <CardDescription>
                A short, guided form. ALFRED reviews your responses, drafts a
                fee estimate, and routes you to the right team member.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="link" className="p-0">
                <a
                  href="https://www.mottafinancial.com/intake-form"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Start the intake
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <MessageSquare className="h-5 w-5 text-primary" />
              <CardTitle className="mt-3 text-base">Send us a message</CardTitle>
              <CardDescription>
                Have a quick question? Drop us a note and the right partner will
                follow up — usually within a business day.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="link" className="p-0">
                <a
                  href="https://www.mottafinancial.com/contact"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open contact form
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <ExternalLink className="h-5 w-5 text-primary" />
              <CardTitle className="mt-3 text-base">Existing clients</CardTitle>
              <CardDescription>
                Document portal, e-signing, and meeting links are sent via
                email — check the most recent message from your team member.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="link" className="p-0">
                <a
                  href="https://www.mottafinancial.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Visit mottafinancial.com
                  <ArrowRight className="ml-1 h-4 w-4" />
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <footer className="border-t border-border/60 bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-6 py-8 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} Motta Financial. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-sm">
            <Link
              href="/legal/terms"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              href="/legal/privacy"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Team log in
            </Link>
          </div>
        </div>
      </footer>
    </main>
  )
}
