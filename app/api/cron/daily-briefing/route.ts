import { NextResponse } from "next/server"
import { generateText } from "ai"
import { createAdminClient } from "@/lib/supabase/server"
import { buildDailyBriefingHtml, sendCategoryEmail } from "@/lib/email"
import { fetchNewsCategory, type NewsItem } from "@/lib/news-feed"
import { getRemindersForRange } from "@/lib/team-reminders"

/**
 * ALFRED Ai's weekday morning briefing.
 *
 * Schedule (vercel.json): `0 12 * * 1-5` = 12:00 UTC Mon-Fri, which lands at:
 *   - 7:00 AM EST (winter)
 *   - 8:00 AM EDT (summer)
 *
 * Vercel Cron is timezone-naive, so we sit one hour later in summer rather
 * than splitting into two schedules — partners read this with their morning
 * coffee, not at a precise minute.
 *
 * Sections emitted, in order:
 *   1. Witty butler exec summary (AI-generated, gracefully degraded on failure)
 *   2. Yesterday's debriefs (firm-wide, with hub deep-links)
 *   3. Upcoming client meetings for the next 7 days (Calendly + Zoom)
 *   4. Team reminders (holidays, tax deadlines, Tommy Awards Thursdays)
 *   5. Topical news (markets + tax/IRS) from Google News RSS
 *
 * Authoring identity is the firm's RESEND_FROM_EMAIL — already set to
 * "ALFRED Ai <Info@mottafinancial.com>" — so no per-route override needed.
 *
 * Auth: standard Vercel cron `Authorization: Bearer ${CRON_SECRET}` header.
 * Manual preview: pass `?previewTo=email@example.com` (auth still required
 * in production) to send the briefing to a single recipient for testing.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.CRON_SECRET && process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const url = new URL(request.url)
    const previewTo = url.searchParams.get("previewTo")
    const supabase = createAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://motta.cpa"
    const hubUrl = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`

    /* ──────────────────────────────────────────────────────────────────
     * Time windows
     *
     * "Yesterday" is the previous Eastern-Time calendar day so the
     * morning email mirrors how the team actually thinks about it. The
     * upcoming-meeting window is rolling 7 days from now to match the
     * meeting digest we already send weekly.
     * ────────────────────────────────────────────────────────────────── */
    const now = new Date()
    const easternTodayKey = ymdInTz(now, "America/New_York")
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const easternYesterdayKey = ymdInTz(yesterday, "America/New_York")

    // Debrief range: yesterday 00:00 → today 00:00 in Eastern (converted to UTC).
    const yesterdayStart = new Date(`${easternYesterdayKey}T00:00:00-05:00`)
    const yesterdayEnd = new Date(`${easternTodayKey}T00:00:00-05:00`)

    // Upcoming meetings: now → +7 days.
    const upcomingEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const dateLabel = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    })
    const weekRangeLabel = `${now.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    })} - ${upcomingEnd.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    })}`

    /* ──────────────────────────────────────────────────────────────────
     * Fan out the four data fetches in parallel — none depend on each
     * other and the briefing is bottlenecked on whichever takes longest.
     * ────────────────────────────────────────────────────────────────── */
    const [
      debriefsResult,
      calendlyResult,
      zoomResult,
      marketNewsResult,
      taxNewsResult,
      hubUpdatesResult,
      intakeFormsResult,
      feedbackResult,
      acceptedProposalsResult,
    ] = await Promise.allSettled([
      supabase
        .from("debriefs")
        .select(
          "id, debrief_date, organization_name, contact_id, work_item_id, created_by_id, created_at, action_items, karbon_client_key",
        )
        .gte("created_at", yesterdayStart.toISOString())
        .lt("created_at", yesterdayEnd.toISOString())
        .order("created_at", { ascending: true }),
      supabase
        .from("calendly_events")
        .select(
          "team_member_id, name, start_time, status, calendly_uri, location",
        )
        .gte("start_time", now.toISOString())
        .lte("start_time", upcomingEnd.toISOString())
        .neq("status", "canceled")
        .order("start_time", { ascending: true })
        .limit(40),
      supabase
        .from("zoom_meetings")
        .select("team_member_id, topic, start_time, join_url, status")
        .gte("start_time", now.toISOString())
        .lte("start_time", upcomingEnd.toISOString())
        .order("start_time", { ascending: true })
        .limit(40),
      fetchNewsCategory("market", 4),
      fetchNewsCategory("tax", 4),
      fetchHubUpdates(yesterdayStart, yesterdayEnd),
      // New intake form submissions from yesterday
      supabase
        .from("jotform_intake_submissions")
        .select("id, submitter_full_name, business_name, services_requested, created_at")
        .gte("created_at", yesterdayStart.toISOString())
        .lt("created_at", yesterdayEnd.toISOString())
        .order("created_at", { ascending: true }),
      // New feedback submissions from yesterday
      supabase
        .from("jotform_feedback_submissions")
        .select("id, submitter_full_name, rating_overall, rating_service_quality, feedback_comments, created_at")
        .gte("created_at", yesterdayStart.toISOString())
        .lt("created_at", yesterdayEnd.toISOString())
        .order("created_at", { ascending: true }),
      // Proposals accepted yesterday
      supabase
        .from("ignition_proposals")
        .select("proposal_id, title, client_name, total_value, accepted_at")
        .gte("accepted_at", yesterdayStart.toISOString())
        .lt("accepted_at", yesterdayEnd.toISOString())
        .eq("status", "accepted")
        .order("accepted_at", { ascending: true }),
    ])

    const debriefs = unwrapData(debriefsResult, "debriefs") as DebriefRow[]
    const calendlyEvents = unwrapData(
      calendlyResult,
      "calendly_events",
    ) as CalendlyEventRow[]
    const zoomMeetings = unwrapData(zoomResult, "zoom_meetings") as ZoomMeetingRow[]
    const marketNews = unwrapNews(marketNewsResult)
    const taxNews = unwrapNews(taxNewsResult)
    const hubUpdates = unwrapHubUpdates(hubUpdatesResult)
    const intakeForms = unwrapData(intakeFormsResult, "jotform_intake_submissions") as IntakeFormRow[]
    const feedbackSubmissions = unwrapData(feedbackResult, "jotform_feedback_submissions") as FeedbackRow[]
    const acceptedProposals = unwrapData(acceptedProposalsResult, "ignition_proposals") as AcceptedProposalRow[]

    /* ──────────────────────────────────────────────────────────────────
     * Resolve human-readable names. Debriefs only carry IDs, so we
     * batch-lookup the related team members and contacts up front.
     * ────────────────────────────────────────────────────────────────── */
    const teamMemberIds = new Set<string>()
    const contactIds = new Set<string>()
    for (const d of debriefs) {
      if (d.created_by_id) teamMemberIds.add(d.created_by_id)
      if (d.contact_id) contactIds.add(d.contact_id)
    }
    for (const e of calendlyEvents) {
      if (e.team_member_id) teamMemberIds.add(e.team_member_id)
    }
    for (const m of zoomMeetings) {
      if (m.team_member_id) teamMemberIds.add(m.team_member_id)
    }

    const [{ data: members }, { data: contacts }] = await Promise.all([
      teamMemberIds.size > 0
        ? supabase
            .from("team_members")
            .select("id, full_name")
            .in("id", Array.from(teamMemberIds))
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
      contactIds.size > 0
        ? supabase
            .from("contacts")
            .select("id, full_name")
            .in("id", Array.from(contactIds))
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }> }),
    ])

    const memberName = new Map<string, string>()
    for (const m of members || []) memberName.set(m.id, m.full_name)
    const contactName = new Map<string, string>()
    for (const c of contacts || []) contactName.set(c.id, c.full_name)

    /* ──────────────────────────────────────────────────────────────────
     * Shape the data into what the email builder expects.
     * ────────────────────────────────────────────────────────────────── */
    const yesterdayDebriefs = debriefs.map((d) => {
      const clientName =
        d.organization_name ||
        (d.contact_id ? contactName.get(d.contact_id) : null) ||
        "Client"
      const authorName = d.created_by_id
        ? memberName.get(d.created_by_id) || "A team member"
        : "A team member"
      const teamMemberName = d.action_items?.team_member_name
      return {
        clientName,
        authorName: teamMemberName || authorName,
        workItemTitle:
          d.action_items?.related_work_items?.[0]?.title || null,
        debriefDate: formatDateOnly(d.debrief_date),
        url: `${hubUrl}/?tab=debriefs&id=${d.id}`,
      }
    })

    const upcomingMeetings = [
      ...calendlyEvents.map((e) => ({
        when: formatMeetingWhen(e.start_time),
        title: e.name || "Calendly Event",
        hostName: e.team_member_id ? memberName.get(e.team_member_id) : undefined,
        source: "Calendly",
        url: e.calendly_uri || undefined,
      })),
      ...zoomMeetings.map((m) => ({
        when: formatMeetingWhen(m.start_time),
        title: m.topic || "Zoom Meeting",
        hostName: m.team_member_id ? memberName.get(m.team_member_id) : undefined,
        source: "Zoom",
        url: m.join_url || undefined,
      })),
    ]
      .sort((a, b) => a.when.localeCompare(b.when))
      // Cap at 12 to keep the email digestible — the Hub has the full list.
      .slice(0, 12)

    const teamReminders = getRemindersForRange(now, upcomingEnd)

    /* ──────────────────────────────────────────────────────────────────
     * AI-generated butler exec summary. Falls back to deterministic
     * copy on failure — the briefing must ship even if the model is
     * having a bad morning.
     * ────────────────────────────────────────────────────────────────── */
    const executiveSummary = await composeButlerSummary({
      dateLabel,
      debriefCount: yesterdayDebriefs.length,
      meetingCount: upcomingMeetings.length,
      reminderCount: teamReminders.length,
      topReminder: teamReminders[0]?.label,
      topMarketHeadline: marketNews[0]?.title,
      topTaxHeadline: taxNews[0]?.title,
    })

    const signOff = pickSignOff()

    /* ──────────────────────────────────────────────────────────────────
     * Recipients. Send to all active, opt-ed-in team members. Preview
     * mode (`?previewTo=`) overrides the recipient list to a single
     * email for spot-checking.
     * ────────────────────────────────────────────────────────────────── */
    const { data: allMembers, error: membersErr } = await supabase
      .from("team_members")
      .select("id, full_name, email, is_active, role")
      .eq("is_active", true)
      .not("role", "eq", "Company")
      .not("role", "eq", "Alumni")
    if (membersErr) throw membersErr

    let eligible = (allMembers || []).filter((m) => m.email)
    if (previewTo) {
      eligible = eligible.filter(
        (m) => m.email?.toLowerCase() === previewTo.toLowerCase(),
      )
    }
    if (eligible.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        skipped: 0,
        message: previewTo
          ? `No active team member matched previewTo=${previewTo}`
          : "No eligible recipients",
      })
    }

    /* ──────────────────────────────────────────────────────────────────
     * Send one personalized email per recipient (for the greeting).
     * Respects each user's `daily_briefing` opt-out via sendCategoryEmail.
     * ────────────────────────────────────────────────────────────────── */
    // Shape business metrics for the appendix (same for all recipients)
    const newIntakeForms = intakeForms.map((i) => ({
      name: i.submitter_full_name || "Unknown",
      businessName: i.business_name,
      services: i.services_requested || [],
      url: `${hubUrl}/intake?id=${i.id}`,
    }))
    const newFeedback = feedbackSubmissions.map((f) => ({
      name: f.submitter_full_name || "A client",
      rating: f.rating_overall || f.rating_service_quality,
      comment: f.feedback_comments,
      url: `${hubUrl}/feedback?id=${f.id}`,
    }))
    const newProposalsAccepted = acceptedProposals.map((p) => ({
      clientName: p.client_name || "Client",
      title: p.title,
      value: p.total_value,
      url: `${hubUrl}/sales/proposals?id=${p.proposal_id}`,
    }))
    const proposalsTotalValue = acceptedProposals.reduce(
      (sum, p) => sum + (p.total_value || 0),
      0,
    )

    let totalSent = 0
    let totalSkipped = 0
    await Promise.all(
      eligible.map(async (m) => {
        const html = buildDailyBriefingHtml({
  recipientName: m.full_name?.split(" ")[0] || "there",
  dateLabel,
  weekRangeLabel,
  executiveSummary,
  yesterdayDebriefs,
  upcomingMeetings,
  teamReminders,
  marketNews,
  taxNews,
  hubUpdates,
  newIntakeForms,
  newFeedback,
  newProposalsAccepted,
  proposalsTotalValue,
  signOff,
  hubUrl,
  })
        const r = await sendCategoryEmail({
          category: "daily_briefing",
          teamMemberIds: [m.id],
          subject: `Your Daily Briefing - ${dateLabel}`,
          html,
        })
        totalSent += r.sent
        totalSkipped += r.skipped
      }),
    )

    return NextResponse.json({
      success: true,
      date: dateLabel,
      sent: totalSent,
      skipped_due_to_preferences: totalSkipped,
counts: {
  yesterday_debriefs: yesterdayDebriefs.length,
  upcoming_meetings: upcomingMeetings.length,
  team_reminders: teamReminders.length,
  market_news: marketNews.length,
  tax_news: taxNews.length,
  hub_updates: hubUpdates.length,
  new_intake_forms: intakeForms.length,
  new_feedback: feedbackSubmissions.length,
  new_proposals_accepted: acceptedProposals.length,
  proposals_total_value: proposalsTotalValue,
  },
    })
  } catch (error) {
    console.error("[cron/daily-briefing] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * Types
 * ─────────────────────────────────────────────────────────────────────── */

interface DebriefRow {
  id: string
  debrief_date: string | null
  organization_name: string | null
  contact_id: string | null
  work_item_id: string | null
  created_by_id: string | null
  created_at: string
  karbon_client_key: string | null
  action_items: {
    team_member_name?: string
    related_work_items?: Array<{ title?: string }>
  } | null
}

interface CalendlyEventRow {
  team_member_id: string | null
  name: string | null
  start_time: string
  status: string | null
  calendly_uri: string | null
  location: string | null
}

interface ZoomMeetingRow {
  team_member_id: string | null
  topic: string | null
  start_time: string
  join_url: string | null
  status: string | null
}

interface IntakeFormRow {
  id: string
  submitter_full_name: string | null
  business_name: string | null
  services_requested: string[] | null
  created_at: string
}

interface FeedbackRow {
  id: string
  submitter_full_name: string | null
  rating_overall: number | null
  rating_service_quality: number | null
  feedback_comments: string | null
  created_at: string
}

interface AcceptedProposalRow {
  proposal_id: string
  title: string | null
  client_name: string | null
  total_value: number | null
  accepted_at: string
}

/* ─────────────────────────────────────────────────────────────────────────
 * Helpers
 * ─────────────────────────────────────────────────────────────────────── */

function unwrapData<T>(
  result: PromiseSettledResult<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): T[] {
  if (result.status === "rejected") {
    console.warn(`[cron/daily-briefing] ${label} fetch rejected:`, result.reason)
    return []
  }
  if (result.value.error) {
    console.warn(`[cron/daily-briefing] ${label} fetch error:`, result.value.error.message)
    return []
  }
  return result.value.data || []
}

function unwrapNews(result: PromiseSettledResult<NewsItem[]>): NewsItem[] {
  if (result.status === "rejected") {
  console.warn("[cron/daily-briefing] news fetch rejected:", result.reason)
  return []
  }
  return result.value
  }

interface HubUpdate {
  message: string
  author: string
  date: string
  url: string
}

function unwrapHubUpdates(result: PromiseSettledResult<HubUpdate[]>): HubUpdate[] {
  if (result.status === "rejected") {
    console.warn("[cron/daily-briefing] hub updates fetch rejected:", result.reason)
    return []
  }
  return result.value
}

/**
 * Fetches recent commits to the Motta Hub repository from GitHub.
 * Uses the GitHub REST API to get commits from the past day.
 */
async function fetchHubUpdates(since: Date, until: Date): Promise<HubUpdate[]> {
  const owner = "Motta-Financial"
  const repo = "v0-motta-hub"
  
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?since=${since.toISOString()}&until=${until.toISOString()}&per_page=20`
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "MottaHub-DailyBriefing",
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      console.warn(`[cron/daily-briefing] GitHub API error: ${res.status} ${res.statusText}`)
      return []
    }

    const commits = await res.json() as Array<{
      sha: string
      commit: {
        message: string
        author: {
          name: string
          date: string
        }
      }
      html_url: string
    }>

    return commits.map((c) => ({
      message: c.commit.message,
      author: c.commit.author.name,
      date: new Date(c.commit.author.date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      }),
      url: c.html_url,
    }))
  } catch (err) {
    console.warn("[cron/daily-briefing] Failed to fetch hub updates:", err)
    return []
  }
}
  
  function ymdInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

function formatDateOnly(date: string | null): string {
  if (!date) return "N/A"
  return new Date(`${date}T12:00:00-05:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  })
}

function formatMeetingWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  })
}

/**
 * Asks the model (via the AI Gateway) to write 2-3 paragraphs in ALFRED's
 * signature voice — witty, slightly cheeky British butler. Falls back to
 * a deterministic intro if the model is unavailable so a flaky upstream
 * never blocks the briefing.
 */
async function composeButlerSummary(opts: {
  dateLabel: string
  debriefCount: number
  meetingCount: number
  reminderCount: number
  topReminder?: string
  topMarketHeadline?: string
  topTaxHeadline?: string
}): Promise<string> {
  const fallback = buildFallbackSummary(opts)
  try {
    const prompt = `You are ALFRED Ai, the distinguished AI butler at Motta Financial — a boutique CPA firm. You're writing the opening note of the firm's daily morning briefing email.

**Today:** ${opts.dateLabel}

**By the numbers:**
- Debriefs submitted yesterday: ${opts.debriefCount}
- Client meetings scheduled this week: ${opts.meetingCount}
- Team reminders this week: ${opts.reminderCount}
${opts.topReminder ? `- Notable reminder: ${opts.topReminder}` : ""}
${opts.topMarketHeadline ? `- Top market headline: "${opts.topMarketHeadline}"` : ""}
${opts.topTaxHeadline ? `- Top tax headline: "${opts.topTaxHeadline}"` : ""}

---

Write 2 short paragraphs (3-4 sentences total) introducing the briefing in your signature tone: witty, charming, slightly cheeky British butler — think "old-school valet who has seen everything and still finds it amusing." Greet the firm collectively, gesture toward what's below in the email, and gently set the tone for the day.

Rules:
- No markdown, no headings, no bullets — plain prose suitable for the body of an HTML email.
- Do not write a salutation like "Good morning" — that's already in the email header.
- Do not sign off — that's handled separately.
- Keep it tight: under 90 words total.
- One light British flourish ("one observes...", "rather", "indeed", "if I may") is plenty; don't overdo it.`

    const { text } = await generateText({
      model: "openai/gpt-4o",
      prompt,
      maxOutputTokens: 280,
    })
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : fallback
  } catch (err) {
    console.warn("[cron/daily-briefing] AI summary failed, using fallback:", err)
    return fallback
  }
}

