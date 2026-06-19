-- ════════════════════════════════════════════════════════════════════
-- 347_merge_duplicate_contacts.sql
--
-- Safely consolidates duplicate Hub contacts / organizations that the
-- pre-fix Karbon push path created (it minted a second Karbon record
-- without searching Karbon first, which then re-imported as an extra
-- Hub row). Going forward this is prevented by search-before-create in
-- lib/karbon/client-sync.ts + the email-adoption guard in
-- lib/karbon/upsert.ts; this script cleans up what already exists.
--
-- SAFETY MODEL
--   • A group is a TRUE duplicate only when BOTH the email AND the
--     normalized name match. Email alone is NOT enough — one email is
--     routinely shared by spouses/family or by an owner across many
--     distinct LLCs, and merging those would destroy real records.
--   • Every deleted row is copied verbatim (jsonb) into hub_merge_backup
--     first, and every merge is recorded in hub_merge_log.
--   • FK re-pointing is generic (introspects information_schema). When
--     re-pointing a junction row would collide with a row the keep
--     record already has (composite-unique junctions), the dup's now
--     redundant junction row is dropped instead — no data is orphaned.
--   • hub_merge_email_duplicates(..., p_dry_run => true) (the default)
--     REPORTS only and changes nothing.
--
-- USAGE
--   select * from public.hub_merge_email_duplicates('contacts', true);   -- preview
--   select * from public.hub_merge_email_duplicates('contacts', false);  -- execute
-- ════════════════════════════════════════════════════════════════════

-- 1. Audit + backup tables ------------------------------------------------
-- Dropped + recreated so the schema always matches this script. These are
-- internal audit tables (not referenced by app code), so this is safe; any
-- prior merge history is preserved only if you snapshot before re-running.

drop table if exists public.hub_merge_backup;
drop table if exists public.hub_merge_log;

create table if not exists public.hub_merge_backup (
  id          bigint generated always as identity primary key,
  merged_at   timestamptz not null default now(),
  source_table text not null,
  kept_id     uuid not null,
  deleted_id  uuid not null,
  deleted_row jsonb not null
);

create table if not exists public.hub_merge_log (
  id          bigint generated always as identity primary key,
  merged_at   timestamptz not null default now(),
  source_table text not null,
  kept_id     uuid not null,
  deleted_id  uuid not null,
  child_table text,
  child_column text,
  action      text not null,   -- 'repointed' | 'collision_dropped' | 'deleted_row'
  rows_affected integer not null default 0
);

-- 2. Record-level merge ---------------------------------------------------
--
-- Re-points every FK that references public.<p_table>(id) from dup -> keep,
-- backs the dup row up, then deletes it. Runs in the caller's transaction.

drop function if exists public.hub_merge_record(text, uuid, uuid);
create or replace function public.hub_merge_record(
  p_table text,
  p_keep  uuid,
  p_dup   uuid
) returns void
language plpgsql
as $$
declare
  fk          record;
  v_backup    jsonb;
  v_count     integer;
