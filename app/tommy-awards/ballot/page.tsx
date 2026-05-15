import Link from "next/link"
import { ArrowLeft, Send, Trophy } from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TommyVotingForm } from "@/components/tommy-awards/tommy-voting-form"
import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Submit Ballot | Tommy Awards | Motta Financial",
  description: "Cast your weekly Tommy Award ballot for the Motta Financial team.",
}

export default function Page() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Brand-themed hero — Motta Alliance comic-book style with dark
            midnight olive base and comic-green accent, halftone texture. */}
        <div
          className="relative overflow-hidden rounded-2xl border-2"
          style={{
            backgroundColor: "#0F140C",
            borderColor: "rgba(168,197,102,0.30)",
            boxShadow:
              "0 0 0 1px rgba(168,197,102,0.08) inset, 0 30px 80px -40px rgba(0,0,0,0.75)",
          }}
        >
          {/* Radial gradient spotlights */}
          <div
            aria-hidden
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage:
                "radial-gradient(circle at 90% 0%, rgba(168,197,102,0.18), transparent 55%)," +
                "radial-gradient(circle at 0% 100%, rgba(230,168,92,0.10), transparent 55%)",
            }}
          />
          {/* Halftone dot pattern */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage:
                "radial-gradient(circle at center, rgba(244,239,232,0.8) 1px, transparent 1.5px)",
              backgroundSize: "8px 8px",
            }}
          />

          <div className="relative z-10 p-6 lg:p-8">
            <div className="flex items-center justify-between gap-4 mb-5">
              <Link
                href="/tommy-awards"
                className="inline-flex items-center gap-1.5 text-sm transition-colors"
                style={{ color: "#B8B3AA" }}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Tommy Awards
              </Link>
              <span
                className="inline-flex items-center rounded-sm border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.22em]"
                style={{
                  borderColor: "rgba(168,197,102,0.5)",
                  color: "#A8C566",
                  backgroundColor: "rgba(168,197,102,0.08)",
                }}
              >
                Weekly Ballot
              </span>
            </div>

            <div className="flex items-start gap-5">
              <div
                className="flex-shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-2xl border-2 flex items-center justify-center shadow-lg"
                style={{
                  backgroundColor: "rgba(168,197,102,0.15)",
                  borderColor: "rgba(168,197,102,0.40)",
                  boxShadow: "0 0 40px rgba(168,197,102,0.20)",
                }}
              >
                <Send className="h-8 w-8 lg:h-10 lg:w-10" style={{ color: "#A8C566" }} />
              </div>
              <div className="flex-1 min-w-0">
                <h1
                  className="font-sans text-3xl font-black uppercase italic leading-[0.95] tracking-tight text-balance lg:text-4xl"
                  style={{
                    color: "#F4EFE8",
                    textShadow: "0 2px 0 rgba(0,0,0,0.6), 0 0 30px rgba(168,197,102,0.18)",
                  }}
                >
                  Submit Your <span style={{ color: "#A8C566" }}>Ballot</span>
                </h1>
                <p
                  className="mt-3 text-sm lg:text-base leading-relaxed max-w-3xl text-pretty"
                  style={{ color: "#B8B3AA" }}
                >
                  Recognize the teammates who went the extra mile, delivered
                  client wins, lifted others up, and lived the firm&apos;s
                  values this week. Ballots can be amended any time before the
                  weekly recap goes out.
                </p>
              </div>
            </div>
          </div>
        </div>

        <TommyVotingForm />

        {/* Secondary CTA back to standings — comic-book styled */}
        <div className="flex justify-center pt-2">
          <Button
            asChild
            variant="outline"
            style={{
              borderColor: "rgba(168,197,102,0.40)",
              color: "#A8C566",
              backgroundColor: "transparent",
            }}
          >
            <Link href="/tommy-awards" className="inline-flex items-center gap-2">
              <Trophy className="h-4 w-4" />
              View Leaderboard & Standings
            </Link>
          </Button>
        </div>
      </div>
    </DashboardLayout>
  )
}