function buildFallbackSummary(opts: {
  debriefCount: number
  meetingCount: number
  reminderCount: number
}): string {
  const debriefLine =
    opts.debriefCount > 0
      ? `${opts.debriefCount} debrief${opts.debriefCount === 1 ? "" : "s"} were filed yesterday and await your perusal`
      : "no debriefs were filed yesterday — a tidy start to the day"
  const meetingLine =
    opts.meetingCount > 0
      ? `${opts.meetingCount} client meeting${opts.meetingCount === 1 ? " is" : "s are"} on the books for the week ahead`
      : "the week's client calendar is, at present, unburdened"
  const reminderLine =
    opts.reminderCount > 0
      ? `Do mind the team reminders below — ${opts.reminderCount} item${opts.reminderCount === 1 ? "" : "s"} of note this week.`
      : "The firm's calendar is mercifully quiet of holidays and deadlines this week."
  return `One trusts you slept well. ${capitalizeFirst(debriefLine)}, and ${meetingLine}. ${reminderLine} I have, as ever, taken the liberty of assembling the morning's particulars below.`
}

function capitalizeFirst(s: string): string {
  if (!s) return s
  return s[0].toUpperCase() + s.slice(1)
}

/**
 * Rotating sign-off line so the briefing doesn't read like a stuck record
 * after a few weeks. Pulled deterministically from the date so all
 * recipients on a given day see the same closing — easier to support
 * ("which version did you get this morning?") than truly random output.
 */
function pickSignOff(): string {
  const lines = [
    "I shall be in the pantry should you require anything further.",
    "The day, as ever, is yours to command.",
    "Onwards, then — and do try to enjoy yourselves.",
    "One stands ready to assist, should the occasion arise.",
    "I shall leave you to it, with my warmest regards.",
    "May your inboxes be light and your coffee strong.",
    "A productive day to you all — I shall be just a click away.",
  ]
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getUTCFullYear(), 0, 0).getTime()) /
      (1000 * 60 * 60 * 24),
  )
  return lines[dayOfYear % lines.length]
}
