import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { EMAIL_CATEGORIES, type EmailCategory } from "@/lib/email"

/**
 * GET /api/notifications/preferences?team_member_id=...
 * Returns the full preferences map for a team member, defaulting any missing
 * categories to {email_enabled: true, in_app_enabled: true}.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const teamMemberId = url.searchParams.get("team_member_id")
    if (!teamMemberId) {
      return NextResponse.json({ error: "team_member_id is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("notification_preferences")
      .select("category, email_enabled, in_app_enabled")
      .eq("team_member_id", teamMemberId)
    if (error) throw error

    const stored = new Map<string, { email_enabled: boolean; in_app_enabled: boolean }>()
    for (const row of data ?? []) {
      stored.set(row.category, {
        email_enabled: row.email_enabled,
        in_app_enabled: row.in_app_enabled,
      })
    }

    // Build a complete response that includes any not-yet-saved categories
    // with sensible defaults.
    const preferences = (Object.keys(EMAIL_CATEGORIES) as EmailCategory[]).map((cat) => ({
      category: cat,
      label: EMAIL_CATEGORIES[cat].label,
      description: EMAIL_CATEGORIES[cat].description,
      email_enabled: stored.get(cat)?.email_enabled ?? true,
      in_app_enabled: stored.get(cat)?.in_app_enabled ?? true,
    }))

    return NextResponse.json({ preferences })
  } catch (error) {
    console.error("[notifications/preferences GET] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}

/**
 * PUT /api/notifications/preferences
 * Body: { team_member_id, preferences: [{category, email_enabled, in_app_enabled}, ...] }
 * Upserts each category. Categories not included are left untouched.
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { team_member_id, preferences } = body
    if (!team_member_id || !Array.isArray(preferences)) {
      return NextResponse.json(
        { error: "team_member_id and preferences array required" },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const validCategories = new Set(Object.keys(EMAIL_CATEGORIES))
    const rows = preferences
      .filter((p: { category: string }) => validCategories.has(p.category))
      .map((p: { category: string; email_enabled?: boolean; in_app_enabled?: boolean }) => ({
        team_member_id,
        category: p.category,
        email_enabled: p.email_enabled ?? true,
        in_app_enabled: p.in_app_enabled ?? true,
        updated_at: new Date().toISOString(),
      }))

    if (rows.length === 0) {
      return NextResponse.json({ success: true, updated: 0 })
    }

    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert(rows, { onConflict: "team_member_id,category" })
      .select()
    if (error) throw error

    return NextResponse.json({ success: true, updated: data?.length ?? 0 })
  } catch (error) {
    console.error("[notifications/preferences PUT] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
