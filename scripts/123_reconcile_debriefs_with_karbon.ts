/**
 * One-time reconciliation: backfill debrief → Karbon links.
 *
 * For every row in `debriefs`, this script attempts to populate any
 * missing Karbon-side identity fields by inspecting `karbon_work_url`
 * and falling back to existing `karbon_client_key`. It NEVER overwrites
 * a non-null value — it only fills nulls — so the script is safe to
 * re-run after every Karbon sync.
 *
 * Resolution order:
 *   1. URL contains `/work/<key>` → look up `work_items.karbon_work_item_key`
 *      and inherit work_item_id + karbon_client_key + contact_id +
 *      organization_id + client_owner_name + client_manager_name
 *   2. URL contains `/contacts/<key>` → look up `contacts.karbon_contact_key`
 *      then `organizations.karbon_organization_key` and fill the matching
 *      side + karbon_client_key
 *   3. No URL but existing karbon_client_key → resolve to contact/org
 *      and inherit owner/manager names from a representative work_item
 *      with the same client key
 *
 * Outputs three sections to stdout for ops review:
 *   [updated]      — debriefs the script wrote to
 *   [needs-review] — debriefs with a Karbon URL but no matching record
 *                    in our DB (likely deleted in Karbon, or a sync gap)
 *   [orphan]       — debriefs with no Karbon signals at all (legacy
 *                    standalone notes — manual triage required)
 *
 * Usage:
 *   pnpm tsx scripts/123_reconcile_debriefs_with_karbon.ts            # dry run
 *   pnpm tsx scripts/123_reconcile_debriefs_with_karbon.ts --apply    # write
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")

type DebriefRow = {
  id: string
  karbon_work_url: string | null
  work_item_id: string | null
  karbon_client_key: string | null
  contact_id: string | null
  organization_id: string | null
  client_owner_name: string | null
  client_manager_name: string | null
}

type WorkItemRow = {
  id: string
  karbon_work_item_key: string | null
  karbon_client_key: string | null
  contact_id: string | null
  organization_id: string | null
  client_owner_name: string | null
  client_manager_name: string | null
  deleted_in_karbon_at: string | null
}

type DebriefUpdate = Partial<{
  work_item_id: string
  karbon_client_key: string
  contact_id: string
  organization_id: string
  client_owner_name: string
  client_manager_name: string
}>

/**
 * Karbon work URLs come in many shapes:
 *   https://app2.karbonhq.com/<tenant>#/work/<key>
 *   .../work/<key>/details
 *   .../work/<key>/tasks
 *   .../work/<key>?emailContact=...
 * The perma key is the alphanumeric token immediately after `/work/`.
 *
 * Some debriefs reference a Karbon contact directly:
 *   .../contacts/<key>
 *   .../contacts/<key>/work
 */
function parseKarbonUrl(
  url: string | null
): { kind: "work" | "contact" | "other" | null; key: string | null } {
  if (!url) return { kind: null, key: null }
  const w = url.match(/\/work\/([A-Za-z0-9]+)/)
  if (w) return { kind: "work", key: w[1] }
  const c = url.match(/\/contacts\/([A-Za-z0-9]+)/)
  if (c) return { kind: "contact", key: c[1] }
  return { kind: "other", key: null }
}

