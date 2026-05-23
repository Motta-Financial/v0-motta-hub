# Hub Subdomain Migration — `hub.motta.cpa`

This is the runbook for cutting Motta Hub over from its current
`*.vercel.app` and `mottafinancial.com` URLs to the new
`hub.motta.cpa` subdomain. The public marketing site
(`newmottawebsite`) takes the apex `motta.cpa`; the Hub is the
backend / authenticated app behind the Login button.

Run these in order. Each section calls out who can do it (Vercel CLI
vs. provider dashboard) and what breaks if it's skipped.

---

## 0. Pre-flight

- [ ] Confirm the public-website Vercel project (`newmottawebsite`)
      already has `motta.cpa` and `www.motta.cpa` attached. Check the
      "Domains" tab on that project.
- [ ] Confirm the Hub (this) project owns the DNS apex via Vercel's
      nameservers, or coordinate with whoever owns the DNS so we can
      add a `CNAME hub` record.
- [ ] Decide on the cutover window. The OAuth dashboards
      (Auth0, Calendly, Zoom, ProConnect) accept multiple callback
      URLs at once, so you can keep the old URL active while you add
      the new one — zero downtime is achievable if you're careful.

---

## 1. Add `hub.motta.cpa` to the Hub Vercel project

Vercel project: `prj_VvPN85eN7oCBBRzcLD7YYokXbxo8` (team `motta`).

```
vercel domains add hub.motta.cpa --scope team_fZwCKeDMPzz8mjsHhY4AAdh1
# Then attach to the Hub project (not newmottawebsite):
vercel project --scope team_fZwCKeDMPzz8mjsHhY4AAdh1 \
  add-domain v0-motta-hub hub.motta.cpa
```

Or via the dashboard: Hub project → Settings → Domains → "Add" →
`hub.motta.cpa`. Vercel will give you a CNAME target
(`cname.vercel-dns.com`). Add it at your DNS provider.

Wait for Vercel to issue the SSL certificate (usually < 5 min).

---

## 2. Update Hub environment variables

Run from `/vercel/share/v0-project` once `VERCEL_TOKEN` is set in
your shell. **Each `env rm` is destructive** — confirm the existing
value first if you want to roll back.

```bash
TOKEN=$VERCEL_TOKEN
TEAM=team_fZwCKeDMPzz8mjsHhY4AAdh1

# View what's there now (sanity check before destruction)
vercel --token=$TOKEN --scope=$TEAM env ls production \
  | grep -E 'APP_URL|APP_BASE_URL|AUTH0_BASE_URL|CALENDLY_REDIRECT|ZOOM_REDIRECT|PROCONNECT_REDIRECT|DEV_SUPABASE_REDIRECT'

# Replace each value. The `-` in `add` reads from stdin.
for KV in \
  "NEXT_PUBLIC_APP_URL=https://hub.motta.cpa" \
  "APP_BASE_URL=https://hub.motta.cpa" \
  "AUTH0_BASE_URL=https://hub.motta.cpa" \
  "CALENDLY_REDIRECT_URL=https://hub.motta.cpa/api/calendly/oauth/callback" \
  "ZOOM_REDIRECT_URI=https://hub.motta.cpa/api/zoom/oauth/callback" \
  "PROCONNECT_REDIRECT_URI=https://hub.motta.cpa/api/proconnect/oauth/callback"; do
  KEY="${KV%%=*}"
  VAL="${KV#*=}"
  vercel --token=$TOKEN --scope=$TEAM env rm "$KEY" production --yes 2>/dev/null || true
  printf "%s" "$VAL" | vercel --token=$TOKEN --scope=$TEAM env add "$KEY" production
done
```

Also set the public-site origin allowlist (used by
`lib/cors.ts`) so the website's previews and prod can call
`/api/public/*`:

```bash
printf "%s" "https://motta.cpa,https://www.motta.cpa,https://newmottawebsite.vercel.app,https://*.vercel.app" \
  | vercel --token=$TOKEN --scope=$TEAM env add PUBLIC_CORS_ALLOWED_ORIGINS production
```

> The wildcard `https://*.vercel.app` is intentional — it lets the
> website team's preview deployments call the prod Hub during QA.
> If you want to lock that down further, replace it with the
> specific preview pattern Vercel gives that project (e.g.
> `https://newmottawebsite-*-motta.vercel.app`).

After all env updates: redeploy the Hub project so the new values
are picked up by serverless functions.

```bash
vercel --token=$TOKEN --scope=$TEAM --prod
```

---

## 3. OAuth provider dashboards (manual)

Vercel CLI cannot touch these. Do them in this order — none of the
old URLs need to be removed yet, just **add** the new one alongside.

### Auth0 (auth0.com → Applications → your Hub app)

