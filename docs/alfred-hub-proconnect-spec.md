# Motta Hub — Platform & ProConnect Integration Spec

> **Purpose.** This is a context document for a Claude Project assisting with
> development on the Motta Hub, with a focus on the ProConnect Tax (Intuit PTO
> Open API) integration. It describes the platform, its conventions, the ALFRED
> assistant architecture, and the full ProConnect integration design. Treat it
> as ground truth for *how this codebase is structured and how we extend it*.
> Where a section says **(planned)** the design is agreed but may not be merged
> yet; **(built)** means it exists in the repo today.
>
> Last updated: 2026-06-16

---

## 1. System overview

**Motta Hub** is the internal operations platform for **Motta Financial**, a CPA
firm (tax, accounting, advisory). It is a Next.js 15 / React 19 / TypeScript app
deployed on Vercel, backed by Supabase (Postgres + Auth). It unifies the firm's
daily workflows (clients, work items, calendar, debriefs, sales, payments) and
integrates external systems: **Karbon** (practice management), **Calendly**,
**Zoom**, **Ignition**, **Airtable**, and now **ProConnect Tax**.

Layered on top is **ALFRED**, an AI assistant that has read (and increasingly
write) access to the Hub's data and integrations, surfaced both as an in-app
widget and as a standalone app at `alfred.motta.cpa`.

### Repositories

| Repo | Vercel project | Domain | Role |
|---|---|---|---|
| `motta-financial/v0-motta-hub` | v0-motta-hub | **hub.motta.cpa** | The Hub. Owns all data, integrations, and the ALFRED "brain" (chat API + tools). Built largely via v0.app, so changes are typically made through v0 prompts. |
| `Motta-Financial/alfred-chat` | prj_ukwLQbxAJv24gsYUMgKFf4DRjidY | **alfred.motta.cpa** | Thin chat client. No LLM, no tools of its own. Calls the Hub's `/api/alfred/chat`. |

> **Domain note:** the Hub is served at `hub.motta.cpa`. (It was briefly at the
> apex `motta.cpa`; that is no longer the canonical API host.) Any hardcoded Hub
> URL — including alfred-chat's `NEXT_PUBLIC_HUB_*` env vars — must point at
> `hub.motta.cpa`.

---

## 2. Tech stack & conventions

- **Framework:** Next.js 15 App Router, React 19, TypeScript 5.
- **UI:** Tailwind CSS v4, Radix UI primitives, shadcn-style components in
  `components/ui/`, lucide-react icons, sonner toasts, Recharts.
- **Data/auth:** Supabase via `@supabase/ssr`. Brand background `#EAE6E1`,
  ALFRED brand gradient `from-amber-500 to-orange-600` with the `Sparkles` icon.
- **AI:** Vercel AI SDK 6 (`ai`, `@ai-sdk/react`), models routed via Vercel AI
  Gateway (model strings like `openai/gpt-4o`).
- **Package manager:** pnpm.

### Repo layout (relevant parts)

```
app/
  api/
    alfred/        chat, conversations, conversations/[id], data, schema,
                   search, stats, health, whoami
    karbon/        clients, contacts, organizations, work-items, tasks,
                   invoices, sync, webhooks, ...
    calendly/      oauth/{authorize,callback,refresh,disconnect}, sync, ...
    zoom/          oauth, meetings, recordings, ...
    ignition/      ...
    cron/          karbon-sync, calendly-sync, meeting-summary, ...
    proconnect/    oauth/{connect,callback,launch,disconnect}, ...  (planned)
  (feature pages: clients, tax, accounting, sales, debriefs, settings, admin, ...)
components/        feature components + ui/ primitives
contexts/          user-context.tsx, karbon-work-items-context.tsx
hooks/             use-user.ts, use-toast.ts, use-karbon-realtime.ts
lib/
  supabase/        client.ts, server.ts, middleware.ts
  alfred/          service-account.ts, allowed-tables.ts, resolve-user.ts,
                   cors.ts, policy.ts, auth-guard.ts, tools/
  karbon/          mappers, upsert, process-webhook-event, ...
  calendly-api.ts, zoom-auth.ts, ...
  proconnect/      oauth.ts, client.ts, clients.ts, engagements.ts,
                   returns.ts, catalog.ts, mappers.ts  (planned)
middleware.ts      auth + route-exemption gate
scripts/           NNN_*.sql migrations (run manually against Supabase)
```

