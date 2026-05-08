import Link from "next/link"
import { ArrowLeft, Send, Trophy } from "lucide-react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { TommyVotingForm } from "@/components/tommy-awards/tommy-voting-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const metadata = {
  title: "Submit Ballot | Tommy Awards | Motta Financial",
  description: "Cast your weekly Tommy Award ballot for the Motta Financial team.",
}

export default function Page() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Slim brand-themed hero — sage on cream, matches Motta's
            sidebar/page chrome. Keeps the trophy iconography but drops
            the navy/red Patriots palette in favor of company colors. */}
        <div className="relative overflow-hidden rounded-2xl border border-[#8E9B79]/40 bg-gradient-to-br from-[#6B745D] via-[#7c876c] to-[#5a6450] text-white">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(234,230,225,0.45),transparent_55%)]" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_85%,rgba(142,155,121,0.5),transparent_55%)]" />
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#8E9B79] via-[#EAE6E1] to-[#8E9B79]" />
          </div>

          <div className="relative z-10 p-6 lg:p-8">
            <div className="flex items-center justify-between gap-4 mb-5">
              <Link
                href="/tommy-awards"
                className="inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Tommy Awards
              </Link>
              <Badge className="bg-white/15 hover:bg-white/25 text-white border border-white/25 text-[11px] uppercase tracking-wider">
                Weekly Ballot
              </Badge>
            </div>

            <div className="flex items-start gap-5">
              <div className="flex-shrink-0 w-16 h-16 lg:w-20 lg:h-20 rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shadow-lg">
                <Send className="h-8 w-8 lg:h-10 lg:w-10 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-balance">
                  Submit Your Tommy Award Ballot
                </h1>
                <p className="mt-2 text-white/85 text-sm lg:text-base leading-relaxed max-w-3xl text-pretty">
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

        {/* Secondary CTA back to standings */}
        <div className="flex justify-center pt-2">
          <Button asChild variant="outline" className="border-[#8E9B79]/60 text-[#6B745D] hover:bg-[#8E9B79]/10">
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
