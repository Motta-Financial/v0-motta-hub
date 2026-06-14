/**
 * ProConnect OAuth — signed `state` helper
 *
 * Mirrors the HMAC-signed state pattern already used by the Calendly and
 * Ignition OAuth flows (see app/api/calendly/oauth/{authorize,callback}).
 * The state binds the round-trip to the admin team_member who initiated it
 * so that:
 *   1. the callback can record `connected_by_team_member_id`, and
 *   2. an attacker cannot trick a victim into connecting an Intuit account
 *      against someone else's session (CSRF).
 *
 * It is self-contained (HMAC-signed payload, not a cookie) which is what
 * lets the cross-domain Intuit redirect to /callback succeed even though
 * the browser may not send our session cookie back on that hop.
 *
 * Signing secret precedence matches the Calendly helper — we reuse
 * SUPABASE_JWT_SECRET (already required for auth) so no new env var is
 * needed. PROCONNECT_CLIENT_SECRET is a fallback for environments where the
 * JWT secret isn't exposed.
 */
import crypto from "node:crypto"

const STATE_TTL_MS = 10 * 60 * 1000 // 10 minutes

export interface ProconnectStatePayload {
  teamMemberId: string
  /** Where to send the user after a successful callback. */
  returnTo: string
}

interface SignedPayload extends ProconnectStatePayload {
  timestamp: number
  nonce: string
}

function getStateSecret(): string {
  return (
    process.env.SUPABASE_JWT_SECRET ||
    process.env.PROCONNECT_CLIENT_SECRET ||
    "proconnect-state-secret"
  )
}

function sign(payloadB64: string): string {
  return crypto
    .createHmac("sha256", getStateSecret())
    .update(payloadB64)
    .digest("base64url")
}

/**
 * Mint an opaque, signed state token bound to a team member. TTL is 10
 * minutes so a forgotten browser tab can't replay it.
 */
export function mintState({ teamMemberId, returnTo }: ProconnectStatePayload): string {
  const payload: SignedPayload = {
    teamMemberId,
    returnTo,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(16).toString("hex"),
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${payloadB64}.${sign(payloadB64)}`
}

/**
 * Verify a state token. Returns the decoded payload when the signature is
 * valid and the timestamp is fresh, otherwise null.
 */
export function verifyState(state: string | null | undefined): ProconnectStatePayload | null {
  if (!state) return null
  const dot = state.indexOf(".")
  if (dot === -1) return null

  const payloadB64 = state.slice(0, dot)
  const signature = state.slice(dot + 1)
  const expected = sign(payloadB64)

  // timingSafeEqual is length-sensitive, so guard on length first.
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signature)
  if (expectedBuf.length !== actualBuf.length) return null
  if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as SignedPayload
    if (typeof decoded.teamMemberId !== "string") return null
    if (typeof decoded.timestamp !== "number") return null
    if (Date.now() - decoded.timestamp > STATE_TTL_MS) return null
    const returnTo =
      typeof decoded.returnTo === "string" && decoded.returnTo.startsWith("/")
        ? decoded.returnTo
        : "/tax/settings"
    return { teamMemberId: decoded.teamMemberId, returnTo }
  } catch {
    return null
  }
}
