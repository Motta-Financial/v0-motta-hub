-- 417: Read receipts for the client portal message thread.
--
-- The Messages surfaces on both sides have shown a "Seen" marker since the
-- first mock, but portal_messages (scripts/351) has no read column, so the
-- marker was never backed by anything and was removed from the staff tab.
-- This adds the column so it can come back honestly.
--
-- Semantics: read_at is stamped by the RECIPIENT side opening the thread.
--   · A client opening /client-portal/messages stamps the firm's messages.
--   · A staff member opening the Messages sub-tab stamps the client's.
-- A message is therefore "seen by the other party" iff read_at is not null.
-- Nulls stay null forever for messages nobody has opened, which is what the
-- absence of a marker should mean.

alter table public.portal_messages
  add column if not exists read_at timestamptz;

comment on column public.portal_messages.read_at is
  'When the other party first opened the thread containing this message. Null = not yet seen. Stamped by the recipient side, never the sender.';

-- Partial index: every read-stamping write filters on "unread, not mine",
-- and the unread set stays small relative to the table.
create index if not exists portal_messages_unread_idx
  on public.portal_messages (contact_id, organization_id, sender_role)
  where read_at is null;

-- ── Who may stamp ────────────────────────────────────────────────────────
-- scripts/351 gave portal_messages SELECT and INSERT policies only, so with
-- RLS on, UPDATE is denied to everyone -- including staff. Read receipts
-- need exactly one UPDATE, so grant exactly that one.
--
-- The policy scopes WHICH rows (same shape as portal_messages_select_scoped);
-- the column grant scopes WHICH column. RLS cannot restrict columns on its
-- own, so without the GRANT this policy would also let either side rewrite
-- the body of a message. Both halves are required.

drop policy if exists portal_messages_mark_read on public.portal_messages;
create policy portal_messages_mark_read on public.portal_messages
  for update
  using (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  )
  with check (
    public.is_staff()
    or contact_id in (select public.portal_accessible_contact_ids())
    or organization_id in (select public.portal_accessible_organization_ids())
  );

revoke update on public.portal_messages from authenticated;
grant update (read_at) on public.portal_messages to authenticated;