### Conventions that matter when extending the Hub

1. **Integrations follow a fixed shape:** `lib/<service>-api.ts` (or
   `lib/<service>/`) + `app/api/<service>/*` routes + a Supabase mirror table +
   (for OAuth services) `oauth/{authorize|connect,callback,disconnect}` routes +
   a middleware exemption for the callback + a status card on the settings page.
   **New integrations must copy the nearest existing one (Calendly or Zoom for
   OAuth; Karbon for sync/webhooks) rather than invent a new pattern.**
2. **Migrations** live in `scripts/NNN_name.sql`, numbered, and are applied
   manually in the Supabase SQL editor. There is also a `supabase/migrations/`
   dir but `scripts/` is the working convention.
3. **Supabase clients** (`lib/supabase/server.ts`):
   - `createClient()` — per-request, cookie/session-scoped, **RLS applies**.
     Use for anything acting *as the user*.
   - `createAdminClient()` — service-role, **bypasses RLS**. Use for
     server-to-server (cron, sync, webhooks, ALFRED tool reads). Always
     instantiate inside the handler, never at module scope.
   - Cookies are written with `domain = process.env.SUPABASE_COOKIE_DOMAIN`
     (`.motta.cpa` in prod) so sessions are shared across `*.motta.cpa`
     subdomains. Never set the domain in local dev.
4. **Secrets** live only in Vercel env vars. `.env*` is gitignored. Never commit
   or echo secrets. Token-type secrets are stored **encrypted at rest** in
   Postgres (AES-256-GCM), never in plaintext columns.
5. **Server-to-server auth** uses a shared-secret header pattern
   (`x-internal-secret` === `CRON_SECRET` for cron→API chains; `x-alfred-secret`
   === `ALFRED_API_SECRET` for the ALFRED REST surface).

---

## 3. Auth model

- **User auth:** Supabase Auth (magic link). `middleware.ts` enforces a session
  on all routes except an explicit allowlist (auth callbacks, webhooks, cron,
  OAuth callbacks, public health checks).
- **Identity table:** `team_members` is the canonical person record. Auth users
  map to it by `auth_user_id` (fallback: `email`, case-insensitive). ALFRED's
  "my-data" scoping keys off `team_members.id`, **not** `auth.users.id`.
- **Deactivation:** middleware signs out any session whose `team_members` row is
  `is_active = false`.
- **Admin gating:** `/admin/*` and privileged actions check an existing admin
  helper — reuse it; do not roll a new one.

### `middleware.ts` exemption flags (pattern to copy)

Cross-domain OAuth callbacks are exempted from the session check via named
booleans, e.g. `isCalendlyOAuthCallback` for `/api/calendly/oauth/callback`. New
OAuth callbacks add an equivalent flag (e.g. `isProconnectOAuthCallback`). The
ALFRED cross-origin surface is exempted via `isAlfredBearerCall` /
`isAlfredCorsPreflight` (lets `Authorization: Bearer` + OPTIONS through to the
route, which enforces identity itself).

---

## 4. ALFRED architecture (built)

ALFRED is **one brain, two faces**:

```
  in-app widget (Hub)        alfred.motta.cpa (thin client)
            \                        /
             →  POST hub.motta.cpa/api/alfred/chat  ←
                          │
        shared Supabase: alfred_conversations + alfred_messages
```

- **Canonical endpoint:** `POST /api/alfred/chat` (Vercel AI SDK 6 `streamText`,
  tool-calling, `stopWhen: stepCountIs(...)`). Emits a custom data part
  `{ type: 'data-conversation', id }` early in the stream so clients learn the
  conversation id; persists messages in `onFinish`.
- **Dual auth** (`lib/alfred/resolve-user.ts`): resolves the caller from either
  an `Authorization: Bearer <supabase access_token>` (used by alfred.motta.cpa)
  or the Supabase session cookie (in-Hub). Identity is **never** trusted from the
  request body. Returns a `ResolvedAlfredUser` (teamMemberId, fullName, email,
  role, department, karbonUserKey, isServiceAccount, resolvedVia).
- **CORS** (`lib/alfred/cors.ts`): `applyAlfredCors()` echoes the single allowed
  origin from `ALFRED_PUBLIC_ORIGIN`, with credentials, on both the OPTIONS
  preflight and the streamed response. Used by chat, conversations, whoami,
  health.
