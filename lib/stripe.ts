import "server-only"
import Stripe from "stripe"
import { firmDefaults } from "@/lib/firm-settings"

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

/**
 * True when we are running against the live Stripe account.
 *
 * Safe to evaluate with no key configured — it simply reports `false` rather
 * than throwing, so importing this module never depends on the environment.
 */
export const STRIPE_LIVE_MODE =
  Boolean(liveKey) && Boolean(secretKey) && secretKey!.startsWith("sk_live")

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
function createStripeClient(): Stripe {
  if (!secretKey) {
    throw new Error(
      "[stripe] No secret key configured. Set STRIPE_LIVE_STRIPE_SECRET_KEY (live) or STRIPE_SECRET_KEY (test).",
    )
  }
  return new Stripe(secretKey, {
    // Pinned to the version bundled with stripe-node 22.x. Bump deliberately
    // following the Stripe upgrade skill when the library is upgraded.
    apiVersion: "2026-05-27.dahlia",
    appInfo: { name: "ALFRED Hub", url: firmDefaults().hubUrl },
  })
}

let cachedClient: Stripe | null = null

/**
 * Lazily-constructed Stripe client.
 *
 * WHY A PROXY RATHER THAN A MODULE-LEVEL `new Stripe(...)`
 * -------------------------------------------------------
 * Constructing (or key-checking) at module scope means merely *importing*
 * this file throws when no key is configured. Next.js imports every route
 * module during the "Collecting page data" build step, so a missing Stripe
 * key failed the entire production build — not just the payment routes.
 * That is what broke preview deployments on the v0-motta-hub project for
 * every PR, regardless of what the PR changed.
 *
 * A missing payment key should fail *payment requests*, not the deploy. The
 * proxy defers both the key check and construction to first property access,
 * so:
 *   - importing is always safe (builds pass without Stripe secrets)
 *   - the first real call still throws the same clear, actionable error
 *   - call sites are unchanged — `stripe.checkout.sessions.create(...)` etc.
 *
 * Functions are bound to the real client so `this` is correct even if a
 * caller destructures a top-level method off the proxy.
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    cachedClient ??= createStripeClient()
    const value = Reflect.get(cachedClient, prop, receiver)
    return typeof value === "function" ? value.bind(cachedClient) : value
  },
  has(_target, prop) {
    cachedClient ??= createStripeClient()
    return Reflect.has(cachedClient, prop)
  },
})
