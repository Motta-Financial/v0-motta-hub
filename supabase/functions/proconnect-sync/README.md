# ProConnect Sync - Supabase Edge Function

This Edge Function replaces the Vercel-based ProConnect sync that was hitting
the 60-second function timeout. Edge Functions support up to 400 seconds and
have no resume/partial logic to maintain.

## Architecture

```
Vercel Cron (nightly)
    ↓
/api/cron/proconnect-sync (Vercel)  ← thin wrapper, just invokes Edge Function
    ↓
Supabase Edge Function: proconnect-sync  ← does ALL the work
    ↓
Supabase tables (proconnect_clients, proconnect_engagements, etc.)
```

## Deployment

### 1. Set secrets

```bash
supabase secrets set \
  PROCONNECT_CLIENT_ID="$PROCONNECT_CLIENT_ID" \
  PROCONNECT_CLIENT_SECRET="$PROCONNECT_CLIENT_SECRET" \
  PROCONNECT_REFRESH_TOKEN="$PROCONNECT_REFRESH_TOKEN" \
  PROCONNECT_REALM_ID="$PROCONNECT_REALM_ID"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected.

### 2. Deploy the function

```bash
supabase functions deploy proconnect-sync --project-ref gylupzxitoebhqjnvzuw
```

### 3. Test it

```bash
curl -X POST \
  https://gylupzxitoebhqjnvzuw.supabase.co/functions/v1/proconnect-sync \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"syncType": "manual"}'
```

Expected response after ~30-90 seconds:

```json
{
  "success": true,
  "syncLogId": "...",
  "clientsSynced": 180,
  "engagementsSynced": 540,
  "customStatusesSynced": 12,
  "totalClients": 180,
  "errorCount": 0,
  "duration": 78000
}
```

## How it Differs From the Vercel Version

| Feature | Vercel Function | Supabase Edge Function |
|---------|-----------------|------------------------|
| Timeout | 60s hard limit | 400s |
| Resume logic | Required (and fragile) | Removed entirely |
| Partial states | Required | Removed |
| Parallel clients | 3 (timeout-bound) | 5 (no pressure) |
| Skip recently synced | Required | Removed |
| Code complexity | High | Low |
| Lines of code | ~700 | ~430 |

## Why We Migrated

The Vercel sync repeatedly hit 60s timeouts trying to process 180 clients.
We added timeout guards, resume indexes, partial states, and parallel batching
to work around the limit, but the resume logic was unreliable - clients never
fully synced because each run started over from index 0.

Supabase Edge Functions remove the timeout pressure entirely. The function
runs to completion in ~30-90 seconds total. No resume logic needed.

## Auth

The function expects `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`.

The Vercel cron at `/api/cron/proconnect-sync` proxies to this function using
the service role key from env vars.

## Logs

View Edge Function logs:

```bash
supabase functions logs proconnect-sync --project-ref gylupzxitoebhqjnvzuw
```

Or in the Supabase dashboard:
https://supabase.com/dashboard/project/gylupzxitoebhqjnvzuw/functions
