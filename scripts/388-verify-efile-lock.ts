/**
 * 388-verify-efile-lock.ts
 *
 * Replays the post-e-file edit lock predicate (lib/proconnect/efile-lock)
 * over every engagement in the DB, and over a table of hand-built payloads
 * covering the cases live data does not contain.
 *
 * This repo has no test runner, so this script IS the test. Run it after
 * touching the predicate, and after any change to how e-file status is
 * hydrated. What it is really guarding:
 *
 *   - An accepted Form 4868 must NOT lock the return it extends. This is
 *     the case the tax partner caught in review, and it is not rare: 66 of
 *     919 engagements were in that state on 2026-08-11, nearly all of them
 *     TY2025 1040s still being worked.
 *   - A return accepted and then re-transmitted into a rejection must stay
 *     locked. The headline status reports the rejection because it is newer.
 *   - Every unfiled return must stay editable. If this script ever reports
 *     a locked engagement with no filings, the predicate has inverted and
 *     the firm's in-progress work is frozen.
 *
 * Usage (repo root; needs .env.local — `vercel env pull .env.local`):
 *   npx tsx scripts/388-verify-efile-lock.ts            # cases + live corpus
 *   npx tsx scripts/388-verify-efile-lock.ts --cases    # cases only, no DB
 *   npx tsx scripts/388-verify-efile-lock.ts --explain <engagementId>
 *
 * Read-only. Touches Supabase with SELECTs and never calls ProConnect.
 */
