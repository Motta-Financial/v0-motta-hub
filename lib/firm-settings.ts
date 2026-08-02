/**
 * Firm configuration — the single place firm-specific values live.
 *
 * The platform is being converted from a single-firm tool (Motta
 * Financial) into a licensable product, so nothing outside this module
 * should hardcode firm domains, URLs, email addresses, or the firm
 * timezone. Resolution order for every value:
 *
 *   1. `firm_settings` DB row  (scripts/354) — editable without deploy
 *   2. environment variable    — per-deployment override
 *   3. coded Motta default     — keeps the app working if the table or
 *                                env is missing (fresh envs, tests)
 *
 * Two access paths:
 *   - `getFirmConfig()`  — async, DB-backed, cached in-module for
 *     FIRM_SETTINGS_TTL_MS. Use in API routes / server components.
 *   - `firmDefaults`     — sync, env → default only (no DB). Use ONLY
 *     where module-init order forces it (constants evaluated at import
 *     time). These sites still centralize here, so tenant resolution
 *     has one seam to slot into later.
 *
 * When multi-tenancy lands, `getFirmConfig()` grows a tenant argument
 * and the cache becomes per-tenant; callers don't change shape.
 */

import { tryCreateAdminClient } from "@/lib/supabase/server"

export interface FirmConfig {
  /** Display name used in emails, PDFs, page titles. */
  name: string
  /** Short brand name for compact UI contexts. */
  shortName: string
  /** Canonical Hub base URL (no trailing slash). */
  hubUrl: string
  /** Public marketing site base URL (no trailing slash). */
  publicSiteUrl: string
  /** Email domains that identify firm staff vs. clients. */
  internalEmailDomains: string[]
  /** Default From: header for outbound transactional email. */
  fromEmail: string
  /** Reply-to / support inbox surfaced to clients. */
  supportEmail: string
  /** Firm home timezone (IANA name). */
  timezone: string
  /** Origins allowed to call the public intake/contact endpoints. */
  corsAllowedHosts: string[]
  /** Vercel preview hostname prefixes treated as first-party. */
  corsPreviewPrefixes: string[]
  /** AI assistant brand name. */
  assistantName: string
  /** Service-account identity the assistant acts as. */
  assistantEmail: string
}

