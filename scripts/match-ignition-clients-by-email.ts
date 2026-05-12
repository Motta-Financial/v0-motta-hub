/**
 * scripts/match-ignition-clients-by-email.ts
 *
 * Backfill matcher for ignition_clients rows that the sync's auto-matcher
 * left in `unmatched` state but whose `email` column is an exact (case-
 * insensitive, trimmed) match to a `contacts.primary_email`,
 * `contacts.secondary_email`, or `organizations.primary_email`.
 *
 * Why this exists: a stats audit on 559 ignition rows found 279 still
 * `unmatched`, 218 of those carry an email, and 221 of those emails resolve
 * uniquely to a single contact / 61 uniquely to a single organization.
 * The original sync matcher missed them (likely sensitive to whitespace /
 * casing / mixed-source ID prefixes after the Zapier→Reporting API cutover).
 *
 * Matching rules (in priority order; first hit wins):
 *   1. contacts.primary_email
 *   2. contacts.secondary_email
 *   3. organizations.primary_email
 * All comparisons are `lower(trim(email))`. If a given email hits MORE THAN
 * ONE distinct contact or organization, the row is treated as ambiguous and
 * skipped — we never silently merge two clients onto one entity. (An
 * ignition row whose email is shared by several other ignition rows is NOT
 * ambiguous from this script's perspective; the dedupe is on the
 * *contacts/organizations* side.)
 *
 * For each matched ignition row we:
 *   1. Update `ignition_clients` with contact_id / organization_id +
 *      match_status='auto_matched' + match_method='email' +
 *      match_confidence=0.85 + match_notes (timestamped).
 *      0.85 is the same confidence the live auto-matcher uses for
 *      `match_method='email'`, so this backfill is indistinguishable from
 *      a fresh sync-time match.
 *   2. Cascade the FK onto ignition_proposals, ignition_invoices,
 *      ignition_payments — but only on rows whose contact_id /
 *      organization_id is currently NULL, so we never clobber a downstream
 *      override that came from a more specific signal.
 *   3. Upsert into client_mapping so the master cross-system mapping table
 *      gets an internal_client_id ↔ ignition_client_id row. We key the
 *      upsert on `ignition_client_id` (treated as a soft unique within the
 *      ignition source_system).
 *
 * All writes happen inside a single transaction. --report (default) does
 * a dry run that prints the planned counts and a sample. --apply commits.
 *
 *   pnpm exec tsx scripts/match-ignition-clients-by-email.ts            # dry run
 *   pnpm exec tsx scripts/match-ignition-clients-by-email.ts --apply    # commit
 */

import pg from "pg"

const MODE: "report" | "apply" = process.argv.includes("--apply") ? "apply" : "report"

const conn = process.env.POSTGRES_URL_NON_POOLING
if (!conn) {
  console.error("POSTGRES_URL_NON_POOLING not set")
  process.exit(1)
}

// One client, one transaction — same pattern as scripts/reconcile-ignition-ids.ts.
const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })

type ResolvedMatch = {
  ignition_client_id: string
  ignition_name: string | null
  ignition_email: string
  match_kind: "contact" | "organization"
  matched_id: string
  matched_display: string | null
  source_column: "contacts.primary_email" | "contacts.secondary_email" | "organizations.primary_email"
}

type Skipped = {
  ignition_client_id: string
  email: string
  reason: "ambiguous_contact" | "ambiguous_organization" | "no_hit"
  hit_count?: number
}

