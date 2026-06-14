import "server-only"
import Stripe from "stripe"

/**
 * Server-only Stripe client for Hub-initiated payments.
 *
 * KEY SELECTION (test vs live)
 * ----------------------------
 * The firm wants to transact on its LIVE account, but live keys may not be
 * present in every environment (e.g. previews). We therefore prefer the live
 * secret key when it is set, and fall back to the standard test key otherwise.
 * This lets us build/verify in test mode now and "go live" simply by adding
 * STRIPE_LIVE_STRIPE_SECRET_KEY — no code change required.
 *
 *   - STRIPE_LIVE_STRIPE_SECRET_KEY  → live mode (sk_live_…)
 *   - STRIPE_SECRET_KEY              → test mode (sk_test_…)
 *
 * NEVER import this file from client code — it carries the secret key.
 */

const liveKey = process.env.STRIPE_LIVE_STRIPE_SECRET_KEY?.trim()
const testKey = process.env.STRIPE_SECRET_KEY?.trim()
const secretKey = liveKey || testKey

if (!secretKey) {
  throw new Error(
    "[stripe] No secret key configured. Set STRIPE_LIVE_STRIPE_SECRET_KEY (live) or STRIPE_SECRET_KEY (test).",
  )
}

/** True when we are running against the live Stripe account. */
export const STRIPE_LIVE_MODE = Boolean(liveKey) && secretKey.startsWith("sk_live")

/**
 * The publishable key that pairs with the active secret key. Exposed to the
 * pay page so Stripe.js initializes against the SAME account/mode as the
 * server session. Mirrors the live/test selection above.
 */
export function getPublishableKey(): string {
  const livePub =
    process.env.NEXT_PUBLIC_STRIPE_LIVE_STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_LIVE_STRIPE_PUBLISHABLE_KEY?.trim()
  const testPub =
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() ||
    process.env.STRIPE_PUBLISHABLE_KEY?.trim()

  // Use the publishable key that matches whichever secret key we selected.
  if (STRIPE_LIVE_MODE && livePub) return livePub
  return testPub || livePub || ""
}

/**
 * Pin the API version so Stripe library upgrades never silently change wire
 * behavior. Bump deliberately following the Stripe upgrade skill.
 */
export const stripe = new Stripe(secretKey, {
  // Pinned to the version bundled with stripe-node 22.x. Bump deliberately
  // following the Stripe upgrade skill when the library is upgraded.
  apiVersion: "2026-05-27.dahlia",
  appInfo: { name: "ALFRED Hub", url: "https://hub.motta.cpa" },
})
