-- 396: Tie every debrief to a client — as far as the data honestly allows.
--
-- Starting point: 915 live debriefs, 563 linked, 352 unlinked.
-- Result: 564 linked, 25 staged for human review, 326 not recoverable.
--
-- Every candidate path was validated against a HOLDOUT first — the already-linked
-- debriefs, where the true answer is known — rather than assumed. Measured
-- precision decided whether a path was applied, staged, or discarded:
--
--   PATH                                        CANDIDATES  PRECISION  ACTION
--   Exact Karbon key -> contact/org                      2     100%     applied (script 394)
--   debrief_work_items junction (single work item)       1    99.4%     APPLIED HERE
--     (530-row holdout: 527 agree, 3 disagree)
--   Legacy Airtable code -> user_defined_identifier      25    88.1%     staged for review
--     (151-row holdout: 133 agree, 18 disagree)
--   Notes name exactly one organization                  16    15.2%     DISCARDED
--     (171-row holdout: 26 agree, 56 disagree)
--   Debrief author + date -> that member's meetings      57    24.6%     DISCARDED
--     (57-row holdout: 14 agree, 43 disagree)
--   karbon_work_url -> #/work/<key> or #/contacts/<key>  15       n/a    dead end
--     (13 work keys + 2 contact keys; ZERO exist in the Hub's synced data)
--
-- Two paths deserve comment because they look attractive and are not:
--
--  * NOTES-NAME-AN-ORGANISATION (15.2%) is noise. Organisation names like 'SEED'
--    or 'Ramp' occur in ordinary prose, and 89 of the 171 holdout hits were on
--    debriefs actually linked to a CONTACT. Staging these would have put 16
--    misleading rows in front of a reviewer.
--  * AUTHOR + DATE (24.6%) fails because team members hold several meetings a
--    day and debriefs are not written on the day of the meeting.
--
-- The legacy-code path could not be lifted. Requiring the debrief's own notes to
-- mention the resolved contact's surname — an independent signal — moved
-- precision from 87.7% to 89.7% on 29 rows, i.e. no useful lift, so it is not
-- used as a gate.
--
-- WHY 323 DEBRIEFS CANNOT BE TIED TO A CLIENT
-- They are short (avg 177 chars), human-written meeting notes that name people by
-- FIRST NAME ONLY — 'Talked to Greg about pricing', 'Met with Sarah who is a
-- friend of Andrew's', 'Caught up with David briefly'. First-name matching in a
-- 1,460-contact book is not a link, it is a guess. Many are also prospect or
-- referral conversations that have no client record by design, and at least one
-- is a vendor meeting ('Met with Steve and Juan from Intuit ProConnect') that
-- correctly has no client at all. Recovering these needs a human who was there,
-- or the Karbon/Airtable source that originally held the association.
--
-- Idempotent: the UPDATE re-filters on "still unlinked"; the candidate INSERT is
-- guarded by NOT EXISTS on any prior row for that (debrief, target) REGARDLESS of
-- status, so a rejected candidate is never re-proposed. Both verified to affect
-- 0 rows on a second run.
--
-- Run: psql "$POSTGRES_URL_NON_POOLING" -f scripts/396_debrief_client_link_review.sql

begin;

-- ── TIER A: the debrief_work_items junction (99.4% on a 530-row holdout) ──
-- This is an explicit work-item FK, not a heuristic. Restricted to debriefs whose
-- junction names exactly ONE work item so the target is unambiguous.
-- The single row this recovers is independently corroborated by its own notes:
-- 'Caught up with Sol for about an hour' -> work item client 'Solomon Schwartz'.
update public.debriefs d
set contact_id      = w.contact_id,
    organization_id = w.organization_id,
    work_item_id    = coalesce(d.work_item_id, w.id)
from public.debrief_work_items dwi
join public.work_items w on w.id = dwi.work_item_id
where dwi.debrief_id = d.id
  and d.deleted_at is null
  and d.contact_id is null
  and d.organization_id is null
  and coalesce(w.organization_id, w.contact_id) is not null
  and (select count(*) from public.debrief_work_items d2 where d2.debrief_id = d.id) = 1;

-- ── TIER B: stage the legacy-code candidates for a human ─────────────────
-- 88.1% is far too low to auto-apply in a CPA firm — a wrong link attaches one
-- client's tax discussion to another. The measured precision travels with the
-- row so the reviewer knows what they are being handed.
insert into public.debrief_client_link_candidates
  (debrief_id, contact_id, organization_id, match_method, confidence, reason, evidence)
select d.id, c.id, null, 'legacy_client_code', 0.88,
  'debriefs.karbon_client_key holds a legacy Airtable code (' || d.karbon_client_key ||
  ') that uniquely matches contacts.user_defined_identifier. Measured precision on the '
  || '151-row linked holdout: 133 correct / 18 wrong (88.1%). The column is namespace-polluted '
  || '(318 of 590 populated values are Airtable codes, not Karbon keys) and is known to '
  || 'contradict the work-item FK on 18 already-linked debriefs, so this needs a human.',
  jsonb_build_object('legacy_code', d.karbon_client_key,
    'debrief_date', d.debrief_date,
    'notes_excerpt', left(regexp_replace(d.notes, '\s+', ' ', 'g'), 160),
    'holdout_precision', 0.881, 'holdout_n', 151)
from public.debriefs d
join public.contacts c on c.user_defined_identifier = d.karbon_client_key
where d.deleted_at is null and d.contact_id is null and d.organization_id is null
  and d.karbon_client_key ~ '^[A-Z]{2}_'
  and (select count(*) from public.contacts c2
       where c2.user_defined_identifier = d.karbon_client_key) = 1
  and not exists (select 1 from public.debrief_client_link_candidates x
                  where x.debrief_id = d.id and x.contact_id = c.id)

union all

select d.id, null, o.id, 'legacy_client_code', 0.88,
  'debriefs.karbon_client_key holds a legacy Airtable code (' || d.karbon_client_key ||
  ') that uniquely matches organizations.user_defined_identifier. Same caveats as the '
  || 'contact variant; ORGANIZATION WINS if both a contact and an org resolve.',
  jsonb_build_object('legacy_code', d.karbon_client_key,
    'debrief_date', d.debrief_date,
    'notes_excerpt', left(regexp_replace(d.notes, '\s+', ' ', 'g'), 160))
from public.debriefs d
join public.organizations o on o.user_defined_identifier = d.karbon_client_key
where d.deleted_at is null and d.contact_id is null and d.organization_id is null
  and d.karbon_client_key ~ '^[A-Z]{2}_'
  and (select count(*) from public.organizations o2
       where o2.user_defined_identifier = d.karbon_client_key) = 1
  and not exists (select 1 from public.debrief_client_link_candidates x
                  where x.debrief_id = d.id and x.organization_id = o.id);

commit;

-- Final accounting — the four buckets sum to 915, verified:
--   564  linked
--    25  unlinked, candidate staged for review (22 contact, 3 organization)
--     3  unlinked, carries a code that matches zero or several clients
--   323  unlinked, no structured signal of any kind
--
-- Separately noted: 12 exact-duplicate debrief rows exist (same notes + same
-- debrief_date). None has a linked twin, so they offer no linkage shortcut, but
-- they inflate every debrief count by 12 and should be deduped.
