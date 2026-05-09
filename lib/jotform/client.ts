/**
 * Thin wrapper around the Jotform REST API (https://api.jotform.com/docs/).
 *
 * Auth uses the `JOTFORM_API_KEY` env var (the "Motta Hub" key). All
 * endpoints respond with `{ responseCode, message, content, ... }`; this
 * wrapper unwraps `content` so callers don't need to.
 */

const API_BASE = "https://api.jotform.com"

function getApiKey(): string {
  const key = process.env.JOTFORM_API_KEY
  if (!key) {
    throw new Error("JOTFORM_API_KEY is not configured")
  }
  return key
}

async function jotformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(API_BASE + path)
  url.searchParams.set("apiKey", getApiKey())

  const res = await fetch(url.toString(), {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  })

  const body = (await res.json()) as { responseCode: number; message: string; content: unknown }

  if (!res.ok || body.responseCode !== 200) {
    throw new Error(
      `Jotform ${path} failed (${res.status}, code=${body.responseCode}): ${body.message ?? "unknown"}`,
    )
  }
  return body.content as T
}

// ── Types ────────────────────────────────────────────────────────────

export type JotformAnswer = {
  name?: string
  text?: string
  type?: string
  order?: string
  // Answer is sometimes a string, sometimes a structured object
  // (control_fullname → {first,last}, control_address → {addr_line1,...},
  //  control_phone → {full}, control_checkbox → string[], ...)
  answer?: unknown
  prettyFormat?: string
}

export type JotformSubmission = {
  id: string
  form_id: string
  ip: string
  created_at: string
  updated_at: string | null
  status: string
  flag: string | number
  new: string | number
  answers: Record<string, JotformAnswer>
}

export type JotformForm = {
  id: string
  username: string
  title: string
  url: string
  status: string
  count: string
  created_at: string
  updated_at: string
}

export type JotformQuestion = {
  qid: string
  name?: string
  text?: string
  type: string
  order?: string
  required?: string
}

// ── User / form discovery ────────────────────────────────────────────

export async function getCurrentUser() {
  return jotformFetch<{ username: string; email: string; name: string; account_type?: { name: string } }>(
    "/user",
  )
}

export async function listForms(limit = 200): Promise<JotformForm[]> {
  return jotformFetch<JotformForm[]>(`/user/forms?limit=${limit}`)
}

export async function getForm(formId: string): Promise<JotformForm> {
  return jotformFetch<JotformForm>(`/form/${formId}`)
}

export async function getFormQuestions(formId: string): Promise<Record<string, JotformQuestion>> {
  return jotformFetch<Record<string, JotformQuestion>>(`/form/${formId}/questions`)
}

// ── Submissions ──────────────────────────────────────────────────────

export async function listFormSubmissions(
  formId: string,
  opts: { limit?: number; offset?: number; orderby?: string; filter?: Record<string, unknown> } = {},
): Promise<JotformSubmission[]> {
  const params = new URLSearchParams()
  if (opts.limit) params.set("limit", String(opts.limit))
  if (opts.offset) params.set("offset", String(opts.offset))
  if (opts.orderby) params.set("orderby", opts.orderby)
  if (opts.filter) params.set("filter", JSON.stringify(opts.filter))

  const qs = params.toString()
  return jotformFetch<JotformSubmission[]>(
    `/form/${formId}/submissions${qs ? `?${qs}` : ""}`,
  )
}

export async function getSubmission(submissionId: string): Promise<JotformSubmission> {
  return jotformFetch<JotformSubmission>(`/submission/${submissionId}`)
}

/**
 * Walk every page of submissions for a given form. Jotform's max page
 * size is 1000, but we default to 100 to match their docs.
 */
export async function* iterateAllSubmissions(
  formId: string,
  pageSize = 100,
): AsyncGenerator<JotformSubmission, void, unknown> {
  let offset = 0
  while (true) {
    const page = await listFormSubmissions(formId, {
      limit: pageSize,
      offset,
      orderby: "created_at",
    })
    if (page.length === 0) return
    for (const sub of page) yield sub
    if (page.length < pageSize) return
    offset += pageSize
  }
}

// ── Webhooks ─────────────────────────────────────────────────────────

export async function listWebhooks(formId: string): Promise<Record<string, string>> {
  return jotformFetch<Record<string, string>>(`/form/${formId}/webhooks`)
}

export async function addWebhook(formId: string, webhookUrl: string): Promise<unknown> {
  // POST application/x-www-form-urlencoded with `webhookURL=<url>`.
  const body = new URLSearchParams({ webhookURL: webhookUrl })
  return jotformFetch(`/form/${formId}/webhooks`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
}

export async function deleteWebhook(formId: string, webhookId: string | number): Promise<unknown> {
  return jotformFetch(`/form/${formId}/webhooks/${webhookId}`, { method: "DELETE" })
}
