-- 427: Undo the lockout 424 caused, without giving the table away.
--
-- 424 did `revoke all ... from authenticated` on outlook_connections on
-- the assumption that only the service role touches it. That assumption
-- was wrong: every Outlook route (connections, threads, sync, callback,
-- disconnect) reads and writes this table with the per-request COOKIE
-- client, which runs as `authenticated`. The revoke therefore denied the
-- app access to its own table and every Outlook page started returning
-- 500 "permission denied for table outlook_connections".
--
-- The concern behind 424 was real and stands: portal clients hold genuine
-- `authenticated` sessions in this same project, and this table stores
-- Graph tokens carrying Mail.Read, Mail.ReadWrite and Mail.Send. Anyone
-- who can read a row can read and send that person's mail.
--
-- So grant the privilege back and let RLS do the work it should have done
-- in the first place -- scoped tighter than 424's intent, not looser:
--
--   * A staff member sees ONLY their own connection row. Not their
--     colleagues'. The routes only ever query their own row anyway
--     (.eq("team_member_id", teamMember.id)), so this costs nothing and
--     means a compromised staff session cannot enumerate the firm's
--     mailbox tokens.
--   * A portal client has no team_members row, so the subquery matches
--     nothing and every row is invisible. That is the protection 424 was
--     reaching for, expressed as a predicate instead of a missing grant.
--   * anon stays fully revoked.

grant select, insert, update, delete on public.outlook_connections to authenticated;
revoke all on public.outlook_connections from anon;

drop policy if exists outlook_connections_own on public.outlook_connections;
create policy outlook_connections_own on public.outlook_connections
  for all
  using (
    team_member_id in (
      select id from public.team_members where auth_user_id = (select auth.uid())
    )
  )
  with check (
    team_member_id in (
      select id from public.team_members where auth_user_id = (select auth.uid())
    )
  );

comment on table public.outlook_connections is
  'Per-staff-member Microsoft Graph tokens for Outlook mail/calendar sync. RLS: a session sees only its own team member row (scripts/427). Never expose access_token or refresh_token through an API response.';
