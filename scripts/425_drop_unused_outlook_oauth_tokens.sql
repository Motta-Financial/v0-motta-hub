-- 425: Remove the second, unused Outlook token table.
--
-- Two Outlook OAuth implementations were built in parallel. The one that
-- shipped stores tokens in outlook_connections (scripts/424). The other
-- created outlook_oauth_tokens, which was applied to production but never
-- written to by any deployed code -- its own branch never merged.
--
-- Leaving it is worse than it looks: the next person reading the schema
-- finds two plausible-looking mailbox token tables with no way to tell
-- which one is live, and a sync pointed at the wrong one fails silently
-- with "no connections".
--
-- Guarded: the drop only runs if the table is genuinely empty. If a row
-- ever appeared, that means something IS writing to it and this assumption
-- is wrong -- in which case the migration raises instead of destroying
-- credentials.

do $$
declare
  v_exists boolean;
  v_rows bigint;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'outlook_oauth_tokens'
  ) into v_exists;

  if not v_exists then
    raise notice '425: outlook_oauth_tokens already absent, nothing to do';
    return;
  end if;

  execute 'select count(*) from public.outlook_oauth_tokens' into v_rows;

  if v_rows > 0 then
    raise exception
      '425: refusing to drop outlook_oauth_tokens — it has % row(s). Something is writing to it; reconcile the two implementations before dropping.', v_rows;
  end if;

  drop table public.outlook_oauth_tokens;
  raise notice '425: dropped unused outlook_oauth_tokens';
end $$;