import { existsSync, readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
import {
  evaluateEfileLock,
  isReturnFiling,
  ACCEPTED_STATUS,
  type LockCode,
} from "../lib/proconnect/efile-lock"
import type { RawFiling, RawTaxFiling } from "../lib/proconnect/sync"

// ── env ──────────────────────────────────────────────────────────────────
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────
// Timestamps are deliberately NOT in chronological array order, because the
// live payload isn't either (1,505 of 2,383 filings, 2026-08-11).

const st = (status: string, ts: string) => ({ status, statusUpdateTimestamp: ts })

const filing = (
  filingId: string,
  filingType: string,
  statuses: Array<{ status: string; statusUpdateTimestamp: string }>,
  extra: Partial<RawFiling> = {},
): RawFiling => ({
  filingType,
  filingLevel: filingId.split(".")[1] === "us" ? "flFederal" : "flState",
  filingKey: { filingId, instance: "" },
  filingStatuses: statuses,
  ...extra,
})

const tf = (...filings: RawFiling[]): RawTaxFiling => ({ filings })

interface Case {
  name: string
  payload: RawTaxFiling | null | undefined
  locked: boolean
  code: LockCode
}

const CASES: Case[] = [
  {
    name: "in-progress return, nothing filed",
    payload: tf(filing("ind.us", "REGULAR", [])),
    locked: false,
    code: "not_filed",
  },
  {
    name: "no taxFiling at all (hydrated, nothing filed)",
    payload: null,
    locked: false,
    code: "not_filed",
  },
  {
    name: "THE CASE: 4868 accepted, return never transmitted",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      filing("ind.us.ext", "EXTENSION", [
        st("ACK_SUCCEEDED", "2026-04-14T18:20:25Z"),
        st("PENDING_EFE", "2026-04-14T17:02:00Z"),
      ]),
    ),
    locked: false,
    code: "extension_only",
  },
  {
    name: "extension nested as a child of the return filing",
    payload: tf(
      filing("ind.us", "REGULAR", [], {
        children: [
          filing("ind.us.ext", "EXTENSION", [st("ACK_SUCCEEDED", "2026-04-14T18:20:25Z")]),
        ],
      }),
    ),
    locked: false,
    code: "extension_only",
  },
  {
    name: "return accepted",
    payload: tf(
      filing("ind.us", "REGULAR", [
        st("ACK_SUCCEEDED", "2026-03-02T11:00:00Z"),
        st("PENDING_AGENCY", "2026-03-01T09:00:00Z"),
        st("PENDING_EFE", "2026-02-28T22:00:00Z"),
      ]),
    ),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "return accepted, with the acceptance FIRST in the array",
    payload: tf(
      filing("ind.us", "REGULAR", [
        st("ACK_SUCCEEDED", "2026-03-02T11:00:00Z"),
        st("PENDING_EFE", "2026-02-28T22:00:00Z"),
      ]),
    ),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "return rejected — stays editable so it can be fixed",
    payload: tf(
      filing("ind.us", "REGULAR", [
        st("PENDING_EFE", "2026-03-01T09:00:00Z"),
        st("ACK_REJECTED", "2026-03-02T11:00:00Z"),
      ]),
    ),
    locked: false,
    code: "return_not_accepted",
  },
  {
    name: "return transmitted, awaiting the agency — still editable",
    payload: tf(filing("ind.us", "REGULAR", [st("PENDING_AGENCY", "2026-03-01T09:00:00Z")])),
    locked: false,
    code: "return_not_accepted",
  },
  {
    name: "accepted, then a later re-transmission rejected — stays locked",
    payload: tf(
      filing("ind.us", "REGULAR", [st("ACK_SUCCEEDED", "2026-03-02T11:00:00Z")]),
      filing("ind.us", "REGULAR", [st("ACK_REJECTED", "2026-06-02T11:00:00Z")]),
    ),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "state return accepted, federal not yet filed",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      filing("ind.ma", "REGULAR", [st("ACK_SUCCEEDED", "2026-03-05T11:00:00Z")]),
    ),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "FBAR accepted — a separate FinCEN filing, does not lock the 1040",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      filing("ind.us.fbar", "REGULAR", [st("ACK_SUCCEEDED", "2026-04-01T11:00:00Z")]),
    ),
    locked: false,
    code: "extension_only",
  },
  {
    name: "amended return accepted — locks (safe direction; see handoff)",
    payload: tf(filing("ind.us.amd", "AMENDED", [st("ACK_SUCCEEDED", "2026-09-01T11:00:00Z")])),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "unrecognized status on the return — fails closed",
    payload: tf(filing("ind.us", "REGULAR", [st("ACK_CONDITIONAL", "2026-03-02T11:00:00Z")])),
    locked: true,
    code: "unrecognized_status",
  },
  {
    name: "unrecognized status on an EXTENSION — does not lock the return",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      filing("ind.us.ext", "EXTENSION", [st("ACK_CONDITIONAL", "2026-03-02T11:00:00Z")]),
    ),
    locked: false,
    code: "extension_only",
  },
  {
    name: "unknown filing kind reporting acceptance — fails closed",
    payload: tf(filing("ind.us.newthing", "REGULAR", [st(ACCEPTED_STATUS, "2026-03-02T11:00:00Z")])),
    locked: true,
    code: "return_accepted",
  },
  {
    name: "filingType absent, filingId says extension",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      { filingKey: { filingId: "ind.us.ext" }, filingStatuses: [st(ACCEPTED_STATUS, "2026-04-14T18:20:25Z")] },
    ),
    locked: false,
    code: "extension_only",
  },
  {
    name: "filingId absent, filingType says extension",
    payload: tf(
      filing("ind.us", "REGULAR", []),
      { filingType: "EXTENSION", filingStatuses: [st(ACCEPTED_STATUS, "2026-04-14T18:20:25Z")] },
    ),
    locked: false,
    code: "extension_only",
  },
]

