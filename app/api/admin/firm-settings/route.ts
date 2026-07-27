import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth/require-admin"
import { createAdminClient } from "@/lib/supabase/server"
import { invalidateFirmConfigCache, getFirmConfig } from "@/lib/firm-settings"

/**
 * Admin surface for the firm_settings table (scripts/354). GET returns
 * the raw rows plus the resolved effective config (DB → env → default),
 * so the settings UI can show both what's stored and what actually
 * applies. PUT upserts a batch of keys.
 *
 * Writes use the service-role client because firm_settings has no
 * INSERT/UPDATE policies by design — this route (behind requireAdmin)
 * is the only write path.
 */

const KNOWN_KEYS = new Set([
  "firm.name",
  "firm.short_name",
  "firm.hub_url",
  "firm.public_site_url",
  "firm.internal_email_domains",
  "firm.from_email",
  "firm.support_email",
  "firm.timezone",
  "firm.cors_allowed_hosts",
  "firm.cors_preview_prefixes",
  "assistant.name",
  "assistant.email",
])

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const supabase = createAdminClient()
  const [{ data: rows, error }, effective] = await Promise.all([
    supabase.from("firm_settings").select("key, value, description, updated_at").order("key"),
    getFirmConfig(),
  ])
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ settings: rows ?? [], effective })
}

export async function PUT(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const updates = (body as { settings?: Array<{ key?: unknown; value?: unknown }> })?.settings
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "Body must be { settings: [{ key, value }, ...] }" }, { status: 400 })
  }

  const rows: Array<{ key: string; value: unknown; updated_at: string; updated_by: string }> = []
  for (const u of updates) {
    if (typeof u?.key !== "string" || !KNOWN_KEYS.has(u.key)) {
      return NextResponse.json({ error: `Unknown setting key: ${String(u?.key)}` }, { status: 400 })
    }
    if (u.value === undefined) {
      return NextResponse.json({ error: `Missing value for key: ${u.key}` }, { status: 400 })
    }
    rows.push({
      key: u.key,
      value: u.value,
      updated_at: new Date().toISOString(),
      updated_by: auth.userId,
    })
  }

  const supabase = createAdminClient()
  const { error } = await supabase.from("firm_settings").upsert(rows, { onConflict: "key" })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Drop this lambda's cache immediately; other warm lambdas pick the
  // change up within the module's 5-minute TTL.
  invalidateFirmConfigCache()

  const effective = await getFirmConfig()
  return NextResponse.json({ ok: true, updated: rows.map((r) => r.key), effective })
}
