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
import { Trophy, Medal, Award, Star, Sparkles, Send, Users, Info, Calendar, Edit3, History, Clock } from "lucide-react"
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

interface WeekOption {
  id: string
  week_date: string
  week_name: string
  is_active: boolean
}

interface BallotSnapshot {
  first_place_id: string | null
  first_place_name: string
  first_place_notes: string
  second_place_id: string | null
  second_place_name: string
  second_place_notes: string
  third_place_id: string | null
  third_place_name: string
  third_place_notes: string
  honorable_mention_id: string | null
  honorable_mention_name: string
  honorable_mention_notes: string
  partner_vote_id: string | null
  partner_vote_name: string
  partner_vote_notes: string
}

interface BallotHistoryEntry {
  id: string
  change_type: string
  changed_at: string
  changed_by_name: string
  change_summary: {
    changes: Array<{
      field: string
      from: string
      to: string
    }>
  } | null
}

export function TommyVotingForm() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [availableWeeks, setAvailableWeeks] = useState<WeekOption[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null)
  const [selectedWeekDate, setSelectedWeekDate] = useState<string | null>(null)
  const [currentVoter, setCurrentVoter] = useState<string>("")
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear())
  const [isAmendment, setIsAmendment] = useState(false)
  const [existingBallotId, setExistingBallotId] = useState<string | null>(null)
  const [originalBallot, setOriginalBallot] = useState<BallotSnapshot | null>(null)
  const [ballotHistory, setBallotHistory] = useState<BallotHistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

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

  // When voter or week changes, check for existing ballot
  useEffect(() => {
    if (currentVoter && selectedWeekId) {
      checkExistingBallot()
    }
  }, [currentVoter, selectedWeekId])

  const fetchData = async () => {
    const supabase = createClient()

    try {
      // Hidden from Tommy Awards: Grace Cha, Beth Nietupski
      // Ganesh Vasan and Thameem JA vote together as "G&T"
      const HIDDEN_MEMBERS = ["Grace Cha", "Beth Nietupski"]
      const COMBINED_VOTERS = ["Ganesh Vasan", "Thameem JA"]
      
      const { data: members, error: membersError } = await supabase
        .from("team_members")
        .select("id, full_name, email, avatar_url, role")
        .eq("is_active", true)
        .not("role", "eq", "Company")
        .not("role", "eq", "Alumni")
        .order("full_name")

      if (membersError) throw membersError
      
      // Filter out hidden members and the combined voters (they'll be replaced by G&T)
      const filteredMembers = (members || []).filter(
        (m: { full_name: string }) => 
          !HIDDEN_MEMBERS.includes(m.full_name) && 
          !COMBINED_VOTERS.includes(m.full_name)
      )
      
      // Add the combined "G&T" voter entry (uses a special composite ID)
      const gtVoter: TeamMember = {
        id: "G&T",
        full_name: "G&T",
        email: "",
        avatar_url: null,
        role: "Combined Voter",
      }
      
      // Insert G&T in alphabetical position
      const membersWithGT = [...filteredMembers, gtVoter].sort((a, b) => 
        a.full_name.localeCompare(b.full_name)
      )
      
      setTeamMembers(membersWithGT)

      const today = new Date()
      setCurrentYear(today.getFullYear())
      const friday = getFridayOfWeek(today)
      // Format as YYYY-MM-DD in LOCAL time to avoid timezone shifts
      // (toISOString() converts to UTC which can shift Friday → Saturday for negative offsets)
      const fridayStr = formatLocalDate(friday)

      // Fetch ALL weeks for the dropdown - no time restrictions on submitting/editing ballots
      const { data: weeks, error: weeksError } = await supabase
        .from("tommy_award_weeks")
        .select("id, week_date, week_name, is_active")
        .order("week_date", { ascending: false })

      if (weeksError) throw weeksError

      // Deduplicate weeks by week_name (in case the database still has any duplicates)
      // Prefer entries whose week_date falls on a Friday
      const dedupedWeeks = dedupeWeekList(weeks || [])

      // Ensure current week exists
      let currentWeek: WeekOption | null = dedupedWeeks.find((w) => w.week_date === fridayStr) ?? null
      
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
        currentWeek = newWeek as WeekOption
        // Add to weeks list
        if (currentWeek) {
          setAvailableWeeks([currentWeek, ...dedupedWeeks])
        }
      } else {
        setAvailableWeeks(dedupedWeeks)
      }

      // Default to current week
      if (currentWeek) {
        setSelectedWeekId(currentWeek.id)
        setSelectedWeekDate(currentWeek.week_date)
      }
    } catch (err) {
      console.error("Error fetching data:", err)
      setError("Failed to load data. Please refresh the page.")
    } finally {
      setLoading(false)
    }
  }

  const checkExistingBallot = async () => {
    if (!currentVoter || !selectedWeekId) return

    const supabase = createClient()
    
    try {
      // For the combined "G&T" voter, look up ballots by voter_name instead of voter_id
      // since G&T isn't a real team_member row
      let existingBallot = null
      let error = null
      
      if (currentVoter === "G&T") {
        const result = await supabase
          .from("tommy_award_ballots")
          .select("*")
          .eq("voter_name", "G&T")
          .eq("week_id", selectedWeekId)
          .single()
        existingBallot = result.data
        error = result.error
      } else {
        const result = await supabase
          .from("tommy_award_ballots")
          .select("*")
          .eq("voter_id", currentVoter)
          .eq("week_id", selectedWeekId)
          .single()
        existingBallot = result.data
        error = result.error
      }

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned, which is fine
        console.error("Error checking existing ballot:", error)
        return
      }

      if (existingBallot) {
        // Pre-fill the form with existing ballot data
        setIsAmendment(true)
        setExistingBallotId(existingBallot.id)
        
        // Store original ballot for comparison when submitting amendment
        const snapshot: BallotSnapshot = {
          first_place_id: existingBallot.first_place_id,
          first_place_name: existingBallot.first_place_name || "",
          first_place_notes: existingBallot.first_place_notes || "",
          second_place_id: existingBallot.second_place_id,
          second_place_name: existingBallot.second_place_name || "",
          second_place_notes: existingBallot.second_place_notes || "",
          third_place_id: existingBallot.third_place_id,
          third_place_name: existingBallot.third_place_name || "",
          third_place_notes: existingBallot.third_place_notes || "",
          honorable_mention_id: existingBallot.honorable_mention_id,
          honorable_mention_name: existingBallot.honorable_mention_name || "",
          honorable_mention_notes: existingBallot.honorable_mention_notes || "",
          partner_vote_id: existingBallot.partner_vote_id,
          partner_vote_name: existingBallot.partner_vote_name || "",
          partner_vote_notes: existingBallot.partner_vote_notes || "",
        }
        setOriginalBallot(snapshot)
        
        setFirstPlace({
          memberId: existingBallot.first_place_id,
          memberName: existingBallot.first_place_name || "",
          notes: existingBallot.first_place_notes || "",
        })
        setSecondPlace({
          memberId: existingBallot.second_place_id,
          memberName: existingBallot.second_place_name || "",
          notes: existingBallot.second_place_notes || "",
        })
        setThirdPlace({
          memberId: existingBallot.third_place_id,
          memberName: existingBallot.third_place_name || "",
          notes: existingBallot.third_place_notes || "",
        })
        setHonorableMention({
          memberId: existingBallot.honorable_mention_id,
          memberName: existingBallot.honorable_mention_name || "",
          notes: existingBallot.honorable_mention_notes || "",
        })
        if (existingBallot.partner_vote_id) {
          setIsPartner(true)
          setPartnerVote({
            memberId: existingBallot.partner_vote_id,
            memberName: existingBallot.partner_vote_name || "",
            notes: existingBallot.partner_vote_notes || "",
          })
        }
        
        // Fetch ballot history
        await fetchBallotHistory(existingBallot.id)
      } else {
        // Reset form for new ballot
        setIsAmendment(false)
        setExistingBallotId(null)
        setOriginalBallot(null)
        setBallotHistory([])
        resetForm()
      }
    } catch (err) {
      console.error("Error checking existing ballot:", err)
    }
  }

  const fetchBallotHistory = async (ballotId: string) => {
    const supabase = createClient()
    
    try {
      const { data, error } = await supabase
        .from("tommy_award_ballot_history")
        .select("id, change_type, changed_at, changed_by_name, change_summary")
        .eq("ballot_id", ballotId)
        .order("changed_at", { ascending: false })

      if (error) {
        // Table might not exist yet - gracefully handle
        if (error.code !== "42P01" && !error.message.includes("does not exist")) {
          console.error("Error fetching ballot history:", error)
        }
        setBallotHistory([])
        return
      }

      setBallotHistory(data || [])
    } catch (err) {
      console.error("Error fetching ballot history:", err)
      setBallotHistory([])
    }
  }

  const calculateChanges = (): Array<{ field: string; from: string; to: string }> => {
    if (!originalBallot) return []
    
    const changes: Array<{ field: string; from: string; to: string }> = []
    
    if (originalBallot.first_place_name !== firstPlace.memberName) {
      changes.push({ field: "1st Place", from: originalBallot.first_place_name || "(none)", to: firstPlace.memberName || "(none)" })
    }
    if (originalBallot.second_place_name !== secondPlace.memberName) {
      changes.push({ field: "2nd Place", from: originalBallot.second_place_name || "(none)", to: secondPlace.memberName || "(none)" })
    }
    if (originalBallot.third_place_name !== thirdPlace.memberName) {
      changes.push({ field: "3rd Place", from: originalBallot.third_place_name || "(none)", to: thirdPlace.memberName || "(none)" })
    }
    if (!is2026OrLater) {
      if (originalBallot.honorable_mention_name !== honorableMention.memberName) {
        changes.push({ field: "Honorable Mention", from: originalBallot.honorable_mention_name || "(none)", to: honorableMention.memberName || "(none)" })
      }
      const originalPartner = originalBallot.partner_vote_name || ""
      const newPartner = isPartner ? partnerVote.memberName : ""
      if (originalPartner !== newPartner) {
        changes.push({ field: "Partner Vote", from: originalPartner || "(none)", to: newPartner || "(none)" })
      }
    }
    
    return changes
  }

  const resetForm = () => {
    setFirstPlace({ memberId: null, memberName: "", notes: "" })
    setSecondPlace({ memberId: null, memberName: "", notes: "" })
    setThirdPlace({ memberId: null, memberName: "", notes: "" })
    setHonorableMention({ memberId: null, memberName: "", notes: "" })
    setPartnerVote({ memberId: null, memberName: "", notes: "" })
    setIsPartner(false)
  }

  const handleWeekChange = (weekId: string) => {
    const week = availableWeeks.find((w) => w.id === weekId)
    setSelectedWeekId(weekId)
    setSelectedWeekDate(week?.week_date || null)
    // Update the year based on selected week (affects 2026+ rule for honorable mentions/partner votes)
    if (week?.week_date) {
      const yearFromWeek = parseInt(week.week_date.split("-")[0], 10)
      setCurrentYear(yearFromWeek)
    }
  }

  const getFridayOfWeek = (date: Date) => {
    const day = date.getDay()
    const diff = day <= 5 ? 5 - day : 5 - day + 7
    const friday = new Date(date)
    friday.setDate(date.getDate() + diff)
    return friday
  }

  // Format a date as YYYY-MM-DD in local time (avoids UTC timezone shifts)
  const formatLocalDate = (date: Date) => {
    const yyyy = date.getFullYear()
    const mm = String(date.getMonth() + 1).padStart(2, "0")
    const dd = String(date.getDate()).padStart(2, "0")
    return `${yyyy}-${mm}-${dd}`
  }

  // Remove duplicate weeks (same week_name), preferring Friday-dated entries
  const dedupeWeekList = (weeks: WeekOption[]): WeekOption[] => {
    const groups: Record<string, WeekOption[]> = {}
    for (const w of weeks) {
      if (!groups[w.week_name]) groups[w.week_name] = []
      groups[w.week_name].push(w)
    }
    
    const result: WeekOption[] = []
    for (const items of Object.values(groups)) {
      if (items.length === 1) {
        result.push(items[0])
        continue
      }
      // Prefer Friday-dated week (parse as local date to check day-of-week)
      const friday = items.find((it) => {
        const [y, m, d] = it.week_date.split("-").map(Number)
        const localDate = new Date(y, m - 1, d)
        return localDate.getDay() === 5
      })
      // Prefer active over inactive as tiebreaker
      const active = items.find((it) => it.is_active)
      result.push(friday || active || items[0])
    }
    
    // Sort by week_date descending
    result.sort((a, b) => b.week_date.localeCompare(a.week_date))
    return result
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
    if (!selectedWeekId || !currentVoter) {
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
      
      // For the combined "G&T" voter, voter_id must be NULL because the column is
      // a uuid with FK to team_members - we identify them by voter_name="G&T" instead.
      const isGT = currentVoter === "G&T"
      const voterId = isGT ? null : currentVoter
      const voterName = isGT ? "G&T" : (voter?.full_name || "Unknown")

      // Helper: when "G&T" is picked as a placement winner, the *_place_id columns
      // are uuid with FK to team_members and cannot store the literal "G&T".
      // Store NULL for the id and rely on *_place_name="G&T" for aggregations.
      const idForPlacement = (memberId: string) => (memberId === "G&T" ? null : memberId || null)

      const ballotData: Record<string, unknown> = {
        week_id: selectedWeekId,
        week_date: selectedWeekDate,
        voter_id: voterId,
        voter_name: voterName,
        first_place_id: idForPlacement(firstPlace.memberId),
        first_place_name: firstPlace.memberName,
        first_place_notes: firstPlace.notes,
        second_place_id: idForPlacement(secondPlace.memberId),
        second_place_name: secondPlace.memberName,
        second_place_notes: secondPlace.notes,
        third_place_id: idForPlacement(thirdPlace.memberId),
        third_place_name: thirdPlace.memberName,
        third_place_notes: thirdPlace.notes,
      }

      if (!is2026OrLater) {
        ballotData.honorable_mention_id = idForPlacement(honorableMention.memberId)
        ballotData.honorable_mention_name = honorableMention.memberName
        ballotData.honorable_mention_notes = honorableMention.notes
        ballotData.partner_vote_id = isPartner ? idForPlacement(partnerVote.memberId) : null
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

      let submitError
      let newBallotId: string | null = null

      if (isAmendment && existingBallotId) {
        // Calculate what changed for the audit trail
        const changes = calculateChanges()
        
        // Record the PREVIOUS state in history before updating
        if (originalBallot && changes.length > 0) {
          try {
            await supabase.from("tommy_award_ballot_history").insert({
              ballot_id: existingBallotId,
              changed_by_id: isGT ? null : currentVoter,
              changed_by_name: voterName,
              change_type: "amended",
              first_place_id: originalBallot.first_place_id,
              first_place_name: originalBallot.first_place_name,
              first_place_notes: originalBallot.first_place_notes,
              second_place_id: originalBallot.second_place_id,
              second_place_name: originalBallot.second_place_name,
              second_place_notes: originalBallot.second_place_notes,
              third_place_id: originalBallot.third_place_id,
              third_place_name: originalBallot.third_place_name,
              third_place_notes: originalBallot.third_place_notes,
              honorable_mention_id: originalBallot.honorable_mention_id,
              honorable_mention_name: originalBallot.honorable_mention_name,
              honorable_mention_notes: originalBallot.honorable_mention_notes,
              partner_vote_id: originalBallot.partner_vote_id,
              partner_vote_name: originalBallot.partner_vote_name,
              partner_vote_notes: originalBallot.partner_vote_notes,
              change_summary: { changes },
            })
          } catch (historyErr) {
            // History table might not exist yet - continue anyway
            console.log("Audit history not recorded (table may not exist)")
          }
        }

        // Update existing ballot
        const { error } = await supabase
          .from("tommy_award_ballots")
          .update(ballotData)
          .eq("id", existingBallotId)
        submitError = error
      } else {
        // Insert new ballot
        const { data: newBallot, error } = await supabase
          .from("tommy_award_ballots")
          .insert(ballotData)
          .select("id")
          .single()
        submitError = error
        newBallotId = newBallot?.id || null

        // Record initial creation in history
        if (newBallotId) {
          try {
            await supabase.from("tommy_award_ballot_history").insert({
              ballot_id: newBallotId,
              changed_by_id: isGT ? null : currentVoter,
              changed_by_name: voterName,
              change_type: "created",
              first_place_id: idForPlacement(firstPlace.memberId),
              first_place_name: firstPlace.memberName,
              first_place_notes: firstPlace.notes,
              second_place_id: idForPlacement(secondPlace.memberId),
              second_place_name: secondPlace.memberName,
              second_place_notes: secondPlace.notes,
              third_place_id: idForPlacement(thirdPlace.memberId),
              third_place_name: thirdPlace.memberName,
              third_place_notes: thirdPlace.notes,
              honorable_mention_id: !is2026OrLater ? idForPlacement(honorableMention.memberId) : null,
              honorable_mention_name: !is2026OrLater ? honorableMention.memberName : null,
              honorable_mention_notes: !is2026OrLater ? honorableMention.notes : null,
              partner_vote_id: !is2026OrLater && isPartner ? idForPlacement(partnerVote.memberId) : null,
              partner_vote_name: !is2026OrLater && isPartner ? partnerVote.memberName : null,
              partner_vote_notes: !is2026OrLater && isPartner ? partnerVote.notes : null,
              change_summary: null,
            })
          } catch (historyErr) {
            // History table might not exist yet - continue anyway
            console.log("Audit history not recorded (table may not exist)")
          }
        }
      }

      if (submitError) {
        console.log("[v0] Submit error code:", submitError.code, "message:", submitError.message, "details:", submitError.details, "hint:", submitError.hint)
        if (submitError.code === "23505") {
          setError("You have already submitted a ballot for this week. Select your name again to load it for amendment.")
        } else {
          throw submitError
        }
        return
      }

      setSubmitted(true)
    } catch (err) {
      console.error("[v0] Error submitting ballot:", err)
      // Surface the real error message to help with debugging
      const errorMessage = err instanceof Error 
        ? err.message 
        : (typeof err === "object" && err !== null && "message" in err)
          ? String((err as { message: unknown }).message)
          : "Unknown error"
      setError(`Failed to submit ballot: ${errorMessage}`)
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
            {isAmendment ? <Edit3 className="h-10 w-10 text-[#c62828]" /> : <Trophy className="h-10 w-10 text-[#c62828]" />}
          </div>
          <h3 className="text-2xl font-bold mb-2">
            {isAmendment ? "Ballot Updated!" : "Championship Ballot Submitted!"}
          </h3>
          <p className="text-slate-300 text-center max-w-md">
            {isAmendment 
              ? "Your ballot has been successfully amended. The leaderboard will reflect your updated votes."
              : "Thank you for recognizing your teammates' championship-level performance. Your votes have been recorded for this week's Tommy Awards."
            }
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

        <div className="grid gap-4 md:grid-cols-2">
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

          <div className="p-4 rounded-xl bg-muted/50 border border-border">
            <Label className="flex items-center gap-2 mb-3 text-foreground font-medium">
              <Calendar className="h-4 w-4" />
              Week
            </Label>
            <Select value={selectedWeekId || ""} onValueChange={handleWeekChange}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select week" />
              </SelectTrigger>
              <SelectContent>
                {availableWeeks.map((week) => (
                  <SelectItem key={week.id} value={week.id}>
                    {week.week_name}
                    {week.is_active && " (Current)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isAmendment && (
          <Alert className="bg-amber-50 border-amber-200">
            <Edit3 className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              <div className="flex items-center justify-between">
                <div>
                  <strong>Amending Previous Ballot:</strong> You already submitted a ballot for this week. 
                  Your changes will update your existing vote.
                </div>
                {ballotHistory.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(!showHistory)}
                    className="ml-2 text-amber-700 hover:text-amber-900 hover:bg-amber-100"
                  >
                    <History className="h-4 w-4 mr-1" />
                    {showHistory ? "Hide" : "View"} History ({ballotHistory.length})
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {isAmendment && showHistory && ballotHistory.length > 0 && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <h4 className="font-semibold text-slate-700 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Ballot Change History
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {ballotHistory.map((entry) => (
                <div key={entry.id} className="p-3 bg-white rounded-lg border border-slate-100 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      entry.change_type === "created" 
                        ? "bg-green-100 text-green-700" 
                        : "bg-blue-100 text-blue-700"
                    }`}>
                      {entry.change_type === "created" ? "Original Submission" : "Amendment"}
                    </span>
                    <span className="text-slate-500 text-xs">
                      {new Date(entry.changed_at).toLocaleString()}
                    </span>
                  </div>
                  {entry.change_type === "amended" && entry.change_summary?.changes && (
                    <div className="space-y-1">
                      {entry.change_summary.changes.map((change, idx) => (
                        <div key={idx} className="text-slate-600">
                          <span className="font-medium">{change.field}:</span>{" "}
                          <span className="text-red-600 line-through">{change.from}</span>
                          {" ��� "}
                          <span className="text-green-600">{change.to}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {entry.change_type === "created" && (
                    <div className="text-slate-500 text-xs">
                      Initial ballot submitted by {entry.changed_by_name}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isAmendment && originalBallot && (
          <PendingChangesPreview
            originalBallot={originalBallot}
            currentBallot={{
              firstPlace,
              secondPlace,
              thirdPlace,
              honorableMention: !is2026OrLater ? honorableMention : { memberId: null, memberName: "", notes: "" },
              partnerVote: !is2026OrLater && isPartner ? partnerVote : { memberId: null, memberName: "", notes: "" },
            }}
            is2026OrLater={is2026OrLater}
          />
        )}

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
          disabled={submitting || !currentVoter || !firstPlace.memberId || !selectedWeekId}
          className="w-full h-12 text-lg font-semibold bg-[#c62828] hover:bg-[#b71c1c] text-white"
        >
          {submitting ? (
            <span className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              {isAmendment ? "Updating..." : "Submitting..."}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              {isAmendment ? <Edit3 className="h-5 w-5" /> : <Trophy className="h-5 w-5" />}
              {isAmendment ? "Update Ballot" : "Submit Championship Ballot"}
            </span>
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// Component to show pending changes before submitting an amendment
function PendingChangesPreview({
  originalBallot,
  currentBallot,
  is2026OrLater,
}: {
  originalBallot: BallotSnapshot
  currentBallot: {
    firstPlace: VoteSelection
    secondPlace: VoteSelection
    thirdPlace: VoteSelection
    honorableMention: VoteSelection
    partnerVote: VoteSelection
  }
  is2026OrLater: boolean
}) {
  const changes: Array<{ field: string; from: string; to: string }> = []

  if (originalBallot.first_place_name !== currentBallot.firstPlace.memberName) {
    changes.push({ field: "1st Place", from: originalBallot.first_place_name || "(none)", to: currentBallot.firstPlace.memberName || "(none)" })
  }
  if (originalBallot.second_place_name !== currentBallot.secondPlace.memberName) {
    changes.push({ field: "2nd Place", from: originalBallot.second_place_name || "(none)", to: currentBallot.secondPlace.memberName || "(none)" })
  }
  if (originalBallot.third_place_name !== currentBallot.thirdPlace.memberName) {
    changes.push({ field: "3rd Place", from: originalBallot.third_place_name || "(none)", to: currentBallot.thirdPlace.memberName || "(none)" })
  }
  if (!is2026OrLater) {
    if (originalBallot.honorable_mention_name !== currentBallot.honorableMention.memberName) {
      changes.push({ field: "Honorable Mention", from: originalBallot.honorable_mention_name || "(none)", to: currentBallot.honorableMention.memberName || "(none)" })
    }
    if (originalBallot.partner_vote_name !== currentBallot.partnerVote.memberName) {
      changes.push({ field: "Partner Vote", from: originalBallot.partner_vote_name || "(none)", to: currentBallot.partnerVote.memberName || "(none)" })
    }
  }

  if (changes.length === 0) {
    return null
  }

  return (
    <div className="p-4 rounded-xl bg-blue-50 border border-blue-200">
      <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
        <Edit3 className="h-4 w-4" />
        Pending Changes
      </h4>
      <p className="text-sm text-blue-600 mb-3">
        The following changes will be recorded when you submit:
      </p>
      <div className="space-y-1">
        {changes.map((change, idx) => (
          <div key={idx} className="text-sm bg-white/50 rounded px-2 py-1">
            <span className="font-medium text-blue-800">{change.field}:</span>{" "}
            <span className="text-red-600 line-through">{change.from}</span>
            {" → "}
            <span className="text-green-600 font-medium">{change.to}</span>
          </div>
        ))}
      </div>
    </div>
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
