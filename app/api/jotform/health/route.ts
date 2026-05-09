/**
 * GET /api/jotform/health
 *
 * Verifies the Jotform integration is reachable end-to-end:
 *   1. JOTFORM_API_KEY env var is present
 *   2. /user endpoint returns 200 (key is valid)
 *   3. The intake form is visible and reports its current submission count
 *   4. The Supabase tables for Jotform exist + report row counts
 *   5. Currently registered webhooks for the intake form
 *
 * Intended for the admin "integrations" dashboard. No auth required to
 * call from inside the app — wrap behind a layout guard if exposing
 * publicly.
 */
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { getCurrentUser, getForm, listWebhooks } from "@/lib/jotform/client"

const INTAKE_FORM_ID = "242306172162144"

export async function GET() {
  const out: Record<string, unknown> = {
    ok: true,
    timestamp: new Date().toISOString(),
  }

  // 1 + 2. API key + user lookup
  try {
    const user = await getCurrentUser()
    out.jotform_api = {
      ok: true,
      username: user.username,
      email: user.email,
      account_type: user.account_type?.name,
    }
  } catch (err) {
    out.ok = false
    out.jotform_api = { ok: false, error: (err as Error).message }
    return NextResponse.json(out, { status: 502 })
  }

  // 3. Intake form metadata
  try {
    const form = await getForm(INTAKE_FORM_ID)
    out.intake_form = {
      ok: true,
      id: form.id,
      title: form.title,
      url: form.url,
      status: form.status,
      jotform_submission_count: Number(form.count),
    }
  } catch (err) {
    out.ok = false
    out.intake_form = { ok: false, error: (err as Error).message }
  }

  // 4. Supabase tables + counts
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const [forms, intakes, events] = await Promise.all([
      supabase.from("jotform_forms").select("*", { count: "exact", head: true }),
      supabase
        .from("jotform_intake_submissions")
        .select("*", { count: "exact", head: true })
        .eq("jotform_form_id", INTAKE_FORM_ID),
      supabase.from("jotform_webhook_events").select("*", { count: "exact", head: true }),
    ])

    out.supabase = {
      ok: !forms.error && !intakes.error && !events.error,
      jotform_forms: forms.count ?? 0,
      jotform_intake_submissions: intakes.count ?? 0,
      jotform_webhook_events: events.count ?? 0,
    }
  } catch (err) {
    out.ok = false
    out.supabase = { ok: false, error: (err as Error).message }
  }

  // 5. Registered webhooks
  try {
    const hooks = await listWebhooks(INTAKE_FORM_ID)
    out.webhooks = {
      ok: true,
      registered: Object.values(hooks),
    }
  } catch (err) {
    out.webhooks = { ok: false, error: (err as Error).message }
  }

  return NextResponse.json(out)
}