async function pageAll<T>(
  sb: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  let from = 0
  while (true) {
    const { data, error } = await sb
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...((data as unknown) as T[]))
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return out
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }
  const sb = createClient(url, key)

  console.log(
    `[reconcile-debriefs] mode: ${APPLY ? "APPLY (writing changes)" : "DRY RUN (no writes)"}`
  )
  console.log("[reconcile-debriefs] loading data...")

  const debriefs = await pageAll<DebriefRow>(
    sb,
    "debriefs",
    "id, karbon_work_url, work_item_id, karbon_client_key, contact_id, organization_id, client_owner_name, client_manager_name"
  )
  const wis = await pageAll<WorkItemRow>(
    sb,
    "work_items",
    "id, karbon_work_item_key, karbon_client_key, contact_id, organization_id, client_owner_name, client_manager_name, deleted_in_karbon_at"
  )
  const contacts = await pageAll<{ id: string; karbon_contact_key: string | null }>(
    sb,
    "contacts",
    "id, karbon_contact_key"
  )
  const orgs = await pageAll<{ id: string; karbon_organization_key: string | null }>(
    sb,
    "organizations",
    "id, karbon_organization_key"
  )

  console.log(
    `[reconcile-debriefs] loaded: ${debriefs.length} debriefs, ${wis.length} work_items, ${contacts.length} contacts, ${orgs.length} organizations`
  )

  const wiByKarbonKey = new Map<string, WorkItemRow>()
  for (const w of wis) {
    if (w.karbon_work_item_key) wiByKarbonKey.set(w.karbon_work_item_key, w)
  }
  const wiById = new Map(wis.map((w) => [w.id, w]))
  // Pick first non-deleted work item per client key — used as the
  // representative source for owner/manager names when the debrief has
  // a karbon_client_key but no URL.
  const wiByClientKey = new Map<string, WorkItemRow>()
  for (const w of wis) {
    if (w.deleted_in_karbon_at || !w.karbon_client_key) continue
    if (!wiByClientKey.has(w.karbon_client_key)) {
      wiByClientKey.set(w.karbon_client_key, w)
    }
  }
  const contactByKarbonKey = new Map<string, string>()
  for (const c of contacts) {
    if (c.karbon_contact_key) contactByKarbonKey.set(c.karbon_contact_key, c.id)
  }
  const orgByKarbonKey = new Map<string, string>()
  for (const o of orgs) {
    if (o.karbon_organization_key) orgByKarbonKey.set(o.karbon_organization_key, o.id)
  }

  const writes: { id: string; update: DebriefUpdate }[] = []
  const needsReview: { id: string; url: string; key: string | null; reason: string }[] = []
  const orphan: string[] = []

  const stats = {
    already_complete: 0,
    url_work_already_linked: 0,
    url_work_will_link: 0,
    url_work_unmatched: 0,
    url_contact_resolved: 0,
    url_contact_unresolved: 0,
    url_other: 0,
    no_url_already_linked: 0,
    no_url_via_client_key: 0,
    no_url_orphan: 0,
    set_work_item_id: 0,
    set_karbon_client_key: 0,
    set_contact_id: 0,
    set_organization_id: 0,
    set_client_owner_name: 0,
    set_client_manager_name: 0,
  }

  for (const d of debriefs) {
    const update: DebriefUpdate = {}
    let resolvedWi: WorkItemRow | null = null

    // ---------- URL-based resolution ----------
    if (d.karbon_work_url) {
      const { kind, key: parsedKey } = parseKarbonUrl(d.karbon_work_url)

      if (kind === "work" && parsedKey) {
        const wi = wiByKarbonKey.get(parsedKey)
        if (wi) {
          resolvedWi = wi
          if (d.work_item_id === wi.id) {
            stats.url_work_already_linked++
          } else if (!d.work_item_id) {
            update.work_item_id = wi.id
            stats.url_work_will_link++
            stats.set_work_item_id++
          }
          // If d.work_item_id is set to a DIFFERENT id than what the URL
          // points to, leave it alone — we don't want to silently flip
          // the link. (Audit shows this is currently 0.)
        } else {
          stats.url_work_unmatched++
          needsReview.push({
            id: d.id,
            url: d.karbon_work_url,
            key: parsedKey,
            reason: "work_item not in DB (deleted in Karbon or sync gap)",
          })
        }
      } else if (kind === "contact" && parsedKey) {
        const contactId = contactByKarbonKey.get(parsedKey)
        const orgId = orgByKarbonKey.get(parsedKey)
        if (contactId) {
          if (!d.contact_id) {
            update.contact_id = contactId
            stats.set_contact_id++
          }
          if (!d.karbon_client_key) {
            update.karbon_client_key = parsedKey
            stats.set_karbon_client_key++
          }
          stats.url_contact_resolved++
        } else if (orgId) {
          if (!d.organization_id) {
            update.organization_id = orgId
            stats.set_organization_id++
          }
          if (!d.karbon_client_key) {
            update.karbon_client_key = parsedKey
            stats.set_karbon_client_key++
          }
          stats.url_contact_resolved++
        } else {
          stats.url_contact_unresolved++
          needsReview.push({
            id: d.id,
            url: d.karbon_work_url,
            key: parsedKey,
            reason: "contact/org not in DB",
          })
        }
      } else {
        stats.url_other++
        needsReview.push({
          id: d.id,
          url: d.karbon_work_url,
          key: null,
          reason: "non-Karbon URL (e.g. Airtable, triage tool)",
        })
      }
    } else if (d.work_item_id) {
      resolvedWi = wiById.get(d.work_item_id) ?? null
      stats.no_url_already_linked++
    } else if (d.karbon_client_key) {
      // No URL but has a client key — try to fill contact/org via the
      // key, and pull owner/manager names from a representative work
      // item for the same client.
      let filled = false
      if (!d.contact_id && contactByKarbonKey.has(d.karbon_client_key)) {
        update.contact_id = contactByKarbonKey.get(d.karbon_client_key)!
        stats.set_contact_id++
        filled = true
      }
      if (!d.organization_id && orgByKarbonKey.has(d.karbon_client_key)) {
        update.organization_id = orgByKarbonKey.get(d.karbon_client_key)!
        stats.set_organization_id++
        filled = true
      }
      const sameClientWi = wiByClientKey.get(d.karbon_client_key)
      if (sameClientWi) {
        if (!d.client_owner_name && sameClientWi.client_owner_name) {
          update.client_owner_name = sameClientWi.client_owner_name
          stats.set_client_owner_name++
          filled = true
        }
        if (!d.client_manager_name && sameClientWi.client_manager_name) {
          update.client_manager_name = sameClientWi.client_manager_name
          stats.set_client_manager_name++
          filled = true
        }
      }
      if (filled) stats.no_url_via_client_key++
    } else if (!d.contact_id && !d.organization_id) {
      orphan.push(d.id)
      stats.no_url_orphan++
    }

    // ---------- Inherit from resolved work item ----------
    if (resolvedWi) {
      if (!d.karbon_client_key && resolvedWi.karbon_client_key) {
        update.karbon_client_key = resolvedWi.karbon_client_key
        stats.set_karbon_client_key++
      }
      if (!d.contact_id && resolvedWi.contact_id) {
        update.contact_id = resolvedWi.contact_id
        stats.set_contact_id++
      }
      if (!d.organization_id && resolvedWi.organization_id) {
        update.organization_id = resolvedWi.organization_id
        stats.set_organization_id++
      }
      if (!d.client_owner_name && resolvedWi.client_owner_name) {
        update.client_owner_name = resolvedWi.client_owner_name
        stats.set_client_owner_name++
      }
      if (!d.client_manager_name && resolvedWi.client_manager_name) {
        update.client_manager_name = resolvedWi.client_manager_name
        stats.set_client_manager_name++
      }
    }

    if (d.work_item_id && d.karbon_client_key && (d.contact_id || d.organization_id)) {
      stats.already_complete++
    }
    if (Object.keys(update).length > 0) {
      writes.push({ id: d.id, update })
    }
  }

  // ---------- Report ----------
  console.log()
  console.log("=== Reconciliation Report ===")
  console.log(`Total debriefs:               ${debriefs.length}`)
  console.log(`Already fully populated:      ${stats.already_complete}`)
  console.log()
  console.log("URL classification:")
  console.log(`  /work/ already linked:      ${stats.url_work_already_linked}`)
  console.log(`  /work/ will link:           ${stats.url_work_will_link}`)
  console.log(`  /work/ unmatched:           ${stats.url_work_unmatched}`)
  console.log(`  /contacts/ resolved:        ${stats.url_contact_resolved}`)
  console.log(`  /contacts/ unresolved:      ${stats.url_contact_unresolved}`)
  console.log(`  other URL shape:            ${stats.url_other}`)
  console.log(`  no URL, already linked:     ${stats.no_url_already_linked}`)
  console.log(`  no URL, via client_key:     ${stats.no_url_via_client_key}`)
  console.log(`  no URL, orphan:             ${stats.no_url_orphan}`)
  console.log()
  console.log("Backfill writes:")
  console.log(`  TOTAL DEBRIEFS UPDATED:     ${writes.length}`)
  console.log(`  + work_item_id:             ${stats.set_work_item_id}`)
  console.log(`  + karbon_client_key:        ${stats.set_karbon_client_key}`)
  console.log(`  + contact_id:               ${stats.set_contact_id}`)
  console.log(`  + organization_id:          ${stats.set_organization_id}`)
  console.log(`  + client_owner_name:        ${stats.set_client_owner_name}`)
  console.log(`  + client_manager_name:      ${stats.set_client_manager_name}`)
  console.log()
  console.log(`Needs review:                 ${needsReview.length}`)
  console.log(`Orphan (no signals):          ${orphan.length}`)

  // ---------- Apply ----------
  if (!APPLY) {
    console.log()
    console.log("Dry run complete. Re-run with --apply to write changes.")
    return
  }

  console.log()
  console.log(`[reconcile-debriefs] applying ${writes.length} updates...`)

  let ok = 0
  let fail = 0
  // Small batch — process in parallel with a soft concurrency cap of 10
  const CONC = 10
  for (let i = 0; i < writes.length; i += CONC) {
    const batch = writes.slice(i, i + CONC)
    const results = await Promise.allSettled(
      batch.map((w) =>
        sb
          .from("debriefs")
          .update({ ...w.update, updated_at: new Date().toISOString() })
          .eq("id", w.id)
          .then((res) => {
            if (res.error) throw res.error
            return res
          })
      )
    )
    for (const r of results) {
      if (r.status === "fulfilled") ok++
      else {
        fail++
        console.error("[reconcile-debriefs] update failed:", r.reason)
      }
    }
  }

  console.log(`[reconcile-debriefs] applied: ${ok} ok, ${fail} failed`)

  // Dump needs-review and orphan IDs at the end so they're easy to grep
  console.log()
  console.log(`[needs-review] ${needsReview.length} debriefs:`)
  for (const r of needsReview) {
    console.log(`  ${r.id}  ${r.reason}  ${r.url}`)
  }
}

main().catch((err) => {
  console.error("[reconcile-debriefs] fatal:", err)
  process.exit(1)
})