- [ ] Allowed Callback URLs: add `https://hub.motta.cpa/api/auth/callback`
- [ ] Allowed Logout URLs: add `https://hub.motta.cpa`
- [ ] Allowed Web Origins: add `https://hub.motta.cpa`
- [ ] Save. Test login from the new URL. Once confirmed, remove the
      old `*.vercel.app` and `mottafinancial.com` entries.

### Calendly (calendly.com/integrations/api_webhooks → Apps)

- [ ] Edit your OAuth app → Redirect URIs: add
      `https://hub.motta.cpa/api/calendly/oauth/callback`
- [ ] (No need to remove the old one until the next OAuth dance —
      tokens already issued keep working.)

### Zoom (marketplace.zoom.us → Manage → your app)

- [ ] App Credentials → Redirect URL for OAuth: change to
      `https://hub.motta.cpa/api/zoom/oauth/callback`. Zoom only
      allows ONE redirect URL per app, so this is a clean swap.
- [ ] Whitelist URL: same value.
- [ ] Event Subscriptions → endpoint URL (if used):
      `https://hub.motta.cpa/api/zoom/webhook`

### ProConnect / Intuit (developer.intuit.com → My Apps)

- [ ] Keys & OAuth → Production Redirect URIs: add
      `https://hub.motta.cpa/api/proconnect/oauth/callback`
- [ ] Save. Coordinate with whoever holds the active refresh token —
      no re-consent needed unless we change scopes.

### Supabase (supabase.com → Auth → URL Configuration)

- [ ] Site URL: change to `https://hub.motta.cpa`
- [ ] Redirect URLs: add `https://hub.motta.cpa/**`. Leave the old
      ones until cutover is verified, then remove.

### Stripe (dashboard.stripe.com → Webhooks)

- [ ] If a webhook is currently pointed at the old domain, add a new
      endpoint at `https://hub.motta.cpa/api/stripe/webhook` and
      copy the signing secret into `STRIPE_WEBHOOK_SECRET` on Vercel
      (or wherever it lives today). Disable the old endpoint after
      a few days of clean deliveries.

### Ignition

- [ ] Ignition → Apps → your OAuth app → Redirect URI: add
      `https://hub.motta.cpa/api/ignition/oauth/callback`

### Karbon

- [ ] Karbon API doesn't use OAuth (bearer token); no callback to
      change. The new Hub URL just needs to be allowlisted in any
      Karbon team-level integration whitelist if one exists.

### Resend (RESEND_FROM_EMAIL)

- [ ] If sending from a domain other than `motta.cpa` today,
      consider switching to `noreply@motta.cpa` so emails align
      with the new brand surface. Verify the DNS records in Resend.

---

## 4. Verify after cutover

In a clean browser window:

- [ ] `https://hub.motta.cpa` → redirects to Auth0 → returns to Hub
      logged in.
- [ ] `https://hub.motta.cpa/clients` → table loads, no 500s.
- [ ] `https://hub.motta.cpa/api/public/contact` → CORS preflight
      from `https://motta.cpa` returns 204 (use the test snippet
      below).
- [ ] Submit a real Contact Form on the marketing site → row appears
      in `website_contact_submissions` and a contact is auto-created
      in `contacts` with `source='website_contact'`.
- [ ] Submit a real Intake Form on the marketing site → row appears
      in `jotform_intake_submissions` (`form_id='website'`), a
      Karbon contact is queued/pushed, the team notify email lands.
- [ ] Calendly bookings still create Hub contacts (i.e. webhook
      survived the URL flip).
- [ ] Zoom recent-meetings sync still runs (cron uses
      `NEXT_PUBLIC_APP_URL` if it self-calls; otherwise unaffected).

### CORS preflight test snippet

```bash
curl -i -X OPTIONS https://hub.motta.cpa/api/public/contact \
  -H "Origin: https://motta.cpa" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

Expected: `HTTP/2 204` plus
`Access-Control-Allow-Origin: https://motta.cpa`.

---

## 5. Redirect the old domain

Once the new URL has been live and clean for 24-48h:

- [ ] In Vercel, attach `mottafinancial.com` and `www.mottafinancial.com`
      to the **public-website** project as 308 redirects to
      `https://motta.cpa`.
- [ ] Remove old `*.vercel.app` callback URLs from Auth0, Calendly,
      ProConnect, Ignition, Stripe.
- [ ] Update `next.config.mjs` — the `frame-ancestors` CSP allows
      `https://www.mottafinancial.com` today as a transitional
      affordance; remove that line once the redirect is in place.

---

## 6. Rollback

If something breaks during cutover:

1. In the Hub Vercel dashboard → Domains, the old URL is still
   attached — traffic still resolves there.
2. Revert the env vars (the values are stored in Vercel's history;
   `vercel env pull` and re-add the previous values).
3. Auth0 / Calendly / Zoom / ProConnect — leave the old callback
   URLs in place during the transition window so a rollback is
   instantaneous.

The only one-way door is the Zoom redirect URL (single-valued). Do
that one last, immediately before final verification.
