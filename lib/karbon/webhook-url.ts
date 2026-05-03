/**
 * Resolves the public URL Karbon should POST webhooks to.
 *
 * Resolution order:
 *   1. KARBON_WEBHOOK_TARGET_URL — explicit override (set this in production)
 *   2. https://${VERCEL_PROJECT_PRODUCTION_URL} — stable Vercel production URL
 *   3. NEXT_PUBLIC_APP_URL — manual app URL fallback
 *   4. https://${VERCEL_URL} — current deployment (preview); not recommended for prod
 */
export function resolveWebhookTargetUrl(): string {
  const explicit = process.env.KARBON_WEBHOOK_TARGET_URL
  if (explicit) return ensureWebhookPath(explicit)

  const prodUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (prodUrl) return ensureWebhookPath(`https://${prodUrl}`)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (appUrl) return ensureWebhookPath(appUrl)

  const vercelUrl = process.env.VERCEL_URL
  if (vercelUrl) return ensureWebhookPath(`https://${vercelUrl}`)

  throw new Error(
    "Cannot resolve Karbon webhook target URL — set KARBON_WEBHOOK_TARGET_URL or VERCEL_PROJECT_PRODUCTION_URL",
  )
}

function ensureWebhookPath(base: string): string {
  let trimmed = base.replace(/\/+$/, "")
  // Ensure https:// protocol is present
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    trimmed = `https://${trimmed}`
  }
  if (trimmed.endsWith("/api/karbon/webhooks")) return trimmed
  return `${trimmed}/api/karbon/webhooks`
}

/**
 * The 8 valid Karbon WebhookTypes per the API spec.
 */
export const KARBON_WEBHOOK_TYPES = [
  "Contact",
  "Work",
  "Note",
  "User",
  "IntegrationTask",
  "Invoice",
  "EstimateSummary",
  "CustomField",
] as const

export type KarbonWebhookType = (typeof KARBON_WEBHOOK_TYPES)[number]

/**
 * Generates a 32-byte hex signing key for HMAC verification.
 * Karbon stores this server-side and uses it to sign every delivery.
 */
export function generateSigningKey(): string {
  // Use Web Crypto if available, fall back to node:crypto
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(32)
    crypto.getRandomValues(buf)
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto")
  return randomBytes(32).toString("hex")
}
