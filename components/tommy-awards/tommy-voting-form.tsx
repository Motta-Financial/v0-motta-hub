"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Trophy, Medal, Award, Star, Sparkles, Send, Users, Info } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

interface TeamMember {
  id: string
  full_name: string
  email: string
  avatar_url: string | null
  role: string | null
}

interface VoteSelection {
  memberId: string | null
  memberName: string
  notes: string
}

export function TommyVotingForm() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentWeekId, setCurrentWeekId] = useState<string | null>(null)
  const [currentVoter, setCurrentVoter] = useState<string>("")
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear())

  const [firstPlace, setFirstPlace] = useState<VoteSelection>({ memberId: null, memberName: "", notes: "" })
  const [secondPlace, setSecondPlace] = useState<VoteSelection>({ memberId: null, memberName: "", notes: "" })
  const [thirdPlace, setThirdPlace] = useState<VoteSelection>({ memberId: null, memberName: "", notes: "" })
  const [honorableMention, setHonorableMention] = useState<VoteSelection>({ memberId: null, memberName: "", notes: "" })
  const [partnerVote, setPartnerVote] = useState<VoteSelection>({ memberId: null, memberName: "", notes: "" })
  const [isPartner, setIsPartner] = useState(false)

  const is2026OrLater = currentYear >= 2026

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const supabase = createClient()

    try {
      const { data: members, error: membersError } = await supabase
        .from("team_members")
        .select("id, full_name, email, avatar_url, role")
        .eq("is_active", true)
        .not("role", "eq", "Company")
        .not("role", "eq", "Alumni")
        .order("full_name")

      if (membersError) throw membersError
      setTeamMembers(members || [])

      const today = new Date()
      setCurrentYear(today.getFullYear())
      const friday = getFridayOfWeek(today)
      const fridayStr = friday.toISOString().split("T")[0]

      let { data: currentWeek } = await supabase
        .from("tommy_award_weeks")
        .select("*")
        .eq("week_date", fridayStr)
        .single()

      if (!currentWeek) {
        const { data: newWeek, error: createError } = await supabase
          .from("tommy_award_weeks")
          .insert({
            week_date: fridayStr,
            week_name: `Week of ${friday.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
            is_active: true,
          })
          .select()
          .single()

        if (createError) throw createError
        currentWeek = newWeek
      }

      setCurrentWeekId(currentWeek.id)
    } catch (err) {
      console.error("Error fetching data:", err)
      setError("Failed to load data. Please refresh the page.")
    } finally {
      setLoading(false)
    }
  }

  const getFridayOfWeek = (date: Date) => {
    const day = date.getDay()
    const diff = day <= 5 ? 5 - day : 5 - day + 7
    const friday = new Date(date)
    friday.setDate(date.getDate() + diff)
    return friday
  }

  const handleMemberSelect = (value: string, setter: React.Dispatch<React.SetStateAction<VoteSelection>>) => {
    const member = teamMembers.find((m) => m.id === value)
    setter((prev) => ({
      ...prev,
      memberId: value,
      memberName: member?.full_name || "",
    }))
  }

  const handleNotesChange = (notes: string, setter: React.Dispatch<React.SetStateAction<VoteSelection>>) => {
    setter((prev) => ({ ...prev, notes }))
  }

  const getSelectedMembers = () => {
    const selections = [firstPlace.memberId, secondPlace.memberId, thirdPlace.memberId]
    if (!is2026OrLater) {
      selections.push(honorableMention.memberId, partnerVote.memberId)
    }
    return selections.filter(Boolean)
  }

  const getAvailableMembers = (currentSelection: string | null) => {
    const selected = getSelectedMembers()
    return teamMembers.filter((m) => !selected.includes(m.id) || m.id === currentSelection)
  }

  const handleSubmit = async () => {
    if (!currentWeekId || !currentVoter) {
      setError("Please select your name before submitting")
      return
    }

    if (!firstPlace.memberId || !secondPlace.memberId || !thirdPlace.memberId) {
      setError("Please select at least 1st, 2nd, and 3rd place")
      return
    }

    setSubmitting(true)
    setError(null)

    const supabase = createClient()

    try {
      const voter = teamMembers.find((m) => m.id === currentVoter)
      const friday = getFridayOfWeek(new Date())

      const ballotData: Record<string, unknown> = {
        week_id: currentWeekId,
        week_date: friday.toISOString().split("T")[0],
        voter_id: currentVoter,
        voter_name: voter?.full_name || "Unknown",
        first_place_id: firstPlace.memberId,
        first_place_name: firstPlace.memberName,
        first_place_notes: firstPlace.notes,
        second_place_id: secondPlace.memberId,
        second_place_name: secondPlace.memberName,
        second_place_notes: secondPlace.notes,
        third_place_id: thirdPlace.memberId,
        third_place_name: thirdPlace.memberName,
        third_place_notes: thirdPlace.notes,
      }

      if (!is2026OrLater) {
        ballotData.honorable_mention_id = honorableMention.memberId
        ballotData.honorable_mention_name = honorableMention.memberName
        ballotData.honorable_mention_notes = honorableMention.notes
        ballotData.partner_vote_id = isPartner ? partnerVote.memberId : null
        ballotData.partner_vote_name = isPartner ? partnerVote.memberName : null
        ballotData.partner_vote_notes = isPartner ? partnerVote.notes : null
      } else {
        ballotData.honorable_mention_id = null
        ballotData.honorable_mention_name = null
        ballotData.honorable_mention_notes = null
        ballotData.partner_vote_id = null
        ballotData.partner_vote_name = null
        ballotData.partner_vote_notes = null
      }

      const { error: submitError } = await supabase.from("tommy_award_ballots").insert(ballotData)

      if (submitError) {
        if (submitError.code === "23505") {
          setError("You have already submitted a ballot this week")
        } else {
          throw submitError
        }
        return
      }

      setSubmitted(true)
    } catch (err) {
      console.error("Error submitting ballot:", err)
      setError("Failed to submit ballot. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        </CardContent>
      </Card>
    )
  }

  if (submitted) {
    return (
      <Card className="border-border bg-gradient-to-br from-[#0a1628] to-[#1a2744] text-white">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="w-20 h-20 rounded-full bg-[#c62828]/20 flex items-center justify-center mb-6 border-2 border-[#c62828]">
            <Trophy className="h-10 w-10 text-[#c62828]" />
          </div>
          <h3 className="text-2xl font-bold mb-2">Championship Ballot Submitted!</h3>
          <p className="text-slate-300 text-center max-w-md">
            Thank you for recognizing your teammates' championship-level performance. Your votes have been recorded for
            this week's Tommy Awards.
          </p>
          <Button
            variant="outline"
            className="mt-6 bg-transparent border-slate-600 text-white hover:bg-white/10"
            onClick={() => window.location.reload()}
          >
            Submit Another Ballot
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3 text-foreground">
          <div className="p-2 bg-[#c62828]/10 rounded-lg">
            <Send className="h-5 w-5 text-[#c62828]" />
          </div>
          Submit Your Tommy Award Ballot
        </CardTitle>
        <CardDescription>Recognize your teammates who demonstrated Tom Brady-like excellence this week</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {is2026OrLater && (
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800">
              <strong>2026 Scoring Update:</strong> The Tommy Awards now uses simplified scoring with 1st, 2nd, and 3rd
              place votes only. Honorable Mentions and Partner Votes have been retired.
            </AlertDescription>
          </Alert>
        )}

        <div className="p-4 rounded-xl bg-muted/50 border border-border">
          <Label className="flex items-center gap-2 mb-3 text-foreground font-medium">
            <Users className="h-4 w-4" />
            Your Name
          </Label>
          <Select value={currentVoter} onValueChange={setCurrentVoter}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Select your name" />
            </SelectTrigger>
            <SelectContent>
              {teamMembers.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <VoteCard
          icon={<Trophy className="h-5 w-5 text-amber-600" />}
          title="First Place"
          subtitle="3 Points"
          bgColor="bg-gradient-to-r from-amber-50 to-yellow-50"
          borderColor="border-amber-200"
          badgeColor="bg-amber-100 text-amber-700"
          members={getAvailableMembers(firstPlace.memberId)}
          selection={firstPlace}
          onMemberSelect={(v) => handleMemberSelect(v, setFirstPlace)}
          onNotesChange={(n) => handleNotesChange(n, setFirstPlace)}
        />

        <VoteCard
          icon={<Medal className="h-5 w-5 text-slate-500" />}
          title="Second Place"
          subtitle="2 Points"
          bgColor="bg-gradient-to-r from-slate-50 to-gray-50"
          borderColor="border-slate-200"
          badgeColor="bg-slate-100 text-slate-700"
          members={getAvailableMembers(secondPlace.memberId)}
          selection={secondPlace}
          onMemberSelect={(v) => handleMemberSelect(v, setSecondPlace)}
          onNotesChange={(n) => handleNotesChange(n, setSecondPlace)}
        />

        <VoteCard
          icon={<Award className="h-5 w-5 text-orange-600" />}
          title="Third Place"
          subtitle="1 Point"
          bgColor="bg-gradient-to-r from-orange-50 to-amber-50"
          borderColor="border-orange-200"
          badgeColor="bg-orange-100 text-orange-700"
          members={getAvailableMembers(thirdPlace.memberId)}
          selection={thirdPlace}
          onMemberSelect={(v) => handleMemberSelect(v, setThirdPlace)}
          onNotesChange={(n) => handleNotesChange(n, setThirdPlace)}
        />

        {!is2026OrLater && (
          <VoteCard
            icon={<Star className="h-5 w-5 text-blue-600" />}
            title="Honorable Mention"
            subtitle="0.5 Points"
            bgColor="bg-gradient-to-r from-blue-50 to-indigo-50"
            borderColor="border-blue-200"
            badgeColor="bg-blue-100 text-blue-700"
            members={getAvailableMembers(honorableMention.memberId)}
            selection={honorableMention}
            onMemberSelect={(v) => handleMemberSelect(v, setHonorableMention)}
            onNotesChange={(n) => handleNotesChange(n, setHonorableMention)}
            optional
          />
        )}

        {!is2026OrLater && (
          <>
            <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/30 border border-border">
              <input
                type="checkbox"
                id="isPartner"
                checked={isPartner}
                onChange={(e) => setIsPartner(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="isPartner" className="cursor-pointer text-muted-foreground">
                I am a Partner and want to award a Partner Vote (5 Points)
              </Label>
            </div>

            {isPartner && (
              <VoteCard
                icon={<Sparkles className="h-5 w-5 text-emerald-600" />}
                title="Partner Vote"
                subtitle="5 Points"
                bgColor="bg-gradient-to-r from-emerald-50 to-teal-50"
                borderColor="border-emerald-200"
                badgeColor="bg-emerald-100 text-emerald-700"
                members={getAvailableMembers(partnerVote.memberId)}
                selection={partnerVote}
                onMemberSelect={(v) => handleMemberSelect(v, setPartnerVote)}
                onNotesChange={(n) => handleNotesChange(n, setPartnerVote)}
              />
            )}
          </>
        )}

        <Button
          onClick={handleSubmit}
          disabled={submitting || !currentVoter || !firstPlace.memberId}
          className="w-full h-12 text-lg font-semibold bg-[#c62828] hover:bg-[#b71c1c] text-white"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              Submitting...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Submit Championship Ballot
            </span>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

interface VoteCardProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  bgColor: string
  borderColor: string
  badgeColor: string
  members: TeamMember[]
  selection: VoteSelection
  onMemberSelect: (value: string) => void
  onNotesChange: (notes: string) => void
  optional?: boolean
}

function VoteCard({
  icon,
  title,
  subtitle,
  bgColor,
  borderColor,
  badgeColor,
  members,
  selection,
  onMemberSelect,
  onNotesChange,
  optional,
}: VoteCardProps) {
  return (
    <div className={`p-4 rounded-xl ${bgColor} border ${borderColor}`}>
      <div className="flex items-center justify-between mb-3">
        <Label className="flex items-center gap-2 text-foreground font-medium">
          {icon}
          {title}
          {optional && <span className="text-xs text-muted-foreground">(Optional)</span>}
        </Label>
        <Badge className={badgeColor}>{subtitle}</Badge>
      </div>
      <Select value={selection.memberId || ""} onValueChange={onMemberSelect}>
        <SelectTrigger className="bg-white mb-3">
          <SelectValue placeholder={`Select teammate for ${title.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {members.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        placeholder={`Share why ${selection.memberName || "this teammate"} deserves this recognition...`}
        value={selection.notes}
        onChange={(e) => onNotesChange(e.target.value)}
        className="bg-white min-h-[80px] resize-none"
      />
    </div>
  )
}
