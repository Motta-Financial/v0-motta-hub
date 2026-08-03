/**
 * ProConnect token-at-rest encryption (AES-256-GCM).
 *
 * Why this exists
 * ---------------
 * `proconnect_oauth_tokens` holds an Intuit access token (a readable JWT)
 * and a long-lived, rolling refresh token. That pair grants **write access
 * to every tax return in the firm**. RLS restricts the table to the service
 * role, so plaintext storage is not remotely exploitable today — but it is
 * one misconfigured policy or one service-role leak away from full
 * return-write access. The ProConnect implementation plan called for
 * AES-256-GCM at rest behind `PROCONNECT_TOKEN_KEY`; this module is that
 * control.
 *
 * Migration strategy — deliberately zero-downtime, no backfill script
 * -------------------------------------------------------------------
 * `decryptToken()` is *tolerant*: it accepts both the `v1:` ciphertext
 * envelope and legacy plaintext, returning plaintext unchanged. `encryptToken()`
 * is *opportunistic*: it encrypts when `PROCONNECT_TOKEN_KEY` is configured
 * and passes through (loudly) when it isn't.
 *
 * The consequences are what we want operationally:
 *
 *   - Deploying this code with no env var set changes nothing. No outage.
 *   - The moment `PROCONNECT_TOKEN_KEY` is set, the next token refresh
 *     (they happen at least hourly — access tokens live 3600s) rewrites the
 *     singleton row as ciphertext. The plaintext row upgrades itself.
 *   - Rolling back the deploy still works: an older build reading a `v1:`
 *     value would break, so DO NOT roll back past this commit once the key
 *     is set without first clearing the row and reconnecting.
 *
 * Key format: 64 hex characters (32 bytes). Generate with:
 *   openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/** Envelope prefix. Bump if the algorithm or layout ever changes. */
const ENVELOPE_VERSION = "v1"
const ALGORITHM = "aes-256-gcm"
/** GCM standard nonce length. 12 bytes is the recommended size. */
const IV_BYTES = 12

/**
 * Resolve and validate the encryption key at call time (never at module
 * load) so a missing env var surfaces per-request instead of crashing the
 * whole serverless bundle on cold start.
 */
function getKey(): Buffer | null {
  const hex = process.env.PROCONNECT_TOKEN_KEY
  if (!hex) return null

  const trimmed = hex.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    // A malformed key is an operator error, not a runtime condition. Fail
    // loudly rather than silently degrading to plaintext — otherwise a typo
    // in the env var would quietly disable the control we think is on.
    throw new Error(
      "PROCONNECT_TOKEN_KEY must be exactly 64 hex characters (32 bytes). " +
        "Generate one with: openssl rand -hex 32",
    )
  }
  return Buffer.from(trimmed, "hex")
}

/**
 * The unconfigured-key notice is emitted at most once per process, at WARN.
 *
 * It used to be a per-call `console.error`. That fired on every token refresh
 * — at least hourly, plus once per webhook burst — which put a line reading
 * "SECURITY … PLAINTEXT" into the error stream several times an hour. That is
 * indistinguishable from a live incident when you're scanning logs, and it
 * crowded out the real errors. The condition is a standing configuration gap,
 * not a per-request failure, so it should be reported like one.
 */
let plaintextWarningEmitted = false

function warnPlaintextOnce(): void {
  if (plaintextWarningEmitted) return
  plaintextWarningEmitted = true
  console.warn(
    "[proconnect] PROCONNECT_TOKEN_KEY is not set — OAuth tokens are stored in " +
      "PLAINTEXT. Set a 32-byte hex key (openssl rand -hex 32) in the Vercel project " +
      "env vars; the stored row re-encrypts itself on the next refresh. " +
      "(This notice is logged once per process.)",
  )
}

/** True when the stored value carries our ciphertext envelope. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(`${ENVELOPE_VERSION}:`)
}

/** True when a valid key is configured (used by diagnostics/admin UI). */
export function isTokenEncryptionConfigured(): boolean {
  try {
    return getKey() !== null
  } catch {
    // Malformed key — configured but unusable. Report false so the admin
    // surface shows "not protected" rather than implying it's fine.
    return false
  }
}

/**
 * Encrypt a token for storage.
 *
 * Returns `v1:<ivB64>:<ciphertextB64>:<authTagB64>` when a key is present.
 * Returns the input unchanged (with a loud server-side warning) when no key
 * is configured, so an unconfigured environment keeps working.
 */
export function encryptToken(plain: string): string {
  let key: Buffer | null
  try {
    key = getKey()
  } catch (err) {
    // Malformed key: refuse to write plaintext silently, but don't take the
    // integration down either. Surface it and fall back.
    console.error(
      "[proconnect] token encryption disabled — invalid PROCONNECT_TOKEN_KEY:",
      err instanceof Error ? err.message : String(err),
    )
    return plain
  }

  if (!key) {
    warnPlaintextOnce()
    return plain
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    ENVELOPE_VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    authTag.toString("base64"),
  ].join(":")
}

/**
 * Decrypt a stored token.
 *
 * Tolerant by design — see the migration note at the top of this file:
 *   - `v1:` envelope  → decrypt and return the plaintext token
 *   - anything else   → assume legacy plaintext and return it unchanged
 *
 * Throws only when the value *is* an envelope and we cannot open it (missing
 * key, wrong key, or tampered ciphertext). That case must be loud: silently
 * returning a broken token would surface later as a confusing 401 from Intuit.
 */
export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) {
    // Legacy plaintext row, or an environment that never had a key.
    return stored
  }

  const parts = stored.split(":")
  if (parts.length !== 4) {
    throw new Error(
      "[proconnect] stored token has a v1 envelope but is malformed " +
        `(expected 4 segments, got ${parts.length}). The row may be corrupt — reconnect ProConnect.`,
    )
  }

  const key = getKey()
  if (!key) {
    throw new Error(
      "[proconnect] stored token is encrypted but PROCONNECT_TOKEN_KEY is not set. " +
        "Restore the key to the environment, or clear proconnect_oauth_tokens and reconnect.",
    )
  }

  const [, ivB64, ctB64, tagB64] = parts
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"))
    decipher.setAuthTag(Buffer.from(tagB64, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    // Never echo the ciphertext or key material into logs.
    throw new Error(
      "[proconnect] failed to decrypt stored OAuth token — the key may have " +
        "been rotated or the row tampered with. Clear proconnect_oauth_tokens and reconnect.",
    )
  }
}
