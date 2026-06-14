import "server-only"
import { createAdminClient } from "@/lib/supabase/server"
import { stripe, STRIPE_LIVE_MODE } from "@/lib/stripe"
import { toStripeRecurring, type ServicePackage } from "./types"

/**
 * Stripe Products/Prices are environment-specific, so we cache them in separate
 * columns per mode and always read/write the pair that matches the active key.
 * Flipping to live keys then mints fresh live objects instead of reusing the
 * test ids that were cached during development.
 */
const PRODUCT_COL = STRIPE_LIVE_MODE ? "stripe_product_id_live" : "stripe_product_id"
const PRICE_COL = STRIPE_LIVE_MODE ? "stripe_price_id_live" : "stripe_price_id"

function cachedProductId(pkg: ServicePackage): string | null {
  return STRIPE_LIVE_MODE ? pkg.stripe_product_id_live : pkg.stripe_product_id
}
function cachedPriceId(pkg: ServicePackage): string | null {
  return STRIPE_LIVE_MODE ? pkg.stripe_price_id_live : pkg.stripe_price_id
}

/**
 * Catalog access + lazy Stripe Product/Price synchronization.
 *
 * The Hub is the source of truth for prices (service_packages.price_cents).
 * Stripe Product/Price objects are created on demand and their ids cached on
 * the row, so:
 *   - the catalog is editable in the Hub without a Stripe round-trip per view,
 *   - we never create duplicate Stripe objects for the same package, and
 *   - a price change mints a NEW Stripe Price (prices are immutable in Stripe).
 */

export async function listActivePackages(): Promise<ServicePackage[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("service_packages")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
  if (error) throw new Error(`[catalog] listActivePackages: ${error.message}`)
  return (data ?? []) as ServicePackage[]
}

export async function getPackage(id: string): Promise<ServicePackage | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("service_packages")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`[catalog] getPackage: ${error.message}`)
  return (data as ServicePackage) ?? null
}

/**
 * Ensure a Stripe Price exists that matches THIS package's current price, and
 * return its id. Creates the Product on first use and a new Price whenever the
 * amount/interval drifts from what Stripe has. Caches both ids on the row.
 *
 * `amountCentsOverride` lets a one-off pay link charge a custom amount (e.g. a
 * partial deposit) without mutating the catalog: when supplied and different
 * from the package price, we create an ad-hoc Price and DO NOT cache it.
 */
export async function ensureStripePrice(
  pkg: ServicePackage,
  amountCentsOverride?: number,
): Promise<string> {
  const supabase = createAdminClient()

  // 1. Make sure a Product exists in the ACTIVE Stripe mode.
  let productId = cachedProductId(pkg)
  if (!productId) {
    const product = await stripe.products.create({
      name: pkg.name,
      description: pkg.description ?? undefined,
      metadata: { hub_service_package_id: pkg.id },
    })
    productId = product.id
    await supabase
      .from("service_packages")
      .update({ [PRODUCT_COL]: productId })
      .eq("id", pkg.id)
  }

  const amount = amountCentsOverride ?? pkg.price_cents
  const isOverride =
    amountCentsOverride !== undefined && amountCentsOverride !== pkg.price_cents

  // 2. Build the Price params for this package's billing type.
  const recurring =
    pkg.billing_type === "recurring" && pkg.recurring_interval
      ? toStripeRecurring(pkg.recurring_interval)
      : undefined

  // 3. Reuse the cached price only for the standard (non-override) amount.
  const priceId = cachedPriceId(pkg)
  if (!isOverride && priceId) {
    // retrieve() can 404 if the id belongs to the other Stripe mode; treat that
    // as a cache miss and mint a fresh price below rather than throwing.
    const existing = await stripe.prices.retrieve(priceId).catch(() => null)
    if (existing && existing.active && existing.unit_amount === amount) {
      return priceId
    }
    if (existing) {
      // Price drifted — deactivate the stale one before minting a new price.
      await stripe.prices.update(priceId, { active: false }).catch(() => {})
    }
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: pkg.currency || "usd",
    unit_amount: amount,
    ...(recurring ? { recurring } : {}),
    metadata: { hub_service_package_id: pkg.id, override: String(isOverride) },
  })

  // 4. Cache only the canonical price; never cache an ad-hoc override.
  if (!isOverride) {
    await supabase
      .from("service_packages")
      .update({ [PRICE_COL]: price.id })
      .eq("id", pkg.id)
  }

  return price.id
}