- **Service account** (`lib/alfred/service-account.ts`): a singleton
  `team_members` row (`Info@mottafinancial.com`, `is_service_account = true`) is
  the firm-level identity outbound actions (emails, notes) are attributed to,
  "on behalf of" the requesting user. Cannot be deactivated.
- **Policy seam** (`lib/alfred/policy.ts`): `buildPolicy({ audience, currentUser })`
  returns allowed tools + table allowlist + a system-prompt suffix. `audience`
  is `'staff'` today; `'client'` throws (reserved for a future client-facing
  ALFRED) so it's a switch-flip, not a rewrite.
- **Table allowlist** (`lib/alfred/allowed-tables.ts`): `ALLOWED_TABLES` +
  `TABLE_SCHEMAS` + `buildTableCatalog()`, shared by the chat tools and the REST
  data API so they never drift.
- **REST surface** (`/api/alfred/{data,schema,search,stats}`): JSON query
  endpoints, auth-gated by `lib/alfred/auth-guard.ts` (Supabase session **or**
  `x-alfred-secret`).
- **Health/whoami:** `/api/alfred/health` (public; reports `ok`,
  `supabaseConfigured`, `alfredServiceAccountFound`, `version`) and
  `/api/alfred/whoami` (auth required; reports the resolved user + `resolvedVia`).

### Hub env vars for ALFRED

```
ALFRED_PUBLIC_ORIGIN=https://alfred.motta.cpa
ALFRED_API_SECRET=<random>
SUPABASE_COOKIE_DOMAIN=.motta.cpa
KARBON_ALFRED_USER_KEY=<karbon user key for Info@mottafinancial.com>
```

### alfred-chat env vars

```
NEXT_PUBLIC_SUPABASE_URL=<same project as Hub>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same project as Hub>
NEXT_PUBLIC_HUB_CHAT_URL=https://hub.motta.cpa/api/alfred/chat
NEXT_PUBLIC_HUB_CONVERSATIONS_URL=https://hub.motta.cpa/api/alfred/conversations
SUPABASE_COOKIE_DOMAIN=.motta.cpa
```

> **Critical:** both apps must use the **same Supabase project**. Different
> projects → the JWT minted on alfred.motta.cpa won't validate on the Hub → 401s.

---

## 5. Key data model (selected tables)

- `team_members` — staff; canonical identity. Includes `is_active`,
  `is_service_account`, `auth_user_id`, `karbon_user_key`, `title`, `role`,
  `department`.
- `client_groups` — the firm's canonical "client" unit (a family + their related
  entities). **Preferred join target for new client-scoped features.**
- `organizations`, `contacts` — legal entities and people.
- `work_items` — Karbon work items (the main unit of client work).
- `debriefs`, `karbon_notes`, `karbon_tasks`, `karbon_timesheets` — activity.
- `invoices`, `payments`, `recurring_revenue`, `services` — financial.
- `tax_returns` — tax return records (links to ProConnect engagements).
- `alfred_conversations`, `alfred_messages` — ALFRED chat persistence (RLS:
  user sees own; service account sees all).
- `alfred_client_summaries` — **(planned)** per-client ALFRED-generated overview
  with human-editable `pinned_notes`.

---

## 6. ProConnect Tax integration

### 6.1 Goal & the critical constraint

**Goal:** fully integrate Intuit ProConnect Tax Online (PTO) with the Hub and,
ultimately, **prepare a 1040 with no manual input** (ALFRED reads source docs →
populates the return → human reviews → e-file). Intuit releases the API in
**phases**; we must integrate the current two APIs before the next phase unlocks.

