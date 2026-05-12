/**
 * Backfill `client_mapping.internal_client_id` for ProConnect Tax
 * clients by joining `proconnect_clients.email` to Supabase
 * `contacts.primary_email` / `contacts.secondary_email` /
 * `organizations.primary_email`.
 *
 * Mirrors scripts/match-ignition-clients-by-email.ts for consistency.
 * Key difference: ProConnect already tells us whether a client is a
 * PERSON or an ORGANIZATION via `client_type`, so we use that as the
 * primary routing signal instead of inferring it from the email match
 * alone:
 *
 *   - PERSON   → match against contacts (primary_email, then
 *                secondary_email). Skip if not exactly one hit.
 *   - ORGANIZATION → prefer organizations.primary_email. If no org
 *                hit, fall back to contacts (the "owner uses personal
 *                email for their LLC" pattern, which is very common
 *                for the firm's small-business book). The fallback
 *                gets recorded in match_notes so it's auditable.
 *
 * The proconnect_clients table is pre-populated by the OAuth sync
 * (11 rows at the time of writing), and `client_mapping` already has
 * 11 stub rows where proconnect_client_id is filled in but
 * internal_client_id is NULL — those are exactly what we update here.
 * If a stub row is missing (e.g. a brand-new pc client synced after
 * the stub-creation step), we insert. Both branches funnel through
 * the same uppercase enums (`PROCONNECT`, `PERSON|ORGANIZATION`)
 * required by the table's CHECK constraints.
 *
 * Default mode is DRY RUN — pass --apply to commit. Idempotent: the
 * filter `internal_client_id IS NULL` makes re-runs safe and means
 * any manual overrides a human operator made via the UI are not
 * silently clobbered.
 *
 * Usage:
 *   pnpm exec tsx scripts/match-proconnect-clients-by-email.ts          # dry run
 *   pnpm exec tsx scripts/match-proconnect-clients-by-email.ts --apply  # commit
 */

import pg from "pg"

const APPLY = process.argv.includes("--apply")

type ProconnectClient = {
  proconnect_client_id: string
  client_type: "PERSON" | "ORGANIZATION" | string
  client_state: string | null
  display_name: string | null
  business_name: string | null
  first_name: string | null
  last_name: string | null
  email: string | null
}

type Plan =
  | {
      kind: "match"
      pc: ProconnectClient
      match_kind: "contact" | "organization"
      // The Supabase row we'll link to.
      matched_id: string
      matched_label: string
      // Free-text explanation logged on the mapping row. Helpful when
      // the match looks weird (e.g. an org linked to a contact via
      // owner email).
      notes: string
    }
  | {
      kind: "skip"
      pc: ProconnectClient
      reason: string
    }

function fmt(p: ProconnectClient): string {
  return (
    p.business_name ||
    p.display_name ||
    [p.first_name, p.last_name].filter(Boolean).join(" ") ||
    "(unnamed)"
  )
}

// Cheap name-similarity guard for ORGANIZATION matches. Several
// orgs in the firm's book share a single admin email (e.g.
// dmartin@synergyrehabsolutions.com is the primary_email on 7
// different Synergy-related orgs). An exact email match in that
// situation produces a "unique" result that's semantically wrong —
// the email belongs to the human admin, not the org we're trying
// to match. We require at least one shared non-stopword token
// between the PC business_name and the candidate org name. The
// stopword list trims out the corporate suffix noise ("llc", "inc",
// "corp") so "Apex Claims LLC" still matches "Apex Claims" but
// "Alliance Physical Therapy LLC APT" does NOT match "Synergy
// Green River Building".
//
// PERSON matches do NOT need this guard — a personal email plus an
// exact-1 contact hit is already a strong signal, and the audit
// showed zero ambiguous person hits.
const ORG_NAME_STOPWORDS = new Set([
  "llc",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "limited",
  "lp",
  "llp",
  "pllc",
  "pc",
  "the",
  "and",
  "&",
  "of",
  "a",
  "an",
])
function orgNameTokens(name: string | null | undefined): Set<string> {
  if (!name) return new Set()
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !ORG_NAME_STOPWORDS.has(t)),
  )
}
function orgNamesPlausiblyMatch(
  pcName: string | null | undefined,
  candidateName: string | null | undefined,
): boolean {
  const a = orgNameTokens(pcName)
  const b = orgNameTokens(candidateName)
  if (a.size === 0 || b.size === 0) return true // give up, accept
  for (const t of a) if (b.has(t)) return true
  return false
}