begin
  if p_table not in ('contacts', 'organizations') then
    raise exception 'hub_merge_record: unsupported table %', p_table;
  end if;
  if p_keep = p_dup then
    raise exception 'hub_merge_record: keep and dup are identical (%).', p_keep;
  end if;

  -- Re-point each child FK column referencing this parent table.
  for fk in
    select tc.table_schema as child_schema,
           tc.table_name   as child_table,
           kcu.column_name as child_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_name = p_table
      and ccu.column_name = 'id'
  loop
    -- Try a straight re-point. If a UNIQUE/PK collision occurs (e.g. a
    -- junction row already exists for the keep record), fall back to
    -- deleting the dup's redundant child rows instead.
    begin
      execute format(
        'update %I.%I set %I = $1 where %I = $2',
        fk.child_schema, fk.child_table, fk.child_column, fk.child_column
      ) using p_keep, p_dup;
      get diagnostics v_count = row_count;
      if v_count > 0 then
        insert into public.hub_merge_log
          (source_table, kept_id, deleted_id, child_table, child_column, action, rows_affected)
        values (p_table, p_keep, p_dup, fk.child_schema || '.' || fk.child_table,
                fk.child_column, 'repointed', v_count);
      end if;
    exception when unique_violation or check_violation then
      execute format(
        'delete from %I.%I where %I = $1',
        fk.child_schema, fk.child_table, fk.child_column
      ) using p_dup;
      get diagnostics v_count = row_count;
      insert into public.hub_merge_log
        (source_table, kept_id, deleted_id, child_table, child_column, action, rows_affected)
      values (p_table, p_keep, p_dup, fk.child_schema || '.' || fk.child_table,
              fk.child_column, 'collision_dropped', v_count);
    end;
  end loop;

  -- Back up the full dup row, then delete it.
  execute format('select to_jsonb(t) from %I t where t.id = $1', p_table)
    into v_backup using p_dup;

  if v_backup is null then
    raise notice 'hub_merge_record: dup % not found in %, skipping', p_dup, p_table;
    return;
  end if;

  insert into public.hub_merge_backup (source_table, kept_id, deleted_id, deleted_row)
  values (p_table, p_keep, p_dup, v_backup);

  execute format('delete from %I where id = $1', p_table) using p_dup;

  insert into public.hub_merge_log
    (source_table, kept_id, deleted_id, child_table, child_column, action, rows_affected)
  values (p_table, p_keep, p_dup, p_table, 'id', 'deleted_row', 1);
end;
$$;

-- 3. Duplicate driver (email + NORMALIZED NAME) --------------------------
--
-- A group is a TRUE duplicate only when BOTH the email AND the normalized
-- name match. Normalization lowercases and strips every non-alphanumeric
-- char, so "John  Hernandez" == "john hernandez". Conservative by design:
-- near-misses ("Nick" vs "Nicholis") are left for manual review.
--
-- Keep selection prefers a row WITH a Karbon key, then the earliest
-- created_at, then the smallest id. p_dry_run => true (default) REPORTS only.

drop function if exists public.hub_merge_email_duplicates(text, boolean);
create or replace function public.hub_merge_email_duplicates(
  p_table   text,
  p_dry_run boolean default true
) returns table (
  match_email text,
  match_name  text,
  kept_id     uuid,
  deleted_id  uuid,
  performed   boolean
)
language plpgsql
as $$
declare
  v_email_col text := 'primary_email';
  v_name_col  text := case when p_table = 'contacts' then 'full_name' else 'name' end;
  v_key_col   text := case when p_table = 'contacts'
                           then 'karbon_contact_key'
                           else 'karbon_organization_key' end;
  grp         record;
  v_keep      uuid;
  dup         uuid;
begin
  if p_table not in ('contacts', 'organizations') then
    raise exception 'hub_merge_email_duplicates: unsupported table %', p_table;
  end if;

  for grp in execute format($q$
    select lower(trim(%1$I)) as email,
           regexp_replace(lower(trim(%2$I)), '[^a-z0-9]', '', 'g') as norm_name,
           min(%2$I) as sample_name,
           array_agg(id order by
             (%3$I is not null) desc,   -- rows WITH a Karbon key first
             created_at asc,            -- then oldest
             id asc) as ids
    from %4$I
    where %1$I is not null and trim(%1$I) <> ''
      and %2$I is not null
      and regexp_replace(lower(trim(%2$I)), '[^a-z0-9]', '', 'g') <> ''
    group by 1, 2
    having count(*) > 1
  $q$, v_email_col, v_name_col, v_key_col, p_table)
  loop
    v_keep := grp.ids[1];
    foreach dup in array grp.ids[2:array_length(grp.ids, 1)]
    loop
      match_email := grp.email;
      match_name  := grp.sample_name;
      kept_id     := v_keep;
      deleted_id  := dup;
      performed   := not p_dry_run;
      if not p_dry_run then
        perform public.hub_merge_record(p_table, v_keep, dup);
      end if;
      return next;
    end loop;
  end loop;
end;
$$;
