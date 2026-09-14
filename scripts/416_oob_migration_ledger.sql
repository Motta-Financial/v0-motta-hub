-- 416: a ledger for out-of-band migrations, so a file in a folder stops
--      meaning "apply me to production".
--
-- ═══ WHAT WENT WRONG ═════════════════════════════════════════════════
--
-- The out-of-band SQL for the 1040 mapping work lives outside this repo
-- (partner-confidential tuples; see scripts/360 and the directory's README).
-- Both runners that apply it — scripts/apply-1040-parity.mjs and
-- scripts/412-run-addend-role.mjs — glob the ENTIRE directory and apply
-- every *.sql in filename order, every run.
--
-- On 2026-09-14 that behaviour put an unreviewed migration into production.
-- 415 was written into the directory and deliberately NOT applied, pending
-- review. A parallel session running the Schedule C work invoked the runner
-- for its own migration; the runner picked up 415 along with everything else
-- and committed it at 03:16:04. Nobody decided to apply it. It was correct by
-- luck — it had been verified against the data and would have been applied
-- anyway — but the next one might not be.
--
-- Two separate defects, both fixed here:
--
--   1. PRESENCE MEANT CONSENT. Dropping a file in a shared directory was
--      indistinguishable from deploying it. There was no way to stage work.
--
--   2. EVERY RUN RE-APPLIED EVERYTHING. 407-410 were re-executed on every
--      invocation. They are idempotent, so it was survivable — but it means
--      a file edited AFTER being applied silently re-runs with new content,
--      and nothing records that prod ever diverged from what was reviewed.
--
-- ═══ THE FIX ═════════════════════════════════════════════════════════
--
-- A ledger. The runner applies only files NOT already recorded here, and
-- records each one with the SHA-256 of the exact bytes it executed.
--
-- That gives three things the folder alone could not:
--   * staging      a new file is PENDING until someone applies it on purpose
--   * idempotence  applied files are skipped, not re-run
--   * tamper check a file whose hash no longer matches what was applied is
--                  reported loudly, because prod and the file have diverged
--
-- The ledger records the FILENAME, not the content, so the confidential
-- tuples stay out of the database-of-record as much as out of the repo.
-- The hash is over the file bytes and reveals nothing.
--
-- ═══ SEEDING ═════════════════════════════════════════════════════════
--
-- 407-415 are already in production. They are seeded below with a NULL hash,
-- meaning "known applied, content not recorded at the time". The runner
-- treats a NULL hash as "applied, cannot verify" — it will not re-run the
-- file, and it will backfill the hash on first sight so future drift is
-- detectable. Claiming a hash we did not actually apply would be worse than
-- admitting we do not have one.
--
-- Idempotent.

begin;

create table if not exists form_1040_oob_migrations (
  filename    text primary key,
  sha256      text,
  applied_at  timestamptz not null default now(),
  applied_by  text,
  notes       text
);

comment on table form_1040_oob_migrations is
  'Ledger of out-of-band 1040 migrations applied to this database. The SQL '
  'files live outside the repo because they carry partner-confidential '
  'ProConnect tuples (scripts/360); this table is how we know which of them '
  'have run. Runners apply only files absent from this table. A row with a '
  'NULL sha256 was applied before the ledger existed: known applied, content '
  'unverifiable, hash backfilled on next sight.';

comment on column form_1040_oob_migrations.sha256 is
  'SHA-256 of the exact file bytes executed. A later mismatch means the file '
  'changed after it was applied, so production no longer matches what is on '
  'disk — the runner reports this rather than silently re-running.';

-- ── Seed what is already in production ──────────────────────────────────
-- Verified applied as of 2026-09-14: 407-410 by scripts/apply-1040-parity.mjs
-- on 09-09 (see the directory README), 413-415 by scripts/412-run-addend-role.mjs
-- on 09-13/14, 414 by the Schedule C workstream.
insert into form_1040_oob_migrations (filename, sha256, applied_by, notes) values
  ('407_form_1040_spouse_social_security.sql',            null, 'apply-1040-parity.mjs', 'Applied 2026-09-09 (PR #375). Seeded into the ledger retroactively.'),
  ('408_form_1040_1099r_withholding.sql',                 null, 'apply-1040-parity.mjs', 'Applied 2026-09-09 (PR #375). Seeded into the ledger retroactively.'),
  ('409_form_1040_schedule_d.sql',                        null, 'apply-1040-parity.mjs', 'Applied 2026-09-09 (PR #375). Seeded into the ledger retroactively.'),
  ('410_form_1040_schedule_a.sql',                        null, 'apply-1040-parity.mjs', 'Applied 2026-09-09 (PR #375). Seeded into the ledger retroactively.'),
  ('413_form_1040_line26_quarters_and_filing_status.sql', null, '412-run-addend-role.mjs', 'Applied 2026-09-13 (PR #378). Seeded into the ledger retroactively.'),
  ('414_form_1040_schedule_c.sql',                        null, '412-run-addend-role.mjs', 'Applied 2026-09-14 (PR #379). Seeded into the ledger retroactively.'),
  ('415_form_1040_ty2024_line26_quarters.sql',            null, 'UNINTENDED',             'Applied 2026-09-14 03:16:04 by a runner invoked for a different migration, before review. Outcome verified correct after the fact (scripts/413-verify-line26-quarters.ts passes for TY2024). This is the incident that motivated this ledger.')
on conflict (filename) do nothing;

-- In-repo migrations that the runners also execute.
insert into form_1040_oob_migrations (filename, sha256, applied_by, notes) values
  ('412_form_1040_addend_cell_role.sql', null, '412-run-addend-role.mjs', 'In-repo (no tuples). Applied 2026-09-13.')
on conflict (filename) do nothing;

select filename, sha256 is not null as hash_recorded, applied_at
  from form_1040_oob_migrations
 order by filename;

commit;
