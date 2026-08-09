/**
 * 397: Resolve the debrief work items that are missing from the Hub, via the
 * Karbon API, and link their debriefs to the right client.
 *
 * WHY THIS NEEDS THE API
 * `debriefs.karbon_work_url` carries a Karbon work key (`…#/work/<key>`) which
 * joins to `work_items.karbon_work_item_key` and from there to the client. That
 * path already accounts for most existing debrief links: of 481 debriefs holding
 * a work key, 468 resolve and ALL 468 are linked. The remaining 13 debriefs
 * (8 distinct keys) point at work items that are absent from the Hub entirely —
 * checked against work_items, busy_season_work_items, karbon_notes, karbon_tasks,
 * karbon_timesheets, karbon_invoices, tax_return_links, project_mapping and
 * work_items.related_work_keys, with zero hits. They were deleted in Karbon or
 * never synced, so no amount of SQL can recover them. Karbon itself is the only
 * remaining source.
 *
 * WHAT IT DOES
 *   1. Reads the unresolved (debrief, work key) pairs straight from the database.
 *   2. GET /v3/WorkItems/{WorkItemKey} for each distinct key.
 *   3. Takes ClientKey / ClientType / ClientName off the work item.
 *   4. Resolves ClientKey to a Hub client: ClientType 'Organization' →
 *      organizations.karbon_organization_key, 'Contact' →
 *      contacts.karbon_contact_key. ORGANIZATION WINS if both somehow match.
 *   5. Reports a table. Writes nothing unless --apply is passed.
 *
 * SAFETY
 *   * Dry run by default. `--apply` is required to write.
 *   * Refuses to link when the Karbon ClientKey matches zero or several Hub
 *     records — those are reported for a human instead.
 *   * Only ever fills a debrief whose contact_id AND organization_id are null, so
 *     it cannot overwrite an existing or human-made link. Re-running is a no-op.
 *
 * CREDENTIALS — never hardcode these. Both come from Karbon under
 * Settings → Connected Apps → API Applications → {your API application}:
 *   KARBON_ACCESS_KEY    the Tenant AccessKey  (sent as the `AccessKey` header)
 *   KARBON_BEARER_TOKEN  the Authorization token (sent as `Authorization: Bearer`)
 * A 401 of "Static Key is missing or invalid" means KARBON_ACCESS_KEY is wrong;
 * "Auth token is missing or invalid" means KARBON_BEARER_TOKEN is wrong. The two
 * failures are distinguishable, which is how you tell which one to rotate.
 *
 * Run: pnpm exec tsx scripts/397_resolve_missing_karbon_work_items.ts [--apply]
 */
import { Client } from "pg"

const KARBON_BASE_URL = "https://api.karbonhq.com/v3"

type Row = {
  debrief_id: string
  work_key: string
  debrief_date: string | null
  notes_excerpt: string | null
}

type Resolution = {
  work_key: string
  clientKey: string | null
  clientType: string | null
  clientName: string | null
  hubContactId: string | null
  hubOrganizationId: string | null
  status: "resolved" | "no_client_on_work_item" | "not_in_hub" | "ambiguous" | "fetch_failed"
  detail: string
}

/** Only the fields this script needs; Karbon returns many more. */
type KarbonWorkItem = {
  WorkItemKey?: string
  WorkTitle?: string
  ClientKey?: string
  ClientName?: string
  ClientType?: string
  ClientGroupKey?: string
}

