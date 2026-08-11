-- 379: the Form 1040 header block (taxpayer + spouse identity, address).
--
-- ─── WHY ─────────────────────────────────────────────────────────────
-- Reported as "spouse missing on joint returns". The real defect is
-- wider: form_1040_lines has NEVER carried a `header` section. All 72
-- TY2025 lines sat in filing_status / digital_assets / dependents /
-- income / tax_credits / payments / refund / amount_owed. There was no
-- primary name, no primary SSN, no address and no spouse anything.
--
-- What a reviewer saw as "the header showing only the primary taxpayer"
-- was proconnect_return_snapshots.client_name rendered in the viewer's
-- page chrome (components/tax/form-1040-viewer.tsx) — a single display
-- string from the ProConnect client record. It was never 1040 header
-- data, so a spouse could never have appeared there no matter what the
-- return contained.
--
-- ─── HOW PROCONNECT SPLITS TAXPAYER FROM SPOUSE ──────────────────────
-- NOT by occurrence/prefix, NOT by suffix, and NOT by the `tsj` flag.
-- The s1 "Client Information" screen carries taxpayer and spouse as
-- SEPARATE, ADJACENT code ids — the taxpayer on the lower code, the
-- spouse on the next one up:
--
--     taxpayer  spouse    field
--     --------  --------  -----------------------------
--     …0002     …0003     First Name & Initial
--     …0004     …0005     Last Name
--     …0006     …0007     SSN
--     …0010     …0012     Date of Birth
--     …0011     …0013     Blind?
--
-- Confirmed two independent ways on live exports (39 IND returns):
--   1. The catalog labels the SSN pair explicitly — c1000100006
--      "Taxpayer Information", c1000100007 "Spouse Information".
--   2. Presence test against filing status (s1/c1000100036): every
--      spouse-side code appears on 19-20 of 20 MFJ returns and on
--      0 of 18 single filers. A single filer has no spouse cell at all.
--
-- Every s1 header cell observed sits at prefix p0 / suffix x1000, and
-- `tsj` is only ever 'J' or absent — so tsj is NOT the discriminator
-- here despite being the T/S/J flag in the Phase 1 field model.
--
-- ─── LEAF FIELD: READ `desc`, NOT `val` ──────────────────────────────
-- Names, SSN and the address block arrive in the cell's `desc`
-- (description) with `val` empty; dates and coded flags arrive in
-- `val`. Note the catalog advertises allowedSubFields = ["val"] for the
-- STRING/SSN codes — that describes the IMPORT contract, not what
-- Export delivers. This read/write asymmetry is pre-existing: all five
-- STRING/SSN mappings already in the table (35b, 35d, dep_name,
-- dep_ssn, dep_rel) are cell_field='desc' and confidence='confirmed'.
-- These header mappings follow that established convention. Writing
-- these lines back through the Import API is NOT covered here.
--
-- ─── NO FILING-STATUS GATE ───────────────────────────────────────────
-- The spouse lines are deliberately mapped unconditionally rather than
-- gated behind fs_mfj. The viewer already hides null lines, so a single
-- filer's spouse lines stay hidden because the cells are absent — the
-- data decides. A conditional gate would put the spouse block back at
-- the mercy of a filing-status decode, which is the exact class of bug
-- being fixed. (It also keeps the rare-but-real case honest: the one
-- HOH return in the book carries spouse first name / SSN / DOB.)
-- ---------------------------------------------------------------------

begin;

-- ── Ordinals: open a band for the header ahead of filing status ───────
-- `ordinal` is display order within a section, but keeping the global
-- sequence in form order keeps the table readable. Relative order inside
-- each touched section is preserved.
update form_1040_lines set ordinal = ordinal + 20
 where tax_year = 2025 and section = 'filing_status';        -- 1..5  -> 21..25
update form_1040_lines set ordinal = 30
 where tax_year = 2025 and section = 'digital_assets';       -- 10    -> 30

-- ── Header lines (transcribed from Form 1040 (Rev. Jan 2026) page 1) ──
insert into form_1040_lines
  (tax_year, line_code, parent_code, ordinal, section, label, short_label, data_type, is_computed, notes)