async function main(): Promise<void> {
  await client.connect()
  console.log(`\n=== Ignition email-match backfill (${MODE.toUpperCase()}) ===\n`)

  if (MODE === "apply") {
    await client.query("BEGIN")
  }

  try {
    const { matches, skipped, totalCandidates } = await resolveMatches()

    // Bucket counts for the summary
    const byKind = { contact: 0, organization: 0 }
    const bySource: Record<ResolvedMatch["source_column"], number> = {
      "contacts.primary_email": 0,
      "contacts.secondary_email": 0,
      "organizations.primary_email": 0,
    }
    for (const m of matches) {
      byKind[m.match_kind]++
      bySource[m.source_column]++
    }
    const skippedByReason = { ambiguous_contact: 0, ambiguous_organization: 0, no_hit: 0 }
    for (const s of skipped) skippedByReason[s.reason]++

    console.log(`Unmatched ignition_clients with an email:  ${totalCandidates}`)
    console.log(`  Resolvable (will be matched):            ${matches.length}`)
    console.log(`    → contacts.primary_email:              ${bySource["contacts.primary_email"]}`)
    console.log(`    → contacts.secondary_email:            ${bySource["contacts.secondary_email"]}`)
    console.log(`    → organizations.primary_email:         ${bySource["organizations.primary_email"]}`)
    console.log(`    (contact matches: ${byKind.contact}, organization matches: ${byKind.organization})`)
    console.log(`  Skipped:                                 ${skipped.length}`)
    console.log(`    → ambiguous contact email:             ${skippedByReason.ambiguous_contact}`)
    console.log(`    → ambiguous organization email:        ${skippedByReason.ambiguous_organization}`)
    console.log(`    → no contact or organization hit:      ${skippedByReason.no_hit}`)
    console.log()

    if (matches.length > 0) {
      console.log("Sample of matches that will be applied:")
      for (const m of matches.slice(0, 8)) {
        console.log(
          `  [${m.match_kind.padEnd(12)}] ${m.ignition_email.padEnd(38)} → ${m.matched_display || m.matched_id} (${m.source_column})`,
        )
      }
      console.log()
    }

    if (skipped.length > 0 && skipped.some((s) => s.reason !== "no_hit")) {
      console.log("Sample of ambiguous rows (skipped — left as unmatched):")
      for (const s of skipped.filter((x) => x.reason !== "no_hit").slice(0, 5)) {
        console.log(`  [${s.reason}] ${s.email.padEnd(40)} hits=${s.hit_count}`)
      }
      console.log()
    }

    if (MODE !== "apply") {
      console.log("Dry-run only. Re-run with --apply to commit inside a single transaction.")
      await client.end()
      return
    }

    // -------- apply --------
    let proposalCascades = 0
    let invoiceCascades = 0
    let paymentCascades = 0
    let mappingUpserts = 0

    for (const m of matches) {
      // 1. update the ignition_clients row itself
      await client.query(
        `
        update public.ignition_clients
        set
          contact_id      = case when $2 = 'contact'      then $3::uuid else contact_id end,
          organization_id = case when $2 = 'organization' then $3::uuid else organization_id end,
          match_status    = 'auto_matched',
          match_method    = 'email',
          match_confidence = 0.85,
          match_notes     = coalesce(match_notes || E'\\n', '') ||
                            'auto-matched by email-backfill script on ' || now()::text,
          updated_at      = now()
        where ignition_client_id = $1
        `,
        [m.ignition_client_id, m.match_kind, m.matched_id],
      )

      // 2. cascade FK to downstream tables, only where currently null —
      //    we don't want to overwrite a more specific manual override.
      const fkCol = m.match_kind === "contact" ? "contact_id" : "organization_id"
      const proposalRes = await client.query(
        `update public.ignition_proposals set ${fkCol} = $1::uuid
         where ignition_client_id = $2 and ${fkCol} is null`,
        [m.matched_id, m.ignition_client_id],
      )
      proposalCascades += proposalRes.rowCount ?? 0

      const invoiceRes = await client.query(
        `update public.ignition_invoices set ${fkCol} = $1::uuid
         where ignition_client_id = $2 and ${fkCol} is null`,
        [m.matched_id, m.ignition_client_id],
      )
      invoiceCascades += invoiceRes.rowCount ?? 0

      const paymentRes = await client.query(
        `update public.ignition_payments set ${fkCol} = $1::uuid
         where ignition_client_id = $2 and ${fkCol} is null`,
        [m.matched_id, m.ignition_client_id],
      )
      paymentCascades += paymentRes.rowCount ?? 0

      // 3. master mapping upsert. client_mapping has no enforced unique
      //    constraint on ignition_client_id, so we DIY the upsert via an
      //    explicit existence check inside the same txn.
      //
      // NOTE: client_mapping.client_type has a CHECK constraint that
      // only allows 'PERSON' or 'ORGANIZATION' (uppercase). Our internal
      // match_kind is 'contact' | 'organization' so we translate here.
      // Getting this wrong silently rolls back the whole transaction,
      // which is exactly how we caught it the first time.
      const mappingClientType =
        m.match_kind === "contact" ? "PERSON" : "ORGANIZATION"
      const existing = await client.query(
        `select id from public.client_mapping where ignition_client_id = $1 limit 1`,
        [m.ignition_client_id],
      )
      // source_system has a CHECK constraint too: only uppercase
      // 'PROCONNECT' | 'KARBON' | 'IGNITION' | 'MANUAL' are accepted.
      if (existing.rowCount === 0) {
        await client.query(
          `
          insert into public.client_mapping
            (internal_client_id, ignition_client_id, source_system, client_type, created_at, updated_at)
          values ($1::uuid, $2, 'IGNITION', $3, now(), now())
          `,
          [m.matched_id, m.ignition_client_id, mappingClientType],
        )
      } else {
        await client.query(
          `
          update public.client_mapping
          set internal_client_id = $1::uuid,
              source_system      = 'IGNITION',
              client_type        = $2,
              updated_at         = now()
          where ignition_client_id = $3
          `,
          [m.matched_id, mappingClientType, m.ignition_client_id],
        )
      }
      mappingUpserts++
    }

    await client.query("COMMIT")
    console.log(`Committed.`)
    console.log(`  ignition_clients matched:           ${matches.length}`)
    console.log(`  ignition_proposals FK cascades:     ${proposalCascades}`)
    console.log(`  ignition_invoices FK cascades:      ${invoiceCascades}`)
    console.log(`  ignition_payments FK cascades:      ${paymentCascades}`)
    console.log(`  client_mapping rows upserted:       ${mappingUpserts}`)
  } catch (err) {
    if (MODE === "apply") {
      await client.query("ROLLBACK")
      console.error("\nRolled back. No changes applied.")
    }
    throw err
  } finally {
    await client.end()
  }
}

