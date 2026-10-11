/**
 * Which ProConnect return types (modules) the Hub may create or write to.
 *
 * Intuit opened Import and Create Return to every module back to TY2022
 * (Oct 2026), but firm policy is to switch business types on one at a time:
 * Dat (2026-10-08) — 1065 first, nothing on client business returns before
 * 2026-10-15, and then only returns on the write allowlist.
 *
 * So the gate is a setting, not a code constant:
 *   PROCONNECT_ENABLED_RETURN_TYPES=IND,PAR   (module codes, comma-separated)
 * Unset means IND only — exactly the behaviour before this setting existed.
 * Set but empty means nothing is enabled. Unknown codes are ignored, so a
 * typo can only narrow the gate, never widen it.
 *
 * This is one gate among several: an import commit also needs the return on
 * PROCONNECT_WRITE_ALLOWED_RETURN_IDS, a clean recent dry run, and no
 * accepted e-file (see the import route).
 */

export const RETURN_MODULES = ["IND", "COR", "PAR", "SCO", "FID", "EXM", "GFT"] as const
export type ReturnModule = (typeof RETURN_MODULES)[number]

// Engagements carry the form number ("1065"); snapshots and Create Return use
// the module code ("PAR"). Accept either.
const FORM_TO_MODULE: Record<string, ReturnModule> = {
  "1040": "IND",
  "1120": "COR",
  "1065": "PAR",
  "1120S": "SCO",
  "1041": "FID",
  "990": "EXM",
  "709": "GFT",
}

export function toReturnModule(type: string | null | undefined): ReturnModule | null {
  const t = (type ?? "").trim().toUpperCase()
  if ((RETURN_MODULES as readonly string[]).includes(t)) return t as ReturnModule
  return FORM_TO_MODULE[t] ?? null
}

export function getEnabledReturnTypes(): ReturnModule[] {
  const raw = process.env.PROCONNECT_ENABLED_RETURN_TYPES
  if (raw === undefined) return ["IND"]
  const enabled = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is ReturnModule => (RETURN_MODULES as readonly string[]).includes(s))
  return [...new Set(enabled)]
}

/** Accepts a module code or a form number; unknown types are never enabled. */
export function isReturnTypeEnabled(type: string | null | undefined): boolean {
  const mod = toReturnModule(type)
  return mod !== null && getEnabledReturnTypes().includes(mod)
}
