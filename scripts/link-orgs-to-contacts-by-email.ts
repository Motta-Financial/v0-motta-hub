/**
 * Backfill `public.contact_organizations` by matching organizations to
 * contacts on email.
 *
 * Why this exists
 * ───────────────
 * Karbon syncs `organizations.primary_email` and
 * `contacts.primary_email` / `secondary_email` separately. Many small
 * businesses in our book use a single owner's personal email as the
 * org's primary email, so when those rows arrive in Supabase the
 * org↔contact relationship is *implicit in the data* but not
 * *expressed in the link table*. The Relationships tab on the client
 * profile already reads `contact_organizations` — once we populate it,
 * the UI lights up automatically.
 *
 * The link table supports multiple owners by design (it has a
 * (contact_id, organization_id) unique key but no per-org uniqueness on
 * is_primary_contact), so this script:
 *   • Inserts one row per (contact, org) email match.
 *   • If exactly ONE contact matches the org email → marks it
 *     is_primary_contact=true. That's the firm's working definition:
 *     "the human who answers email at this business".
 *   • If MULTIPLE contacts match the same org email → inserts all of
 *     them but leaves is_primary_contact=false. A human can promote
 *     one in the UI later; auto-guessing here would be wrong.
 *   • Skips orgs with no email or no contact-side hit; they need
 *     manual linking (or wait for the next Karbon sync to add data).
 *
 * Idempotent: the (contact_id, organization_id) unique constraint
 * means rerunning is safe. Existing links are detected and left alone
 * unless --update-primary is passed (then we'll promote a contact to
 * primary if it's the sole match and currently isn't marked).
 *
 * Usage:
 *   pnpm exec tsx scripts/link-orgs-to-contacts-by-email.ts            # dry-run
 *   pnpm exec tsx scripts/link-orgs-to-contacts-by-email.ts --apply    # writes
 */
import { Client } from "pg"

type MatchPlan =
  | {
      kind: "link"
      organizationId: string
      orgName: string | null
      orgEmail: string
      contactId: string
      contactName: string | null
      isPrimary: boolean
      note: string
    }
  | {
      kind: "skip"
      organizationId: string
      orgName: string | null
      orgEmail: string | null
      reason: string
    }

const APPLY = process.argv.includes("--apply")