/**
 * Single SQL pass that resolves every unmatched-with-email ignition client
 * to one of {unique contact hit, unique organization hit, ambiguous, no hit}.
 *
 * Doing it in one query (rather than a loop of N round-trips) keeps the
 * read phase under a second on the full 279-row backlog and makes the
 * ambiguity check trivially correct via count(*) over the join.
 */
async function resolveMatches(): Promise<{
  matches: ResolvedMatch[]
  skipped: Skipped[]
  totalCandidates: number
}> {
  const sql = `
    with unmatched as (
      select
        ic.ignition_client_id,
        ic.name as ignition_name,
        lower(trim(ic.email)) as email_norm,
        ic.email as email_raw
      from public.ignition_clients ic
      where (ic.match_status is null or ic.match_status = 'unmatched')
        and ic.email is not null
        and trim(ic.email) <> ''
    ),
    -- Hit count per email for each candidate source, used to detect ambiguity.
    contact_primary as (
      select u.ignition_client_id, count(distinct c.id) as hits,
             max(c.id::text) as one_id, max(c.full_name) as one_display
      from unmatched u
      join public.contacts c on lower(trim(c.primary_email)) = u.email_norm
      group by u.ignition_client_id
    ),
    contact_secondary as (
      select u.ignition_client_id, count(distinct c.id) as hits,
             max(c.id::text) as one_id, max(c.full_name) as one_display
      from unmatched u
      join public.contacts c on lower(trim(c.secondary_email)) = u.email_norm
      group by u.ignition_client_id
    ),
    org_primary as (
      select u.ignition_client_id, count(distinct o.id) as hits,
             max(o.id::text) as one_id, max(o.name) as one_display
      from unmatched u
      join public.organizations o on lower(trim(o.primary_email)) = u.email_norm
      group by u.ignition_client_id
    )
    select
      u.ignition_client_id,
      u.ignition_name,
      u.email_raw,
      coalesce(cp.hits, 0) as cp_hits, cp.one_id as cp_id, cp.one_display as cp_display,
      coalesce(cs.hits, 0) as cs_hits, cs.one_id as cs_id, cs.one_display as cs_display,
      coalesce(op.hits, 0) as op_hits, op.one_id as op_id, op.one_display as op_display
    from unmatched u
    left join contact_primary cp on cp.ignition_client_id = u.ignition_client_id
    left join contact_secondary cs on cs.ignition_client_id = u.ignition_client_id
    left join org_primary op on op.ignition_client_id = u.ignition_client_id
    order by u.ignition_client_id
  `
  const res = await client.query(sql)

  const matches: ResolvedMatch[] = []
  const skipped: Skipped[] = []

  for (const r of res.rows) {
    const cp = Number(r.cp_hits)
    const cs = Number(r.cs_hits)
    const op = Number(r.op_hits)

    // Priority order: contact primary → contact secondary → org primary.
    // We short-circuit on ambiguity at the first level we hit, otherwise
    // we'd silently promote a multi-hit primary into a single-hit
    // secondary and pick the wrong contact.
    if (cp === 1) {
      matches.push({
        ignition_client_id: r.ignition_client_id,
        ignition_name: r.ignition_name,
        ignition_email: r.email_raw,
        match_kind: "contact",
        matched_id: r.cp_id,
        matched_display: r.cp_display,
        source_column: "contacts.primary_email",
      })
    } else if (cp > 1) {
      skipped.push({
        ignition_client_id: r.ignition_client_id,
        email: r.email_raw,
        reason: "ambiguous_contact",
        hit_count: cp,
      })
    } else if (cs === 1) {
      matches.push({
        ignition_client_id: r.ignition_client_id,
        ignition_name: r.ignition_name,
        ignition_email: r.email_raw,
        match_kind: "contact",
        matched_id: r.cs_id,
        matched_display: r.cs_display,
        source_column: "contacts.secondary_email",
      })
    } else if (cs > 1) {
      skipped.push({
        ignition_client_id: r.ignition_client_id,
        email: r.email_raw,
        reason: "ambiguous_contact",
        hit_count: cs,
      })
    } else if (op === 1) {
      matches.push({
        ignition_client_id: r.ignition_client_id,
        ignition_name: r.ignition_name,
        ignition_email: r.email_raw,
        match_kind: "organization",
        matched_id: r.op_id,
        matched_display: r.op_display,
        source_column: "organizations.primary_email",
      })
    } else if (op > 1) {
      skipped.push({
        ignition_client_id: r.ignition_client_id,
        email: r.email_raw,
        reason: "ambiguous_organization",
        hit_count: op,
      })
    } else {
      skipped.push({
        ignition_client_id: r.ignition_client_id,
        email: r.email_raw,
        reason: "no_hit",
      })
    }
  }

  return { matches, skipped, totalCandidates: res.rowCount ?? 0 }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
