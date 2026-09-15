/**
 * Outlook token-at-rest encryption (AES-256-GCM).
 *
 * `outlook_connections` holds a Microsoft Graph access token and a
 * long-lived refresh token that together grant read access to a staff
 * member's mailbox and calendar. Mirrors lib/proconnect/token-cipher.ts —
 * same envelope format, same opportunistic-encrypt / tolerant-decrypt
 * migration strategy — keyed by MICROSOFT_TOKEN_KEY instead of
 * PROCONNECT_TOKEN_KEY.
 *
 * Key format: 64 hex characters (32 bytes). Generate with:
 *   openssl rand -hex 32
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const ENVELOPE_VERSION = "v1"
const ALGORITHM = "aes-256-gcm"
const IV_BYTES = 12

function getKey(): Buffer | null {
  const hex = process.env.MICROSOFT_TOKEN_KEY
  if (!hex) return null

  const trimmed = hex.trim()
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error(
      "MICROSOFT_TOKEN_KEY must be exactly 64 hex characters (32 bytes). " +
        "Generate one with: openssl rand -hex 32",
    )
  }
  return Buffer.from(trimmed, "hex")
}

let plaintextWarningEmitted = false

function warnPlaintextOnce(): void {
  if (plaintextWarningEmitted) return
  plaintextWarningEmitted = true
  console.warn(
    "[outlook] MICROSOFT_TOKEN_KEY is not set — OAuth tokens are stored in " +
      "PLAINTEXT. Set a 32-byte hex key (openssl rand -hex 32) in the Vercel project " +
      "env vars; the stored row re-encrypts itself on the next refresh. " +
      "(This notice is logged once per process.)",
  )
}

export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(`${ENVELOPE_VERSION}:`)
}

export function isTokenEncryptionConfigured(): boolean {
  try {
    return getKey() !== null
  } catch {
    return false
  }
}

export function encryptToken(plain: string): string {
  let key: Buffer | null
  try {
    key = getKey()
  } catch (err) {
    console.error(
      "[outlook] token encryption disabled — invalid MICROSOFT_TOKEN_KEY:",
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

export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) {
    return stored
  }

  const parts = stored.split(":")
  if (parts.length !== 4) {
    throw new Error(
      "[outlook] stored token has a v1 envelope but is malformed " +
        `(expected 4 segments, got ${parts.length}). The row may be corrupt — reconnect Outlook.`,
    )
  }

  const key = getKey()
  if (!key) {
    throw new Error(
      "[outlook] stored token is encrypted but MICROSOFT_TOKEN_KEY is not set. " +
        "Restore the key to the environment, or clear outlook_connections and reconnect.",
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
    throw new Error(
      "[outlook] failed to decrypt stored OAuth token — the key may have " +
        "been rotated or the row tampered with. Clear outlook_connections and reconnect.",
    )
  }
}
