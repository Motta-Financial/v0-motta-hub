import { type NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * Calendly meeting-type color map.
 *
 * GET   → returns one entry per distinct event_type_name with:
 *           - `color`:    the firm-wide override if set, else the Calendly
 *                         default (taken from any active calendly_event_types
 *                         row sharing the same name).
 *           - `default`:  the Calendly default (so the settings UI can
 *                         render a "reset to default" affordance).
 *           - `isOverride`: whether the firm has set a custom value.
 *           - `count`:    how many `calendly_events` rows currently use
 *                         this name. The settings UI sorts the most-used
 *                         types first so the dial moves where it matters.
 *
 * PATCH → upsert one or many `{ event_type_name, color }` overrides.
 *         Body shape: `{ overrides: [{ event_type_name, color }, …] }`.
 *         A null `color` deletes the override (i.e. revert to Calendly's
 *         default). Color is validated with the same regex the table
 *         CHECK constraint uses so we surface a clean 400 instead of a
 *         Postgres error.
 */

const HEX_COLOR_RE = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i

export interface EventTypeColorEntry {
  event_type_name: string
  color: string
  default: string | null
  isOverride: boolean
  count: number
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Three small queries in parallel — none big enough to warrant a view
    // and the result needs to be merged client-side anyway. Defaults are
    // computed by picking the first non-null Calendly color per name.
    const [typesRes, overridesRes, eventsRes] = await Promise.all([
      supabase
        .from("calendly_event_types")
        .select("name, color, active")
        .eq("active", true),
      supabase.from("calendly_event_type_colors").select("event_type_name, color"),
      supabase.from("calendly_events").select("event_type_name").not("event_type_name", "is", null),
    ])

    if (typesRes.error || overridesRes.error || eventsRes.error) {
      const msg =
        typesRes.error?.message || overridesRes.error?.message || eventsRes.error?.message
      console.error("[event-type-colors] query failed:", msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // Build the default-color lookup. Multiple per-user rows can share
    // the same name; we pick the first non-empty color we see. In
    // practice they're identical (same template across users).
    const defaults = new Map<string, string>()
    for (const t of typesRes.data || []) {
      if (!t.name || !t.color) continue
      if (!defaults.has(t.name)) defaults.set(t.name, t.color)
    }

    // Override map.
    const overrides = new Map<string, string>()
    for (const o of overridesRes.data || []) {
      if (o.event_type_name && o.color) overrides.set(o.event_type_name, o.color)
    }

    // Usage counts across the events table — drives sort order in the UI.
    const counts = new Map<string, number>()
    for (const e of eventsRes.data || []) {
      const n = e.event_type_name
      if (!n) continue
      counts.set(n, (counts.get(n) ?? 0) + 1)
    }

    // Union of all names across types, overrides, and events. Including
    // every overridden name even if no current event uses it preserves
    // the firm's color choice when meetings of that type roll off.
    const names = new Set<string>([
      ...defaults.keys(),
      ...overrides.keys(),
      ...counts.keys(),
    ])

    const entries: EventTypeColorEntry[] = Array.from(names).map((name) => {
      const def = defaults.get(name) ?? null
      const override = overrides.get(name) ?? null
      return {
        event_type_name: name,
        color: override ?? def ?? "#64748b", // slate-500 final fallback
        default: def,
        isOverride: !!override,
        count: counts.get(name) ?? 0,
      }
    })

    // Sort: most-used first, ties broken alphabetically.
    entries.sort((a, b) => b.count - a.count || a.event_type_name.localeCompare(b.event_type_name))

    return NextResponse.json({ entries })
  } catch (err) {
    console.error("[event-type-colors] GET error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const overrides: Array<{ event_type_name?: string; color?: string | null }> =
      Array.isArray(body?.overrides) ? body.overrides : []

    if (overrides.length === 0) {
      return NextResponse.json({ error: "overrides array required" }, { status: 400 })
    }

    // Optional: which teammate is making the change, for the audit column.
    // We accept the id from the body rather than from the session because
    // the UI already has the user-context value handy and there's no
    // sensitive operation gating it (firm-internal tool). If absent we
    // simply leave updated_by null.
    const teamMemberId: string | null = body?.team_member_id || null

    const toUpsert: Array<{
      event_type_name: string
      color: string
      updated_by_team_member_id: string | null
      updated_at: string
    }> = []
    const toDelete: string[] = []

    for (const o of overrides) {
      const name = (o.event_type_name || "").trim()
      if (!name) continue
      if (o.color == null) {
        toDelete.push(name)
        continue
      }
      if (!HEX_COLOR_RE.test(o.color)) {
        return NextResponse.json(
          { error: `invalid color "${o.color}" for "${name}" — expected #rrggbb` },
          { status: 400 },
        )
      }
      toUpsert.push({
        event_type_name: name,
        color: o.color,
        updated_by_team_member_id: teamMemberId,
        updated_at: new Date().toISOString(),
      })
    }

    const supabase = createAdminClient()

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from("calendly_event_type_colors")
        .upsert(toUpsert, { onConflict: "event_type_name" })
      if (error) {
        console.error("[event-type-colors] upsert failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("calendly_event_type_colors")
        .delete()
        .in("event_type_name", toDelete)
      if (error) {
        console.error("[event-type-colors] delete failed:", error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      upserted: toUpsert.length,
      deleted: toDelete.length,
    })
  } catch (err) {
    console.error("[event-type-colors] PATCH error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
