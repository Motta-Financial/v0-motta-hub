# Motta Hub

The internal operating system for Motta Financial — client master data, work
management, revenue, meetings, tax production, and ALFRED (the firm's AI
assistant).

Production: **[hub.motta.cpa](https://hub.motta.cpa)**

## Documentation

| Document | What's in it |
|---|---|
| **[docs/SPEC.md](docs/SPEC.md)** | Platform specification — architecture, trust model, data model, integrations, ProConnect and 1040 subsystems, configuration, known gaps. **Start here.** |
| **[docs/API_REFERENCE.md](docs/API_REFERENCE.md)** | All 299 endpoints, grouped by domain, with auth class and purpose. |
| [docs/public-api.md](docs/public-api.md) | The contract between the Hub and the motta.cpa marketing site. |
| [docs/alfred-integration-guide.md](docs/alfred-integration-guide.md) | ALFRED integration guide. |
| [docs/proconnect-api-coverage-status.md](docs/proconnect-api-coverage-status.md) | ProConnect Open API coverage. |
| [docs/karbon-api-alignment.md](docs/karbon-api-alignment.md) | Karbon field alignment notes. |
| [docs/platform-efficiency-audit.md](docs/platform-efficiency-audit.md) | Efficiency and scalability audit. |

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Supabase Postgres 17 ·
Tailwind 4 · Vercel · Vercel AI Gateway

## Local development

```bash
npm install
vercel env pull          # populates .env.local, incl. VERCEL_OIDC_TOKEN for the AI Gateway
npm run dev
```

Before pushing:

```bash
npx tsc --noEmit
npm run build
```

There is **no CI** and no ESLint configuration — a local `next build` is the
only gate. See [SPEC.md §2](docs/SPEC.md#deployment).

## Deployment

Pushes to `main` auto-deploy to production via the Vercel project
`mottahub`. A second Vercel project, `v0-motta-hub`, is stale and missing
environment variables — **every** deployment on it reports ERROR regardless
of the commit. Ignore it.

## Database changes

Migrations are numbered SQL files in `scripts/` (`scripts/NNN-description.sql`),
applied in order via the Supabase API rather than the Supabase CLI. The
`supabase/migrations/` directory is not the source of truth.

---

*This repository was originally scaffolded by [v0.app](https://v0.app) and
may still receive automated pushes from v0 deployments.*
