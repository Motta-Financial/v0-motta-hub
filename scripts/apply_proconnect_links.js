/**
 * Apply the matches found in proconnect_link_plan.json:
 * - sets hub_contact_id for contact matches
 * - sets hub_organization_id for organization matches
 * Then verifies that engagements (tax returns) roll up correctly.
 */
const fs = require("fs")
const { createClient } = require("@supabase/supabase-js")

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const plan = JSON.parse(
    fs.readFileSync("scripts/proconnect_link_plan.json", "utf-8")
  )
  console.log(`Applying ${plan.length} ProConnect -> Hub links...\n`)

  let contactLinked = 0
  let orgLinked = 0
  const failures = []

  for (const m of plan) {
    const update =
      m.match_kind === "contact"
        ? { hub_contact_id: m.match_id, hub_organization_id: null }
        : { hub_organization_id: m.match_id, hub_contact_id: null }

    const { error } = await supabase
      .from("proconnect_clients")
      .update(update)
      .eq("proconnect_client_id", m.proconnect_client_id)

    if (error) {
      failures.push({ ...m, error: error.message })
      continue
    }

    if (m.match_kind === "contact") contactLinked++
    else orgLinked++
  }

  console.log(`  Contacts linked:      ${contactLinked}`)
  console.log(`  Organizations linked: ${orgLinked}`)
  console.log(`  Failures:             ${failures.length}`)
  if (failures.length) {
    console.log("\nFailures:")
    failures.forEach((f) =>
      console.log(`  ${f.proconnect_display} -> ${f.match_display}: ${f.error}`)
    )
  }

  // Verify tax return rollup
  console.log("\n=== Tax Return Rollup Verification ===")

  const { count: totalEngagements } = await supabase
    .from("proconnect_engagements")
    .select("*", { count: "exact", head: true })

  const { data: linkedClients } = await supabase
    .from("proconnect_clients")
    .select("proconnect_client_id, hub_contact_id, hub_organization_id")
    .or("hub_contact_id.not.is.null,hub_organization_id.not.is.null")

  const linkedIds = new Set(linkedClients.map((c) => c.proconnect_client_id))

  const { data: engClients } = await supabase
    .from("proconnect_engagements")
    .select("proconnect_client_id")

  const engIds = new Set(engClients.map((e) => e.proconnect_client_id))
  const orphan = [...engIds].filter((id) => !linkedIds.has(id))

  console.log(`Total tax returns:                ${totalEngagements}`)
  console.log(`ProConnect clients with returns:  ${engIds.size}`)
  console.log(`...of which now linked to Hub:    ${engIds.size - orphan.length}`)
  console.log(`...still orphan (no Hub link):    ${orphan.length}`)

  if (orphan.length) {
    console.log("\nOrphan ProConnect client IDs (have tax returns, no Hub link):")
    const { data: orphanDetails } = await supabase
      .from("proconnect_clients")
      .select("proconnect_client_id, display_name, business_name, first_name, last_name")
      .in("proconnect_client_id", orphan.slice(0, 20))
    orphanDetails?.forEach((o) =>
      console.log(
        `  ${o.proconnect_client_id}  ${o.display_name || o.business_name || `${o.first_name} ${o.last_name}`}`
      )
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