values
  (2025, 'hdr_tp_first', null, 1,  'header', 'Your first name and middle initial',        'First Name',      'text', false, null),
  (2025, 'hdr_tp_last',  null, 2,  'header', 'Your last name',                            'Last Name',       'text', false, null),
  (2025, 'hdr_tp_ssn',   null, 3,  'header', 'Your social security number',               'SSN',             'ssn',  false, 'Masked on render; raw value only via the audited /reveal route.'),

  (2025, 'hdr_sp_first', null, 4,  'header', 'If joint return, spouse''s first name and middle initial', 'Spouse First', 'text', false, 'Populated only when the return carries a spouse (MFJ, and some MFS/HOH).'),
  (2025, 'hdr_sp_last',  null, 5,  'header', 'Spouse''s last name',                       'Spouse Last',     'text', false, null),
  (2025, 'hdr_sp_ssn',   null, 6,  'header', 'Spouse''s social security number',          'Spouse SSN',      'ssn',  false, 'Masked on render; raw value only via the audited /reveal route.'),

  (2025, 'hdr_address',  null, 7,  'header', 'Home address (number and street). If you have a P.O. box, see instructions.', 'Address', 'text', false, null),
  (2025, 'hdr_apt',      null, 8,  'header', 'Apt. no.',                                  'Apt',             'text', false, null),
  (2025, 'hdr_city',     null, 9,  'header', 'City, town, or post office',                'City',            'text', false, null),
  (2025, 'hdr_state',    null, 10, 'header', 'State',                                     'State',           'text', false, null),
  (2025, 'hdr_zip',      null, 11, 'header', 'ZIP code',                                  'ZIP',             'text', false, null),

  (2025, 'hdr_foreign_country',  null, 12, 'header', 'Foreign country name',              'Foreign Country', 'text', false, null),
  (2025, 'hdr_foreign_province', null, 13, 'header', 'Foreign province/state/county',     'Foreign Prov',    'text', false, 'Mapped from the catalog only — no return in the book populates it yet, so confidence stays "inferred".'),
  (2025, 'hdr_foreign_postal',   null, 14, 'header', 'Foreign postal code',               'Foreign Postal',  'text', false, 'Mapped from the catalog only — no return in the book populates it yet, so confidence stays "inferred".'),

  -- Age/Blindness block. The blind checkboxes map straight through; the
  -- two age checkboxes are a DATE COMPARISON (ProConnect exports a date
  -- of birth, the 1040 asks a yes/no), which belongs to the estimator,
  -- not to a cell mapping. Left unmapped on purpose, with the cell
  -- coordinates recorded so the estimator can pick them up.
  (2025, 'hdr_age_you',     null, 15, 'header', 'You: Were born before January 2, 1961',  'You 65+',         'boolean', false, 'NOT a ProConnect cell. Derive from date of birth s1/p0/c1000100010/x1000 (val) vs constant age_65_cutoff_birthdate. lib/forms/form-1040-estimates.ts already does this for the standard deduction; surfacing it as a line is estimator work, tracked separately.'),
  (2025, 'hdr_blind_you',   null, 16, 'header', 'You: Are blind',                         'You Blind',       'boolean', false, null),
  (2025, 'hdr_age_spouse',  null, 17, 'header', 'Spouse: Was born before January 2, 1961', 'Spouse 65+',     'boolean', false, 'NOT a ProConnect cell. Derive from spouse date of birth s1/p0/c1000100012/x1000 (val) vs constant age_65_cutoff_birthdate. The estimator currently notes spouse age as "invisible" — this is the cell it needs.'),
  (2025, 'hdr_blind_spouse',null, 18, 'header', 'Spouse: Is blind',                       'Spouse Blind',    'boolean', false, null)
on conflict (tax_year, line_code) do update set
  parent_code = excluded.parent_code,
  ordinal     = excluded.ordinal,
  section     = excluded.section,
  label       = excluded.label,
  short_label = excluded.short_label,
  data_type   = excluded.data_type,
  notes       = excluded.notes;

-- ── Mappings ──────────────────────────────────────────────────────────
-- All at s1 / p0 / x1000, the Client Information screen defaults.
insert into form_1040_proconnect_map
  (tax_year, line_code, return_type, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes)
