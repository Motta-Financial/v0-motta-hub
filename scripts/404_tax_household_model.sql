-- 404_tax_household_model.sql
--
-- Give the Hub a concept of family. Closes the two gaps
-- lib/tax/intake/profile.ts names explicitly (keys "spouse" and
-- "dependents"): the Hub stores people and businesses, but nothing that
-- says "married to" or "child of".
--
-- ─── WHY THIS BLOCKS REAL WORK ───────────────────────────────────────
-- Without it, a joint return cannot be assembled from the client record —
-- the spouse's name, SSN and date of birth have to be re-keyed every year
-- from whatever the preparer can find. And the OBBBA $2,200 child tax
-- credit and $500 other-dependent credit cannot be computed at all,
-- because nothing links a child to the taxpayer claiming them.
--
-- We can already READ dependents back out of ProConnect (scripts/389
-- renders every instance on the repeating Dependents screen). What is
-- missing is the durable Hub-side record, so that next year's return
-- inherits this year's answer instead of starting blank.
--
-- ─── WHY PERSON↔PERSON AND NOT A "HOUSEHOLDS" TABLE ──────────────────
-- A household is not a durable entity. "Who files together in 2025" is an
-- artifact of that year's filing status and changes with marriage,
-- divorce, death, and children ageing out. A marriage IS durable. So the
-- durable fact gets a row here, and the per-year question is answered by
-- tax_input_sets.filing_status, which already exists per return.
--
-- Modelling households directly would force a new household row every
-- time any of those events happened, and make "what did this family look
-- like in 2023" unanswerable.
--
-- ─── WHY EFFECTIVE-DATED ─────────────────────────────────────────────
-- A return is a snapshot of a year. Divorce, death and a child ageing out
-- must not silently rewrite history: TY2023 has to stay reconstructable
-- after a 2024 divorce. effective_to is null while the relationship
-- holds; setting it ends the relationship without deleting the fact.
--
-- ─── MIRRORS tax_client_relationships (scripts/170) ──────────────────
-- Same status / confidence / link_source / reviewed_by shape, so the same
-- review UI pattern applies and an auto-suggester can PROPOSE a link from
-- intake forms or Karbon without asserting it. A wrong spouse link is a
-- wrong tax return, so nothing here is trusted until a human confirms it.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------

-- ──────────────────────────────────────────────────────────────────────
-- 1. The durable link between two people.
-- ──────────────────────────────────────────────────────────────────────
create table if not exists tax_person_relationships (
  id uuid primary key default gen_random_uuid(),

  -- Canonical direction. For asymmetric types the subject is the
  -- TAXPAYER side: 'child' means related_contact_id is the child OF
  -- person_contact_id. Symmetric types ('spouse', 'former_spouse') are
  -- stored ONCE; read them through tax_person_relationships_both, which
  -- exposes both directions.
  person_contact_id   uuid not null references contacts(id) on delete cascade,
  related_contact_id  uuid not null references contacts(id) on delete cascade,

  relationship_type   text not null,

  -- Null effective_from means "as long as we've known". Null effective_to
  -- means current. A divorce sets effective_to; it never deletes the row.
  effective_from      date,
  effective_to        date,

  -- Review workflow, identical in spirit to tax_client_relationships.
  status              text not null default 'needs_review',
  confidence          numeric(4,3) not null default 1.000,
  link_source         text not null default 'manual',
  reviewed_by         uuid references team_members(id),
  reviewed_at         timestamptz,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint tax_person_rel_no_self
    check (person_contact_id <> related_contact_id),
  constraint tax_person_rel_type_chk
    check (relationship_type in (
      'spouse', 'former_spouse',
      'child', 'stepchild', 'foster_child', 'adopted_child',
      'grandchild', 'parent', 'grandparent', 'sibling',
      'other_dependent'
    )),
  constraint tax_person_rel_status_chk
    check (status in ('confirmed', 'needs_review', 'rejected')),
  constraint tax_person_rel_source_chk
    check (link_source in ('auto', 'manual', 'alfred', 'intake', 'karbon')),
  constraint tax_person_rel_dates_chk
    check (effective_to is null or effective_from is null
           or effective_to >= effective_from),
  -- One live row per (pair, type). A remarriage to the same person is a
  -- new row only because the previous one carries an effective_to.
  constraint tax_person_rel_unique
    unique (person_contact_id, related_contact_id, relationship_type, effective_from)
);

create index if not exists tax_person_rel_person_idx
  on tax_person_relationships (person_contact_id);
create index if not exists tax_person_rel_related_idx
  on tax_person_relationships (related_contact_id);
create index if not exists tax_person_rel_status_idx
  on tax_person_relationships (status);