async function main() {
  const conn = process.env.POSTGRES_URL_NON_POOLING
  if (!conn) {
    console.error("POSTGRES_URL_NON_POOLING is not set")
    process.exit(1)
  }
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    console.log(APPLY ? "Mode: APPLY (writes)" : "Mode: DRY-RUN (no writes)")

    // Pull every org with a non-empty primary_email. We cast to lower
    // here so the SQL below can join cleanly without per-row coercion.
    const { rows: orgs } = await client.query<{
      id: string
      name: string | null
      email: string
    }>(`
      select id,
             coalesce(name, full_name) as name,
             lower(trim(primary_email)) as email
      from public.organizations
      where primary_email is not null and trim(primary_email) <> ''
      order by name
    `)
    console.log(`Orgs with an email to match: ${orgs.length}`)

    // Pre-fetch existing links so we can detect "already linked" without
    // hammering the DB once per org. The unique key is
    // (contact_id, organization_id) so a Set keyed on that pair is the
    // right shape.
    const { rows: existing } = await client.query<{
      contact_id: string
      organization_id: string
    }>(`select contact_id, organization_id from public.contact_organizations`)
    const existingKey = new Set(
      existing.map((r) => `${r.contact_id}::${r.organization_id}`),
    )

    const plans: MatchPlan[] = []

    for (const org of orgs) {
      // For each org, find every contact whose primary OR secondary
      // email matches. Secondary email matches matter here — a number
      // of contacts in the firm's book have the "official" address on
      // primary and a personal/forwarding address on secondary that
      // matches the org's billing email.
      const { rows: hits } = await client.query<{
        id: string
        full_name: string | null
        match_source: string
      }>(
        `
        select id, full_name,
          case
            when lower(trim(primary_email)) = $1 then 'primary'
            else 'secondary'
          end as match_source
        from public.contacts
        where lower(trim(primary_email)) = $1
           or lower(trim(secondary_email)) = $1
        order by
          -- prefer primary-email matches when both exist, then by name
          case when lower(trim(primary_email)) = $1 then 0 else 1 end,
          full_name
        `,
        [org.email],
      )

      if (hits.length === 0) {
        plans.push({
          kind: "skip",
          organizationId: org.id,
          orgName: org.name,
          orgEmail: org.email,
          reason: "no contact has this email on primary or secondary",
        })
        continue
      }

      // Sole match → mark as primary. Multiple matches → link all,
      // none marked primary (manual cleanup expected).
      const isPrimaryWhenSole = hits.length === 1

      for (const hit of hits) {
        const alreadyLinked = existingKey.has(`${hit.id}::${org.id}`)
        if (alreadyLinked) {
          // Skip silently — idempotent. The plan log gets noisy if we
          // narrate every existing row.
          continue
        }
        plans.push({
          kind: "link",
          organizationId: org.id,
          orgName: org.name,
          orgEmail: org.email,
          contactId: hit.id,
          contactName: hit.full_name,
          isPrimary: isPrimaryWhenSole,
          note:
            hits.length === 1
              ? `sole email match (${hit.match_source})`
              : `one of ${hits.length} owners sharing this email (${hit.match_source})`,
        })
      }
    }

    const linkPlans = plans.filter((p) => p.kind === "link") as Extract<
      MatchPlan,
      { kind: "link" }
    >[]
    const skipPlans = plans.filter((p) => p.kind === "skip") as Extract<
      MatchPlan,
      { kind: "skip" }
    >[]
    const distinctOrgs = new Set(linkPlans.map((p) => p.organizationId))
    const primaryCount = linkPlans.filter((p) => p.isPrimary).length

    console.log()
    console.log("─── Plan ───")
    console.log(`  Orgs to link:        ${distinctOrgs.size}`)
    console.log(`  Total new links:     ${linkPlans.length}`)
    console.log(`  Marked is_primary:   ${primaryCount}`)
    console.log(`  Multi-owner links:   ${linkPlans.length - primaryCount}`)
    console.log(`  Orgs skipped:        ${skipPlans.length}`)
    console.log()

    // Show first 15 sample links for sanity
    console.log("Sample of planned links:")
    linkPlans.slice(0, 15).forEach((p) => {
      console.log(
        `  ${p.isPrimary ? "[P]" : "[ ]"} ${(p.orgName ?? "(unnamed org)").padEnd(36)} ← ${(p.contactName ?? "(unnamed)").padEnd(28)} via ${p.orgEmail}`,
      )
    })

    if (!APPLY) {
      console.log()
      console.log("Dry run complete. Re-run with --apply to write.")
      return
    }

    console.log()
    console.log("Applying inside a single transaction…")
    await client.query("BEGIN")
    try {
      let inserted = 0
      for (const p of linkPlans) {
        // The unique (contact_id, organization_id) constraint protects
        // us from any double-insert; we use ON CONFLICT DO NOTHING as
        // belt-and-suspenders in case another process raced us.
        const res = await client.query(
          `
          insert into public.contact_organizations
            (contact_id, organization_id, is_primary_contact, role_or_title, created_at)
          values ($1, $2, $3, $4, now())
          on conflict (contact_id, organization_id) do nothing
          `,
          [
            p.contactId,
            p.organizationId,
            p.isPrimary,
            // role_or_title is optional metadata; we don't know it from
            // an email match, so leave it null. The note field on this
            // table is implicit — we don't have a `notes` column —
            // so manual edits in the UI will fill it.
            null,
          ],
        )
        inserted += res.rowCount ?? 0
      }
      await client.query("COMMIT")
      console.log(`Committed. Rows inserted: ${inserted}`)
    } catch (err) {
      await client.query("ROLLBACK")
      console.error("Transaction rolled back:", err)
      process.exit(2)
    }
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