values
  (2025, 'hdr_tp_first', 'IND', 's1', 'p0', 'c1000100002', 'x1000', 'desc', 'confirmed', 'Catalog "First Name & Initial". Taxpayer side: present on 18/18 single filers.'),
  (2025, 'hdr_tp_last',  'IND', 's1', 'p0', 'c1000100004', 'x1000', 'desc', 'confirmed', 'Catalog "Last Name". Taxpayer side: present on 18/18 single filers.'),
  (2025, 'hdr_tp_ssn',   'IND', 's1', 'p0', 'c1000100006', 'x1000', 'desc', 'confirmed', 'Catalog "Taxpayer Information", value_type SSN — the catalog names the taxpayer side explicitly.'),

  (2025, 'hdr_sp_first', 'IND', 's1', 'p0', 'c1000100003', 'x1000', 'desc', 'confirmed', 'Catalog "First Name & Initial", spouse side. Present on 19/20 MFJ and 0/18 single returns.'),
  (2025, 'hdr_sp_last',  'IND', 's1', 'p0', 'c1000100005', 'x1000', 'desc', 'confirmed', 'Catalog "Last Name", spouse side. Present on 20/20 MFJ and 0/18 single returns.'),
  (2025, 'hdr_sp_ssn',   'IND', 's1', 'p0', 'c1000100007', 'x1000', 'desc', 'confirmed', 'Catalog "Spouse Information", value_type SSN. Present on 19/20 MFJ and 0/18 single returns.'),

  (2025, 'hdr_address',  'IND', 's1', 'p0', 'c1000100014', 'x1000', 'desc', 'confirmed', 'Catalog "Street Address" (charLimit 40). Present on 38/39 IND returns.'),
  (2025, 'hdr_apt',      'IND', 's1', 'p0', 'c1000100021', 'x1000', 'desc', 'confirmed', 'Catalog "Apartment Number". Present on 8/39 IND returns.'),
  (2025, 'hdr_city',     'IND', 's1', 'p0', 'c1000100015', 'x1000', 'desc', 'confirmed', 'Catalog "City".'),
  (2025, 'hdr_state',    'IND', 's1', 'p0', 'c1000100016', 'x1000', 'desc', 'confirmed', 'Catalog "State".'),
  (2025, 'hdr_zip',      'IND', 's1', 'p0', 'c1000100017', 'x1000', 'desc', 'confirmed', 'Catalog "ZIP Code".'),

  (2025, 'hdr_foreign_country',  'IND', 's1', 'p0', 'c1000100062', 'x1000', 'desc', 'confirmed', 'Catalog "Country". Populated on 8/39 IND returns.'),
  (2025, 'hdr_foreign_province', 'IND', 's1', 'p0', 'c1000100060', 'x1000', 'desc', 'inferred',  'Catalog "Region". No return in the book populates it — mapping is from the Intuit catalog description only.'),
  (2025, 'hdr_foreign_postal',   'IND', 's1', 'p0', 'c1000100061', 'x1000', 'desc', 'inferred',  'Catalog "Postal Code". No return in the book populates it — mapping is from the Intuit catalog description only.'),

  (2025, 'hdr_blind_you',    'IND', 's1', 'p0', 'c1000100011', 'x1000', 'val', 'confirmed', 'Catalog "Blind?", taxpayer side (NUMBER). Present on 20/39 IND returns, all val 0.'),
  (2025, 'hdr_blind_spouse', 'IND', 's1', 'p0', 'c1000100013', 'x1000', 'val', 'confirmed', 'Catalog "Blind?", spouse side (NUMBER). Present on 20/39 IND returns, all val 0.')
on conflict (tax_year, line_code, return_type) do update set
  series_id  = excluded.series_id,
  prefix_id  = excluded.prefix_id,
  code_id    = excluded.code_id,
  suffix_id  = excluded.suffix_id,
  cell_field = excluded.cell_field,
  confidence = excluded.confidence,
  notes      = excluded.notes;

-- The two age checkboxes get an unmapped row so scripts/371's coverage
-- audit sees them as DOCUMENTED rather than UNACCOUNTED.
insert into form_1040_proconnect_map
  (tax_year, line_code, return_type, series_id, cell_field, confidence, notes)
values
  (2025, 'hdr_age_you',    'IND', null, 'val', 'unknown', 'Not a ProConnect cell: the 1040 asks a yes/no, ProConnect exports a date of birth (s1/p0/c1000100010/x1000). Derived-value work for the estimator, out of scope for the header mapping.'),
  (2025, 'hdr_age_spouse', 'IND', null, 'val', 'unknown', 'Not a ProConnect cell: derive from spouse date of birth s1/p0/c1000100012/x1000 vs constant age_65_cutoff_birthdate. Estimator work.')
on conflict (tax_year, line_code, return_type) do update set
  series_id  = excluded.series_id,
  confidence = excluded.confidence,
  notes      = excluded.notes;

commit;