-- Partial index for the common question: who is currently linked to X.
create index if not exists tax_person_rel_current_idx
  on tax_person_relationships (person_contact_id, relationship_type)
  where effective_to is null and status = 'confirmed';

-- ──────────────────────────────────────────────────────────────────────
-- 2. The facts about a dependent that change every year.
--
-- Relationship is durable and lives above. These do NOT: a child lives
-- with one parent for 7 months and the other for 5, is a full-time
-- student for three years, ages out of the CTC at 17. Storing them on the
-- relationship would mean last year's return silently changes when this
-- year's answer is entered.
--
-- Age is deliberately absent — it is derived from contacts.date_of_birth
-- against the tax year, so it cannot drift out of sync with the birthday.
-- ──────────────────────────────────────────────────────────────────────
create table if not exists tax_dependent_years (
  id uuid primary key default gen_random_uuid(),

  dependent_contact_id uuid not null references contacts(id) on delete cascade,
  -- Who claims them this year. Divorced parents alternate; that is a
  -- different claimant per year, not a different relationship.
  claimed_by_contact_id uuid not null references contacts(id) on delete cascade,
  tax_year             integer not null,

  -- Residency test. Null = not yet established; 0 is a real answer.
  months_lived_with_claimant smallint,
  is_full_time_student       boolean,
  is_permanently_disabled    boolean,
  -- Set when the taxpayer is NOT claiming a dependent they could, e.g.
  -- a Form 8332 release to the other parent. Prevents the Hub from
  -- "helpfully" restoring a credit that was given away on purpose.
  released_to_other_parent   boolean not null default false,

  -- Resolved credit. Left null until the tests are answered; the
  -- calculator fails closed on null rather than assuming 'none'.
  -- 'ctc'  = OBBBA $2,200 child tax credit
  -- 'odc'  = $500 other-dependent credit
  -- 'none' = claimed as a dependent but qualifies for neither
  credit_type          text,

  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint tax_dependent_years_no_self
    check (dependent_contact_id <> claimed_by_contact_id),
  constraint tax_dependent_years_months_chk
    check (months_lived_with_claimant is null
           or months_lived_with_claimant between 0 and 12),
  constraint tax_dependent_years_credit_chk
    check (credit_type is null or credit_type in ('ctc', 'odc', 'none')),
  constraint tax_dependent_years_year_chk
    check (tax_year between 2018 and 2100),
  -- A dependent is claimed by at most one taxpayer per year. This is the
  -- constraint that makes double-claiming a database error rather than an
  -- IRS letter.
  constraint tax_dependent_years_unique
    unique (dependent_contact_id, tax_year)
);

create index if not exists tax_dependent_years_claimant_idx
  on tax_dependent_years (claimed_by_contact_id, tax_year);

-- ──────────────────────────────────────────────────────────────────────
-- 3. Both directions of a symmetric link, for reads.
--
-- 'spouse' is stored once. Every consumer wants "who is A married to"
-- regardless of which side A was entered on, so expose the mirror here
-- instead of making each caller remember to check both columns.
-- ──────────────────────────────────────────────────────────────────────
create or replace view tax_person_relationships_both as
  select
    r.id,
    r.person_contact_id      as subject_contact_id,
    r.related_contact_id     as object_contact_id,
    r.relationship_type,
    false                    as is_mirrored,
    r.effective_from, r.effective_to, r.status, r.confidence,
    r.link_source, r.notes
  from tax_person_relationships r
  union all
  select
    r.id,
    r.related_contact_id     as subject_contact_id,
    r.person_contact_id      as object_contact_id,
    r.relationship_type,
    true                     as is_mirrored,
    r.effective_from, r.effective_to, r.status, r.confidence,
    r.link_source, r.notes
  from tax_person_relationships r
  where r.relationship_type in ('spouse', 'former_spouse');

-- ──────────────────────────────────────────────────────────────────────
-- 4. RLS. These rows say who is married to whom and who claims which
--    child — squarely personal data, staff-only, matching the lock
--    applied in scripts/399.
-- ──────────────────────────────────────────────────────────────────────
alter table tax_person_relationships enable row level security;
alter table tax_dependent_years      enable row level security;

drop policy if exists "tax_person_rel_staff_only" on public.tax_person_relationships;
create policy "tax_person_rel_staff_only"
  on public.tax_person_relationships
  for all
  using (is_staff())
  with check (is_staff());

drop policy if exists "tax_dependent_years_staff_only" on public.tax_dependent_years;
create policy "tax_dependent_years_staff_only"
  on public.tax_dependent_years
  for all
  using (is_staff())
  with check (is_staff());

-- ─── VERIFY ──────────────────────────────────────────────────────────
-- select count(*) from tax_person_relationships;   -- 0 on a fresh run
-- select count(*) from tax_dependent_years;        -- 0 on a fresh run
-- select * from tax_person_relationships_both limit 1;