function normalizeUrl(url: string): string {
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`
  return withScheme.replace(/\/+$/, "")
}

function envList(name: string): string[] | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length > 0 ? items : undefined
}

/**
 * Env → coded-default resolution (steps 2–3). Evaluated lazily so env
 * mutation in tests is honored, but cheap enough to call anywhere.
 */
export function firmDefaults(): FirmConfig {
  return {
    name: process.env.FIRM_NAME || "Motta Financial",
    shortName: process.env.FIRM_SHORT_NAME || "Motta",
    // Deliberately does NOT consult NEXT_PUBLIC_APP_URL. That variable
    // currently holds the Hub URL, but it has historically been pointed
    // at the MARKETING site (motta.cpa, sometimes as a bare hostname),
    // which 404s every Hub route — it silently broke the Karbon sync for
    // weeks (see app/api/karbon/sync/route.ts) and bit the ProConnect and
    // Zoom OAuth callbacks. It is also NEXT_PUBLIC_ (inlined into client
    // bundles at build time) and has no Preview value, so it is the wrong
    // source of truth for server-side URLs regardless of today's value.
    hubUrl: normalizeUrl(process.env.FIRM_HUB_URL || process.env.APP_BASE_URL || "https://hub.motta.cpa"),
    publicSiteUrl: normalizeUrl(process.env.FIRM_PUBLIC_SITE_URL || "https://motta.cpa"),
    internalEmailDomains: envList("FIRM_INTERNAL_EMAIL_DOMAINS") || ["motta.cpa", "mottafinancial.com"],
    fromEmail: process.env.RESEND_FROM_EMAIL || "ALFRED Ai <Info@mottafinancial.com>",
    supportEmail: process.env.FIRM_SUPPORT_EMAIL || "Info@mottafinancial.com",
    timezone: process.env.FIRM_TIMEZONE || "America/New_York",
    corsAllowedHosts: envList("FIRM_CORS_ALLOWED_HOSTS") || [
      "motta.cpa",
      "www.motta.cpa",
      "hub.motta.cpa",
      "www.mottafinancial.com",
      "mottafinancial.com",
    ],
    corsPreviewPrefixes: envList("FIRM_CORS_PREVIEW_PREFIXES") || ["newmottawebsite", "motta-", "v0-motta-hub"],
    assistantName: process.env.ASSISTANT_NAME || "ALFRED",
    assistantEmail: process.env.ASSISTANT_EMAIL || "Info@mottafinancial.com",
  }
}

/** firm_settings key → FirmConfig field, with a value validator. */
const KEY_MAP: Array<{
  key: string
  field: keyof FirmConfig
  kind: "string" | "string[]"
}> = [
  { key: "firm.name", field: "name", kind: "string" },
  { key: "firm.short_name", field: "shortName", kind: "string" },
  { key: "firm.hub_url", field: "hubUrl", kind: "string" },
  { key: "firm.public_site_url", field: "publicSiteUrl", kind: "string" },
  { key: "firm.internal_email_domains", field: "internalEmailDomains", kind: "string[]" },
  { key: "firm.from_email", field: "fromEmail", kind: "string" },
  { key: "firm.support_email", field: "supportEmail", kind: "string" },
  { key: "firm.timezone", field: "timezone", kind: "string" },
  { key: "firm.cors_allowed_hosts", field: "corsAllowedHosts", kind: "string[]" },
  { key: "firm.cors_preview_prefixes", field: "corsPreviewPrefixes", kind: "string[]" },
  { key: "assistant.name", field: "assistantName", kind: "string" },
  { key: "assistant.email", field: "assistantEmail", kind: "string" },
]

const FIRM_SETTINGS_TTL_MS = 5 * 60 * 1000

// Module-level cache: survives warm lambda invocations, resets on cold
// start. A 5-minute TTL means a settings edit propagates fleet-wide
// without a deploy while keeping the hot path to zero DB reads.
let cached: { config: FirmConfig; expires: number } | null = null
let inflight: Promise<FirmConfig> | null = null

async function fetchConfig(): Promise<FirmConfig> {
  const config = firmDefaults()
  const supabase = tryCreateAdminClient()
  if (!supabase) return config

  try {
    const { data, error } = await supabase.from("firm_settings").select("key, value")
    if (error || !data) return config

    const byKey = new Map<string, unknown>(data.map((row: { key: string; value: unknown }) => [row.key, row.value]))
    for (const { key, field, kind } of KEY_MAP) {
      const value = byKey.get(key)
      if (value === undefined || value === null) continue
      if (kind === "string" && typeof value === "string" && value.trim()) {
        if (field === "hubUrl" || field === "publicSiteUrl") {
          ;(config[field] as string) = normalizeUrl(value.trim())
        } else {
          ;(config[field] as string) = value.trim()
        }
      } else if (kind === "string[]" && Array.isArray(value) && value.every((v) => typeof v === "string")) {
        ;(config[field] as string[]) = value
      }
    }
    return config
  } catch {
    // Table missing (fresh environment) or transient DB failure — the
    // env/default tier keeps everything functional.
    return config
  }
}

/**
 * The firm's effective configuration. Cached; safe to call on every
 * request. Never throws — degrades to env/defaults on any failure.
 */
export async function getFirmConfig(): Promise<FirmConfig> {
  const now = Date.now()
  if (cached && cached.expires > now) return cached.config
  if (!inflight) {
    inflight = fetchConfig()
      .then((config) => {
        cached = { config, expires: Date.now() + FIRM_SETTINGS_TTL_MS }
        return config
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/** Test/admin hook: drop the cache so the next read refetches. */
export function invalidateFirmConfigCache(): void {
  cached = null
}

/**
 * Sync access for call sites that cannot await (CORS predicates,
 * module-scope constants). Returns the DB-backed config when the cache
 * is warm; otherwise returns env/defaults AND kicks off a background
 * refresh so the next call on this lambda sees DB values. On a firm's
 * own deployment env vars make even the cold-start value correct, so
 * the DB tier here is a freshness optimization, not a correctness
 * requirement.
 */
export function firmConfigSync(): FirmConfig {
  if (cached && cached.expires > Date.now()) return cached.config
  void getFirmConfig().catch(() => {})
  return firmDefaults()
}

/** True when the address belongs to a firm-internal email domain. */
export function isInternalEmail(email: string | null | undefined, config: Pick<FirmConfig, "internalEmailDomains">): boolean {
  if (!email) return false
  const domain = email.split("@")[1]?.toLowerCase()
  if (!domain) return false
  return config.internalEmailDomains.some((d) => d.toLowerCase() === domain)
}