**The catalog gap (read this first).** The Import API writes values into field
addresses (`series → prefix → code → suffix`, e.g. `s11/p0/c43/x1000`) but the
two documents we have **do not include the catalog that maps a code to its
meaning** (e.g. "c43 = wages"). That catalog (Intuit's "IVCS"/"FRF" content) is
expected in a later phase or by direct request to Intuit. Consequence:

- **Buildable now (Layer A — plumbing):** connect, sync clients, create returns,
  Export field data, Import field data (to *known* codes), webhooks.
- **Blocked on the catalog (Layer B):** knowing which code a given 1040 line maps
  to. Bootstrap partially by Exporting manually-prepared reference returns and
  recording the populated codes.
- **Depends on B (Layer C — intelligence):** ALFRED reading W-2/1099/K-1 →
  mapping to codes → dryRun → import.

**v1 proof case:** single filer, one W-2, standard deduction. Smallest catalog
footprint that exercises the full connect → create → export → dryRun → import →
reconcile loop.

### 6.2 Intuit platform APIs (foundational)

Base hosts (production only — **PTO has no sandbox**):

| Service | Host |
|---|---|
| Client Service | `https://client.accountant.intuit.com` |
| Engagement Service | `https://engagement.accountant.intuit.com` |
| Data Service | `https://protaxdata.api.intuit.com` |
| OAuth (authorize) | `https://appcenter.intuit.com` |
| OAuth (token/revoke) | `https://oauth.platform.intuit.com`, `https://developer.api.intuit.com` |

**Clients (Customers)** — key `oiiClientId`:
- `GET  {CLIENT_SERVICE}/v1/clients` — all clients
- `GET  {CLIENT_SERVICE}/v1/clients?oiiClientId=...` — one client
- `POST {CLIENT_SERVICE}/v1/clients` — create (individual: `person{...}`;
  business: `organization{...}`; includes names, phoneNumbers, emailAddresses,
  physicalAddresses, `taxId`, `dateOfBirth`, `clientState`). **Do not create
  duplicates — they're hard to delete.**
- `PUT  {CLIENT_SERVICE}/v1/clients?oiiClientId=...` — update

**Engagements (Tax Returns)** — key `id.value`:
- `GET {ENGAGEMENT_SERVICE}/v2/engagements?source=ITO&period={taxYear}&oiiClientId=...`
  — **`period` is the TAX year, not calendar year.**
- `GET {ENGAGEMENT_SERVICE}/v2/engagements/{engagementId}` — includes
  `lockInfo`, `taxFiling.filings[].filingStatuses[]`, `esignature.envelopes[]`,
  `customStatus`, `state`.
- `GET {ENGAGEMENT_SERVICE}/v1/custom-status?source=ITO` — work-status list.

**Create Tax Return** (Data Service):
- `POST {DATA_SERVICE}/v2/clients/oii-client/{clientOiiId}/returns`
  body: `{ "name", "type", "year", "source" }`.
  - `type` mapping: `IND`→1040, `COR`→1120, `SCO`→1120S, `PAR`→1065,
    `FID`→1041, `EXM`→990, `GFT`→709.
  - **Proforma:** set `source` = prior-year engagement id to roll forward.

**Webhooks:** POST to your endpoint on `Client`, `TaxReturn`,
`TaxReturnWorkStatus` events (Create/Update/Delete). Payload:
`eventNotifications[].dataChangeEvent.entities[]` with `name`, `id`,
`operation`, `lastUpdated`. A **verifier token** (from the portal) validates
incoming calls.

### 6.3 Intuit Phase 1 API — Series Map Export & Import

Scoped to a single return. Module `ind` (1040) only in Phase 1.

**Export:**
```
GET {DATA_BASE_URL}/v2/clients/{clientId}/returns/{returnId}/data
```
Returns the full nested series map plus metadata:
`name, clientName, year, type, data, efileItems[], agency[], version (UUIDv1),
seriesVersion[], id_uuid, id_client, id_firm, createdTime, createdBy`.

Data model:
```
data → {seriesId} → {prefixId} → {codeId} → {suffixId} → {
  val?, desc?, src?, tsj?, scope?, cityAbbrev?, importSource?, source?
}
```
Constants: `s1` = federal series, `p0` = default prefix, `x1000` = default
suffix. Missing property = "not set" (treat as null). `tsj` ∈ {T, S, J, N}.

**Import (one series per call):**
```
POST {DATA_BASE_URL}/v2/clients/{clientId}/returns/{returnId}/import/series/{seriesId}
```
Body:
```json
{
  "version": "<UUIDv1 of the series; null if first write to this series>",
  "dryRun": false,
  "entries": [
    { "prefixId":"p0", "codeId":"c43", "suffixId":"x1000",
      "val":"150000", "desc":"", "tsj":"T", "src":"US", "source":"" }
  ]
}
```
- **≤ 500 entries per call.** `seriesId` matches `^s\d{1,6}$`; `codeId` matches
  `^c\d{1,10}$`.
- **`dryRun: true`** runs full validation without persisting — use for
  "validate before import".
- **Partial success:** HTTP 200 even with per-entry errors; only request-level
  problems are 4xx. Response: `summary{totalImported,totalErrors,dryRun}` +
  `results[]{seriesId,importedCount,errorCount,version,errors[]}`. Each error has
  `prefixId,codeId,suffixId,errorDetails[]{code,field,message}`.
- **NOT idempotent** — repeated calls accumulate writes. De-dup before retry.
- **Agencies are not auto-created** — referencing a missing agency persists the
  value but it won't show in the PTO UI until a user adds the agency.

**Error codes:** request-level (4xx): `INVALID_SERIES_ID`,
`ENTRIES_LIMIT_EXCEEDED`, `INVALID_BODY`, `UNAUTHENTICATED`, `ACCESS_DENIED`,
`RETURN_NOT_FOUND`, `PAYLOAD_TOO_LARGE`, `RETURN_LOCKED` (423), `RATE_LIMITED`
(429, honor `Retry-After`), `INTERNAL_ERROR`. Per-entry (HTTP 200):
`CATALOG_SERIES_NOT_FOUND`, `INVALID_CODE`, `INVALID_PREFIX`,
`SUB_FIELD_NOT_ALLOWED`, `FIELD_RULE_VIOLATION`, `INVALID_EIN_FORMAT`,
`INVALID_SSN_FORMAT`, `INVALID_TAX_ID_FORMAT` (PII-safe — values never echoed).

### 6.4 OAuth & credentials

- **Flow:** OAuth 2.0 authorization_code (same Intuit platform as QuickBooks,
  different scope). **Only the firm's Primary Admin can connect.** Import is only
  accessible via the Primary Admin's token.
- **Scope:** `com.intuit.proconnect.taxreturns` (must be allow-listed for the app
  by Intuit during onboarding).
- **Authorize:** `https://appcenter.intuit.com/connect/oauth2?client_id=...&response_type=code&scope=com.intuit.proconnect.taxreturns&redirect_uri=...&state=...&product=ITO`
- **Token/refresh:** `POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
  with `Authorization: Basic base64(client_id:client_secret)`,
  `Content-Type: application/x-www-form-urlencoded`.
- **All app config is under the Production tab** in the Intuit Developer portal
  (Keys & credentials, Redirect URIs, App URLs, Webhooks). Development tab is the
  QuickBooks sandbox and does **not** apply to ProConnect.

Registered URLs (Production):

| Portal field | Value |
|---|---|
| Redirect URI | `https://hub.motta.cpa/api/proconnect/oauth/callback` |
| Launch URL | `https://hub.motta.cpa/api/proconnect/oauth/launch` |
| Connect/Reconnect URL | `https://hub.motta.cpa/api/proconnect/oauth/connect` |
| Disconnect URL | `https://hub.motta.cpa/api/proconnect/oauth/disconnect` |
| Webhook endpoint | `https://hub.motta.cpa/api/proconnect/webhooks` |

### 6.5 Hub-side design (planned)

```
lib/proconnect/
  oauth.ts        authorize URL, exchange/refresh/revoke, getValidAccessToken(realmId)
  oauth-state.ts  signed CSRF state (mint/verify)
  client.ts       proconnectFetch(service, path, opts): Bearer + intuit-tid +
                  5 TPS token-bucket limiter + backoff (1s→30s, honor Retry-After)
                  + single 401-refresh-retry
  clients.ts      list/get/create(individual|business)/update
  engagements.ts  listEngagements({oiiClientId,period,source}), getEngagement, getCustomStatuses
  returns.ts      exportReturnData(clientId,returnId), createReturn(oiiClientId,{name,type,year,source}),
                  importSeries(clientId,returnId,seriesId,{version,dryRun,entries})
  catalog.ts      Layer B field-code dictionary (pluggable; starts small)
  mappers.ts      client_groups ↔ oiiClient; tax_returns ↔ engagement

app/api/proconnect/
  oauth/{connect,callback,launch,disconnect}/route.ts
  clients/sync/route.ts
  returns/[id]/export/route.ts
  returns/[id]/import/route.ts        # dryRun-first; commit requires a passing dryRun
  webhooks/route.ts
```

**Supabase tables (planned):**
- `proconnect_connections` — encrypted tokens, `realm_id`, `firm_uuid`,
  expiries, `connected_by_team_member_id`, `is_active`. (Migration
  `scripts/070_proconnect_connections.sql`.)
- `proconnect_clients` — `oii_client_id` ↔ `hub_client_group_id`, raw, synced_at.
- `proconnect_returns` — `engagement_id`/`return_id` ↔ `hub_tax_return_id`,
  period, type, status, locked, raw series map, version stamps.
- `proconnect_field_catalog` — Layer B: series/code/suffix → label + rules.
- `proconnect_import_log` — every dryRun + commit, **PII-redacted** (codes &
  error codes only, never `val`), keyed by `intuit-tid` for de-dup.

**Env vars (Hub / v0-motta-hub project):**
```
PROCONNECT_CLIENT_ID
PROCONNECT_CLIENT_SECRET
PROCONNECT_REDIRECT_URI=https://hub.motta.cpa/api/proconnect/oauth/callback
PROCONNECT_TOKEN_KEY                 # 32-byte hex (openssl rand -hex 32)
PROCONNECT_WEBHOOK_VERIFIER_TOKEN
PROCONNECT_DATA_BASE_URL             # Phase 1 base URL; confirm with Intuit (likely https://protaxdata.api.intuit.com)
```

### 6.6 Non-negotiable integration rules

1. **Production-only → dryRun-first, always.** Every write path must require a
   green `dryRun` in the same session before a commit is possible. There is no
   sandbox; mistakes hit real returns.
2. **PII discipline.** Never log request bodies or field values. `proconnect_import_log`
   stores codes + error codes only. Mirror Intuit (they never echo SSN/EIN).
3. **Tokens encrypted at rest** (AES-256-GCM via `PROCONNECT_TOKEN_KEY`). They
   grant write access to every return in the firm.
4. **Idempotency:** Import accumulates. De-dup before retry; check
   `proconnect_import_log` by `intuit-tid` before re-sending.
5. **Respect `RETURN_LOCKED` (423)** — never force-write a return open elsewhere.
6. **Rate limit:** 5 TPS per app per user. Client-side token-bucket + exponential
   backoff with jitter (1s→30s), honor `Retry-After`.
7. **Client identity bridge:** PTO clients map to `client_groups` (same unit as
   ALFRED client summaries) for a unified client profile.

### 6.7 Staged roadmap

| Stage | Deliverable | Depends on | Status |
|---|---|---|---|
| 1 | OAuth connect + token storage + settings card | Prompt 1 | planned/in progress |
| 2 | HTTP client + read-only Client/Engagement/Data wrappers | Prompt 2 | planned |
| 3 | Export sync + mirror tables + client linking UI | Prompt 3 | planned |
| 4 | Import pipeline (dryRun-first + commit + audit log) | Prompt 4 | planned |
| 5 | Webhooks (Client/TaxReturn/WorkStatus) → Hub notifications | Prompt 5 | planned |
| 6 | Catalog bootstrap (reverse-engineer codes from reference returns) | Prompt 6 | planned |
| — | No-input 1040 (ALFRED doc→fields) | Layers B + C + future phase | future |

---

## 7. How this Hub is developed (workflow)

- The Hub is largely built through **v0.app prompts** (one focused change per
  prompt, auto-committed and pushed). Prefer giving v0 a single, self-contained
  instruction that names the files/patterns to copy.
- Migrations in `scripts/` are applied **manually** in Supabase after the code
  lands.
- Secrets go into **Vercel env vars** (per project, all environments) — never the
  repo.
- When adding to an integration, **read the nearest existing equivalent first**
  (Calendly/Zoom for OAuth, Karbon for sync/webhooks, the ALFRED libs for
  assistant features) and match its conventions.

---

## 8. Glossary

- **oiiClientId** — Intuit's "One Intuit Identity" client id; the key for the
  Client Service.
- **engagement** — Intuit's term for a tax return instance (per client/year).
- **realm_id** — the firm/company id the OAuth token represents.
- **series / prefix / code / suffix** — the 4-level address of a field in a
  ProConnect return (`s1/p0/c43/x1000`).
- **tsj** — Taxpayer / Spouse / Joint / None designation on a field.
- **proforma** — rolling a prior-year return forward as the basis for a new year.
- **IVCS / FRF catalog** — Intuit's internal field/validation content that
  defines valid codes and rules per module/year (the "catalog gap").
- **ALFRED service account** — `Info@mottafinancial.com`; the firm identity
  outbound ALFRED actions are attributed to.
