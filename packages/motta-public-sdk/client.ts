/**
 * Server-to-server client for the marketing site.
 *
 * Use this from the marketing project's `app/api/*` routes — never
 * directly from the browser. The shared secret MUST stay on the
 * server.
 */

export interface HubFetchOptions {
  /** JSON body to forward. */
  body: unknown
  /** Forwarded client IP (for the Hub's audit log + rate limit key). */
  ip?: string
  /** Forwarded user agent. */
  ua?: string
  /** Forwarded request id, if your edge runtime sets one. */
  requestId?: string
  /** HTTP method. Defaults to "POST". */
  method?: "POST" | "GET" | "PUT" | "DELETE" | "PATCH"
  /** Override the Hub base URL. Defaults to env.MOTTA_HUB_URL. */
  hubUrl?: string
  /** Override the shared secret. Defaults to env.MOTTA_PUBLIC_SECRET. */
  secret?: string
  /** Extra headers to merge in. */
  headers?: Record<string, string>
  /** Timeout in ms. Defaults to 10_000. */
  timeoutMs?: number
}

export interface HubFetchResult<T = unknown> {
  ok: boolean
  status: number
  data: T | null
  error: string | null
}

const DEFAULT_HUB_URL = "https://hub.motta.cpa"
const DEFAULT_TIMEOUT = 10_000

function resolveHubUrl(opts: HubFetchOptions): string {
  if (opts.hubUrl) return opts.hubUrl.replace(/\/+$/, "")
  // env.MOTTA_HUB_URL is set on the marketing project so previews
  // (motta-*.vercel.app) can talk to the Hub preview if you want
  // staging-to-staging tests.
  const fromEnv =
    typeof process !== "undefined" ? process.env.MOTTA_HUB_URL : undefined
  return (fromEnv || DEFAULT_HUB_URL).replace(/\/+$/, "")
}

function resolveSecret(opts: HubFetchOptions): string {
  if (opts.secret) return opts.secret
  const fromEnv =
    typeof process !== "undefined" ? process.env.MOTTA_PUBLIC_SECRET : undefined
  if (!fromEnv) {
    throw new Error(
      "MOTTA_PUBLIC_SECRET is not set on the marketing project. " +
        "Add it under Vercel → Project Settings → Environment Variables. " +
        "It must match the value on the Hub project (prj_VvPN85eN7oCBBRzcLD7YYokXbxo8).",
    )
  }
  return fromEnv
}

/**
 * Forward a JSON request to the Hub's public API. Adds the shared
 * secret + telemetry headers and unwraps the response shape into a
 * stable `{ ok, status, data, error }`.
 */
export async function hubFetch<T = unknown>(
  path: string,
  opts: HubFetchOptions,
): Promise<HubFetchResult<T>> {
  const url = `${resolveHubUrl(opts)}${path.startsWith("/") ? path : `/${path}`}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT)

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-motta-public-secret": resolveSecret(opts),
      "x-motta-source": "motta.cpa",
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
      ...(opts.ua ? { "user-agent": opts.ua } : {}),
      ...(opts.requestId ? { "x-request-id": opts.requestId } : {}),
      ...(opts.headers ?? {}),
    }
    const res = await fetch(url, {
      method: opts.method ?? "POST",
      headers,
      body: opts.method === "GET" ? undefined : JSON.stringify(opts.body ?? {}),
      signal: ctrl.signal,
      // Marketing → Hub is server-to-server; never send credentials.
      credentials: "omit",
      cache: "no-store",
    })
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    if (!res.ok) {
      const errMsg =
        (parsed as { error?: string } | null)?.error ??
        `hub_returned_${res.status}`
      return { ok: false, status: res.status, data: null, error: errMsg }
    }
    return {
      ok: true,
      status: res.status,
      data: (parsed as T) ?? null,
      error: null,
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown_error"
    return { ok: false, status: 0, data: null, error: message }
  } finally {
    clearTimeout(timer)
  }
}