async function main() {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
  if (!connectionString) {
    console.error(
      "POSTGRES_URL_NON_POOLING / POSTGRES_URL is not set. " +
        "Run with `node --env-file-if-exists=/vercel/share/.env.project` " +
        "or `set -a && source /vercel/share/.env.project && set +a`.",
    )
    process.exit(1)
  }

  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  })
  await client.connect()

  console.log(
    `[match-proconnect] mode = ${APPLY ? "APPLY (will commit)" : "DRY RUN"}`,
  )

  // Pull all proconnect clients with a non-empty email. There are
  // only ~11 right now so we don't bother batching — even 10k would
  // fit comfortably in memory and the join logic is per-row anyway.
  const { rows: pcRows } = await client.query<ProconnectClient>(`
    select
      proconnect_client_id,
      client_type,
      client_state,
      display_name,
      business_name,
      first_name,
      last_name,
      email
    from public.proconnect_clients
    where email is not null and trim(email) <> ''
    order by client_type, business_name nulls last, last_name nulls last
  `)

  console.log(`[match-proconnect] candidate rows: ${pcRows.length}`)

  const plans: Plan[] = []

  for (const pc of pcRows) {
    const email = pc.email!.trim().toLowerCase()
    const label = fmt(pc)

    if (pc.client_type === "PERSON") {
      // Lookup against contacts on primary, then secondary. We want
      // distinct contact IDs so a contact whose primary AND secondary
      // both equal `email` still counts as one match — DISTINCT here
      // protects against double-listed addresses.
      const { rows: hits } = await client.query<{
        id: string
        full_name: string | null
        primary_email: string | null
        secondary_email: string | null
      }>(
        `
        select distinct on (id) id, full_name, primary_email, secondary_email
        from public.contacts
        where lower(trim(primary_email)) = $1
           or lower(trim(secondary_email)) = $1
      `,
        [email],
      )
      if (hits.length === 0) {
        plans.push({
          kind: "skip",
          pc,
          reason: `PERSON / no contact with email ${email}`,
        })
      } else if (hits.length > 1) {
        plans.push({
          kind: "skip",
          pc,
          reason: `PERSON / ambiguous: ${hits.length} contacts share ${email}`,
        })
      } else {
        const h = hits[0]
        const which =
          h.primary_email?.toLowerCase().trim() === email
            ? "primary_email"
            : "secondary_email"
        plans.push({
          kind: "match",
          pc,
          match_kind: "contact",
          matched_id: h.id,
          matched_label: h.full_name ?? "(unnamed contact)",
          notes: `auto-matched via contacts.${which} (proconnect PERSON)`,
        })
      }
      continue
    }

    if (pc.client_type === "ORGANIZATION") {
      // Prefer org.primary_email. ProConnect organization clients
      // usually have the business's email here.
      const { rows: orgHits } = await client.query<{
        id: string
        name: string | null
      }>(
        `select id, name from public.organizations where lower(trim(primary_email)) = $1`,
        [email],
      )
      if (orgHits.length === 1) {
        // Name-similarity guard catches the "shared admin email"
        // false-positive (see orgNamesPlausiblyMatch). When it
        // trips we skip instead of matching, leaving the row for
        // manual resolution in the UI.
        if (
          !orgNamesPlausiblyMatch(pc.business_name || pc.display_name, orgHits[0].name)
        ) {
          plans.push({
            kind: "skip",
            pc,
            reason:
              `ORGANIZATION / email matches "${orgHits[0].name}" but no name tokens overlap with "${label}" ` +
              `(likely shared admin email — needs manual review)`,
          })
          continue
        }
        plans.push({
          kind: "match",
          pc,
          match_kind: "organization",
          matched_id: orgHits[0].id,
          matched_label: orgHits[0].name ?? "(unnamed org)",
          notes: `auto-matched via organizations.primary_email (proconnect ORGANIZATION)`,
        })
        continue
      }
      if (orgHits.length > 1) {
        plans.push({
          kind: "skip",
          pc,
          reason: `ORGANIZATION / ambiguous: ${orgHits.length} orgs share ${email}`,
        })
        continue
      }

      // No org match — fall back to contacts (the "owner uses their
      // personal email as the company email" pattern). When this
      // fires we deliberately link to a CONTACT row even though PC
      // considers this client a business, and we annotate the mapping
      // with notes so a human reviewing client_mapping later can see
      // why an ORGANIZATION-type PC client resolved to a person.
      const { rows: contactHits } = await client.query<{
        id: string
        full_name: string | null
      }>(
        `
        select distinct on (id) id, full_name
        from public.contacts
        where lower(trim(primary_email)) = $1
           or lower(trim(secondary_email)) = $1
      `,
        [email],
      )
      if (contactHits.length === 1) {
        plans.push({
          kind: "match",
          pc,
          match_kind: "contact",
          matched_id: contactHits[0].id,
          matched_label: contactHits[0].full_name ?? "(unnamed contact)",
          notes:
            `auto-matched via contacts (proconnect ORGANIZATION fallback: ` +
            `business "${label}" linked to owner contact via personal email)`,
        })
      } else if (contactHits.length === 0) {
        plans.push({
          kind: "skip",
          pc,
          reason: `ORGANIZATION / no org or contact for ${email}`,
        })
      } else {
        plans.push({
          kind: "skip",
          pc,
          reason: `ORGANIZATION / no org hit and ${contactHits.length} ambiguous contact hits for ${email}`,
        })
      }
      continue
    }

    plans.push({
      kind: "skip",
      pc,
      reason: `unknown client_type ${pc.client_type}`,
    })
  }

  // ── Plan summary ─────────────────────────────────────────────────────
  const matches = plans.filter((p): p is Extract<Plan, { kind: "match" }> => p.kind === "match")
  const skips = plans.filter((p): p is Extract<Plan, { kind: "skip" }> => p.kind === "skip")
  const matchedToContacts = matches.filter((m) => m.match_kind === "contact").length
  const matchedToOrgs = matches.filter((m) => m.match_kind === "organization").length

  console.log()
  console.log("=== Plan ===")
  console.log(`  matches: ${matches.length}`)
  console.log(`    -> contacts:      ${matchedToContacts}`)
  console.log(`    -> organizations: ${matchedToOrgs}`)
  console.log(`  skipped: ${skips.length}`)
  console.log()
  console.log("=== Sample matches ===")
  for (const m of matches.slice(0, 20)) {
    console.log(
      `  ${m.pc.client_type.padEnd(13)} ${fmt(m.pc).padEnd(36)} ${m.pc.email!.padEnd(40)} -> ${m.match_kind.padEnd(13)} ${m.matched_label}`,
    )
  }
  if (skips.length) {
    console.log()
    console.log("=== Skips ===")
    for (const s of skips.slice(0, 20)) {
      console.log(`  ${fmt(s.pc).padEnd(36)} ${s.reason}`)
    }
  }

  if (!APPLY) {
    console.log()
    console.log("[match-proconnect] DRY RUN — no rows changed. Re-run with --apply to commit.")
    await client.end()
    return
  }

  // ── Apply, single transaction ────────────────────────────────────────
  // We rely on the existing stub rows in client_mapping (one per
  // proconnect_client_id with internal_client_id IS NULL) created by
  // the OAuth sync. The `where internal_client_id is null` guard
  // keeps re-runs idempotent AND prevents this script from quietly
  // overwriting a manual override.
  await client.query("BEGIN")
  try {
    let updated = 0
    let inserted = 0
    for (const m of matches) {
      const mappingType = m.match_kind === "contact" ? "PERSON" : "ORGANIZATION"

      const upd = await client.query(
        `
        update public.client_mapping
        set internal_client_id = $1::uuid,
            source_system      = 'PROCONNECT',
            client_type        = $2,
            updated_at         = now()
        where proconnect_client_id = $3
          and internal_client_id is null
        returning id
        `,
        [m.matched_id, mappingType, m.pc.proconnect_client_id],
      )
      if (upd.rowCount && upd.rowCount > 0) {
        updated += upd.rowCount
        continue
      }

      // No stub existed (or all existing rows already had a different
      // internal_client_id set). Check whether the (proconnect_id,
      // internal_id) pair is already mapped before inserting so we
      // don't create a duplicate row.
      const existing = await client.query(
        `
        select id from public.client_mapping
        where proconnect_client_id = $1
          and internal_client_id = $2::uuid
        limit 1
        `,
        [m.pc.proconnect_client_id, m.matched_id],
      )
      if (existing.rowCount === 0) {
        await client.query(
          `
          insert into public.client_mapping
            (internal_client_id, proconnect_client_id, source_system, client_type, created_at, updated_at)
          values ($1::uuid, $2, 'PROCONNECT', $3, now(), now())
          `,
          [m.matched_id, m.pc.proconnect_client_id, mappingType],
        )
        inserted += 1
      }
    }

    await client.query("COMMIT")
    console.log()
    console.log(`[match-proconnect] committed: ${updated} updated, ${inserted} inserted`)
  } catch (e) {
    await client.query("ROLLBACK")
    console.error("[match-proconnect] transaction failed, rolled back:", e)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error("[match-proconnect] fatal:", e)
  process.exit(1)
})