function runCases(): number {
  let failed = 0
  console.log("─── fixtures ───────────────────────────────────────────────")
  for (const c of CASES) {
    const d = evaluateEfileLock(c.payload)
    const ok = d.locked === c.locked && d.code === c.code
    if (!ok) failed++
    console.log(
      `${ok ? "  ok  " : "  FAIL"}  ${c.name}\n` +
        `          expected ${c.locked ? "LOCKED" : "open  "} / ${c.code}\n` +
        `          got      ${d.locked ? "LOCKED" : "open  "} / ${d.code}`,
    )
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} fixtures passed`)
  return failed
}

// ── live corpus ──────────────────────────────────────────────────────────

function sb() {
  return createClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

type Row = {
  engagement_id: string
  tax_year: number | null
  return_type: string | null
  efile_status: string | null
  efile_synced_at: string | null
  efile_filings: RawTaxFiling | null
}

async function runLive() {
  const { data, error } = await sb()
    .from("proconnect_engagements")
    .select("engagement_id, tax_year, return_type, efile_status, efile_synced_at, efile_filings")
    .limit(5000)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Row[]

  const byCode = new Map<string, number>()
  let locked = 0
  let naiveLocked = 0
  const falseLocks: Row[] = []   // naive locks, predicate does not
  const missedLocks: Row[] = []  // predicate locks, naive does not
  const suspicious: string[] = []

  for (const r of rows) {
    const d = evaluateEfileLock(r.efile_filings)
    byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1)
    if (d.locked) locked++

    const naive = r.efile_status === ACCEPTED_STATUS
    if (naive) naiveLocked++
    if (naive && !d.locked) falseLocks.push(r)
    if (!naive && d.locked) missedLocks.push(r)

    // Invariants. A violation here is a bug, not a data quirk.
    const filings = (r.efile_filings?.filings ?? [])
    const flat = (fs: RawFiling[]): RawFiling[] => fs.flatMap((f) => [f, ...flat(f.children ?? [])])
    const all = flat(filings)
    if (d.locked && all.length === 0 && d.code !== "never_hydrated") {
      suspicious.push(`${r.engagement_id}: locked with zero filings (${d.code})`)
    }
    if (
      !d.locked &&
      all.some((f) => isReturnFiling(f) && (f.filingStatuses ?? []).some((s) => s.status === ACCEPTED_STATUS))
    ) {
      suspicious.push(`${r.engagement_id}: UNLOCKED despite an accepted return filing`)
    }
  }

  console.log("\n─── live corpus ────────────────────────────────────────────")
  console.log(`engagements: ${rows.length}`)
  console.log(`  locked by the predicate:              ${locked}`)
  console.log(`  locked by naive efile_status check:   ${naiveLocked}`)
  console.log(`  naive over-locks (extension-only):    ${falseLocks.length}`)
  console.log(`  naive under-locks (accepted, headline says otherwise): ${missedLocks.length}`)
  console.log("\nverdicts:")
  for (const [code, n] of [...byCode].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${code}`)
  }

  const brief = (r: Row) =>
    `  ${r.engagement_id} TY${r.tax_year} ${r.return_type ?? "?"} headline=${r.efile_status}`
  if (falseLocks.length) {
    console.log("\nreturns the naive check would have frozen (sample):")
    falseLocks.slice(0, 8).forEach((r) => console.log(brief(r)))
  }
  if (missedLocks.length) {
    console.log("\nfiled returns the naive check would have left editable:")
    missedLocks.forEach((r) => console.log(brief(r)))
  }

  console.log(
    suspicious.length
      ? `\n!! ${suspicious.length} INVARIANT VIOLATIONS\n${suspicious.map((s) => "  " + s).join("\n")}`
      : "\ninvariants hold across the corpus.",
  )
  return suspicious.length
}

async function explain(engagementId: string) {
  const { data } = await sb()
    .from("proconnect_engagements")
    .select("engagement_id, tax_year, return_type, efile_status, efile_synced_at, efile_filings")
    .eq("engagement_id", engagementId)
    .maybeSingle()
  if (!data) return console.log(`no engagement ${engagementId}`)
  const r = data as Row
  const flat = (fs: RawFiling[]): RawFiling[] => fs.flatMap((f) => [f, ...flat(f.children ?? [])])
  console.log(`${r.engagement_id}  TY${r.tax_year}  ${r.return_type}`)
  console.log(`headline efile_status: ${r.efile_status}   hydrated: ${r.efile_synced_at}`)
  console.log("\nfilings:")
  for (const f of flat(r.efile_filings?.filings ?? [])) {
    const hist = (f.filingStatuses ?? [])
      .map((s) => `${s.status}@${s.statusUpdateTimestamp}`)
      .join(", ")
    console.log(
      `  ${(f.filingKey?.filingId ?? "?").padEnd(16)} ${(f.filingType ?? "?").padEnd(10)} ` +
        `return=${isReturnFiling(f) ? "yes" : "no "}  [${hist || "no statuses"}]`,
    )
  }
  console.log("\nverdict:", JSON.stringify(evaluateEfileLock(r.efile_filings), null, 2))
}

async function main() {
  const args = process.argv.slice(2)
  const explainIdx = args.indexOf("--explain")
  if (explainIdx !== -1) return explain(args[explainIdx + 1])

  const failed = runCases()
  if (args.includes("--cases")) process.exit(failed ? 1 : 0)
  const violations = await runLive()
  process.exit(failed || violations ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