async function karbonGet<T>(path: string, accessKey: string, bearer: string): Promise<T> {
  const res = await fetch(`${KARBON_BASE_URL}${path}`, {
    headers: {
      AccessKey: accessKey,
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json",
    },
  })
  const text = await res.text()
  if (!res.ok) {
    // Surface the message verbatim — it distinguishes which credential failed.
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return JSON.parse(text) as T
}

async function main() {
  const apply = process.argv.includes("--apply")
  const accessKey = process.env.KARBON_ACCESS_KEY
  const bearer = process.env.KARBON_BEARER_TOKEN
  const pgUrl = process.env.POSTGRES_URL_NON_POOLING

  if (!accessKey || !bearer) {
    throw new Error("KARBON_ACCESS_KEY and KARBON_BEARER_TOKEN must both be set")
  }
  if (!pgUrl) throw new Error("POSTGRES_URL_NON_POOLING not set")

  const db = new Client({ connectionString: pgUrl, ssl: { rejectUnauthorized: false } })
  await db.connect()

  try {
    // ── 1. The unresolved pairs, straight from the data ───────────────────
    const { rows } = await db.query<Row>(`
      select d.id as debrief_id,
             substring(d.karbon_work_url from '#/work/([A-Za-z0-9]+)') as work_key,
             d.debrief_date::text,
             left(regexp_replace(d.notes, '\\s+', ' ', 'g'), 70) as notes_excerpt
      from public.debriefs d
      where d.deleted_at is null
        and d.contact_id is null
        and d.organization_id is null
        and d.karbon_work_url ~ '#/work/'
        and not exists (
          select 1 from public.work_items w
          where w.karbon_work_item_key = substring(d.karbon_work_url from '#/work/([A-Za-z0-9]+)')
        )
      order by d.debrief_date
    `)

    if (rows.length === 0) {
      console.log("Nothing to do — every debrief work key already resolves in the Hub.")
      return
    }

    const keys = [...new Set(rows.map((r) => r.work_key))]
    console.log(`${rows.length} debrief(s) across ${keys.length} distinct work key(s)\n`)

    // ── 2/3/4. Fetch each key and resolve its client ──────────────────────
    const resolutions = new Map<string, Resolution>()

    for (const key of keys) {
      let wi: KarbonWorkItem
      try {
        wi = await karbonGet<KarbonWorkItem>(
          `/WorkItems/${encodeURIComponent(key)}`, accessKey, bearer,
        )
      } catch (e) {
        resolutions.set(key, {
          work_key: key, clientKey: null, clientType: null, clientName: null,
          hubContactId: null, hubOrganizationId: null,
          status: "fetch_failed", detail: e instanceof Error ? e.message : String(e),
        })
        continue
      }

      const clientKey = wi.ClientKey ?? null
      const clientType = wi.ClientType ?? null
      const clientName = wi.ClientName ?? null

      if (!clientKey) {
        resolutions.set(key, {
          work_key: key, clientKey, clientType, clientName,
          hubContactId: null, hubOrganizationId: null,
          status: "no_client_on_work_item",
          detail: "Karbon returned the work item but it carries no ClientKey",
        })
        continue
      }

      // ORGANIZATION WINS, per the firm's canonical rule (scripts/378).
      const { rows: orgs } = await db.query<{ id: string; name: string }>(
        `select id, name from public.organizations where karbon_organization_key = $1`,
        [clientKey],
      )
      const { rows: contacts } = await db.query<{ id: string; full_name: string }>(
        `select id, full_name from public.contacts where karbon_contact_key = $1`,
        [clientKey],
      )

      if (orgs.length + contacts.length === 0) {
        resolutions.set(key, {
          work_key: key, clientKey, clientType, clientName,
          hubContactId: null, hubOrganizationId: null,
          status: "not_in_hub",
          detail: `Karbon ClientKey ${clientKey} (${clientType} "${clientName}") has no Hub record — sync the client first`,
        })
        continue
      }
      if (orgs.length > 1 || contacts.length > 1) {
        resolutions.set(key, {
          work_key: key, clientKey, clientType, clientName,
          hubContactId: null, hubOrganizationId: null,
          status: "ambiguous",
          detail: `ClientKey matches ${orgs.length} organization(s) and ${contacts.length} contact(s) — duplicate Hub records need deduping`,
        })
        continue
      }

      resolutions.set(key, {
        work_key: key, clientKey, clientType, clientName,
        hubOrganizationId: orgs[0]?.id ?? null,
        hubContactId: orgs.length > 0 ? null : (contacts[0]?.id ?? null),
        status: "resolved",
        detail: orgs.length > 0 ? `ORG ${orgs[0].name}` : `CONTACT ${contacts[0].full_name}`,
      })
    }

    // ── 5. Report ─────────────────────────────────────────────────────────
    console.log("Resolution per work key:")
    for (const key of keys) {
      const r = resolutions.get(key)!
      console.log(`  ${key}  [${r.status}]  ${r.detail}`)
    }

    const linkable = rows.filter((r) => resolutions.get(r.work_key)?.status === "resolved")
    console.log(
      `\n${linkable.length} of ${rows.length} debrief(s) are linkable; ` +
        `${rows.length - linkable.length} need a human or a client sync.`,
    )

    if (!apply) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to link.")
      return
    }

    let linked = 0
    for (const row of linkable) {
      const r = resolutions.get(row.work_key)!
      const res = await db.query(
        `update public.debriefs
            set contact_id = $2, organization_id = $3
          where id = $1 and contact_id is null and organization_id is null
            and deleted_at is null`,
        [row.debrief_id, r.hubContactId, r.hubOrganizationId],
      )
      linked += res.rowCount ?? 0
    }
    console.log(`\n✓ Linked ${linked} debrief(s).`)
    console.log(
      "Now refresh the affected profiles — script 393, or the debrief-aggregate " +
        "block in it — so total_debriefs and last_debrief_* pick the new links up.",
    )
  } finally {
    await db.end()
  }
}

main().catch((e) => {
  console.error("ERR:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
