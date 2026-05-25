/**
 * Run the existing /api/tax/client-links/auto-link logic against the live
 * Supabase to bulk-apply Hub mappings to the 484 unmapped ProConnect
 * organizations.
 *
 * This is a one-shot operational script — it imports the same matcher
 * code the API uses (so behavior stays identical) and writes:
 *   - proconnect_clients.hub_contact_id / hub_organization_id
 *   - proconnect_clients.link_source = 'auto_fuzzy'
 *   - tax_proconnect_client_link_log row with status='applied'
 *
 * Usage:
 *   pnpm dlx tsx scripts/apply-proconnect-auto-link.ts --dry-run
 *   pnpm dlx tsx scripts/apply-proconnect-auto-link.ts
 */

import { createClient } from "@supabase/supabase-js"
import {
  rankHubCandidates,
  pickAutoApply,
  MATCHER_VERSION,
  type ProconnectClientLite,
} from "../lib/tax/proconnect-client-match"

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

async function main() {
  const dryRun = process.argv.includes("--dry-run")

  const { data: clients, error } = await sb
    .from("proconnect_clients")
    .select(
      "proconnect_client_id, client_type, email, first_name, last_name, business_name, display_name, tax_id, state",
    )
    .is("hub_contact_id", null)
    .is("hub_organization_id", null)
  if (error) {
    console.error("fetch unmapped failed:", error.message)
    process.exit(1)
  }

  // Pull rejected pairs once so the matcher doesn't re-suggest them.
  const { data: rejections } = await sb
    .from("tax_proconnect_client_link_log")
    .select("proconnect_client_id, hub_contact_id, hub_organization_id")
    .eq("status", "rejected")
  const excludePairs = new Set(
    (rejections || []).map(
      (r) =>
        `${(r as { proconnect_client_id: string }).proconnect_client_id}|${
          (r as { hub_contact_id: string | null }).hub_contact_id ||
          (r as { hub_organization_id: string | null }).hub_organization_id
        }`,
    ),
  )

  const total = clients?.length ?? 0
  console.log(
    `[v0] Scanning ${total} unmapped ProConnect clients ${dryRun ? "(DRY RUN)" : ""}`,
  )

  const proposed: Array<{
    pc: ProconnectClientLite
    kind: "contact" | "organization"
    candidate_id: string
    candidate_name: string | null
    score: number
    signals: string[]
  }> = []
  let scanned = 0
  for (const c of (clients as ProconnectClientLite[] | null) || []) {
    const candidates = await rankHubCandidates(sb, c, { excludePairs })
    const top = pickAutoApply(candidates)
    scanned++
    if (scanned % 100 === 0) {
      console.log(`[v0] scanned ${scanned}/${total}, proposed ${proposed.length}`)
    }
    if (!top) continue
    proposed.push({
      pc: c,
      kind: top.kind,
      candidate_id: top.id,
      candidate_name:
        top.kind === "organization"
          ? top.name ?? null
          : top.full_name ?? null,
      score: top.score,
      signals: top.signals,
    })
  }

  console.log(
    `\n[v0] Scan complete. Auto-applicable: ${proposed.length}/${total}\n`,
  )

  // Show top of the proposed list grouped by client_type
  const byType: Record<string, number> = {}
  const sigCount: Record<string, number> = {}
  for (const p of proposed) {
    const key = String(p.pc.client_type ?? "(null)")
    byType[key] = (byType[key] ?? 0) + 1
    for (const s of p.signals) sigCount[s] = (sigCount[s] ?? 0) + 1
  }
  console.log("by client_type:", byType)
  console.log("by signal     :", sigCount)

  console.log("\n--- top 25 proposed ---")
  for (const p of proposed.slice(0, 25)) {
    const display = p.pc.business_name || p.pc.display_name || "(unnamed)"
    console.log(
      `  [${p.score.toFixed(2)}] ${display.padEnd(40).slice(0, 40)} → ${p.candidate_name ?? "(unknown)"}  signals=${p.signals.join(",")}`,
    )
  }

  if (dryRun) {
    console.log("\n[v0] DRY RUN — no writes. Re-run without --dry-run to apply.")
    return
  }

  console.log("\n[v0] Applying...")
  let applied = 0
  let failed = 0
  for (const p of proposed) {
    const isOrg = p.kind === "organization"
    const { error: upErr } = await sb
      .from("proconnect_clients")
      .update({
        hub_contact_id: isOrg ? null : p.candidate_id,
        hub_organization_id: isOrg ? p.candidate_id : null,
        link_source: "auto_fuzzy",
      })
      .eq("proconnect_client_id", p.pc.proconnect_client_id)
    if (upErr) {
      console.error(
        `  FAIL ${p.pc.proconnect_client_id}: ${upErr.message}`,
      )
      failed++
      continue
    }
    await sb.from("tax_proconnect_client_link_log").insert({
      proconnect_client_id: p.pc.proconnect_client_id,
      hub_contact_id: isOrg ? null : p.candidate_id,
      hub_organization_id: isOrg ? p.candidate_id : null,
      status: "applied",
      score: p.score,
      signals: p.signals,
      matcher_version: MATCHER_VERSION,
      acted_by: "auto_fuzzy_script",
    } as never)
    applied++
  }

  console.log(
    `\n[v0] Done. Applied: ${applied}, Failed: ${failed}, Skipped: ${total - proposed.length}`,
  )
}

main().catch((err) => {
  console.error("[v0] Fatal:", err)
  process.exit(1)
})
