-- ============================================================================
-- Form 1040 TY2025 ProConnect mappings — sentinel round 3 (2026-07-30)
-- ============================================================================
-- Same scratch copy return as scripts/368/369. This round targeted the
-- non-dollar lines: header booleans, dependents, refund bank fields, 1d.
-- Mostly hand-labeled from the diff (desc-type cells don't value-match).
--
-- Discovered but deliberately NOT mapped:
--   * FILING STATUS is one coded cell: s1/p0/c1000100036/x1000 (observed
--     2=MFJ, 4=HOH; presumed 1=Single, 3=MFS, 5=QSS). The five fs_*
--     boolean lines need a per-value conditional (equals-N) mechanism —
--     same family as the 1099-R IRA-checkbox routing. Mapping the raw
--     cell would render wrong booleans.
--   * dep_ctc / dep_odc: four indistinguishable flag cells per dependent
--     instance (c1000200006/07/13/14, all =1 on CTC-qualifying kids).
--     Needs an ODC-only test dependent (age 17+) to discriminate.
--   * Dependents structure (per instance p1/p2/p3): c1000200002 DOB (val),
--     c...03 SSN (desc), c...04 relationship (desc), c...05 months in
--     home (desc), c...08 first name (desc), c...09 last name (desc).
--     Mapped lines read the FIRST dependent only; multi-dependent
--     rendering needs instance-table support.

INSERT INTO form_1040_proconnect_map
  (tax_year, return_type, line_code, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes)
VALUES
  (2025, 'IND', '1d',             's200M', 'p0', 'c39',         'x1000', 'val',  'confirmed', 'Medicaid waiver payments not on W-2 (flows to 1d per PTO screen note).'),
  (2025, 'IND', 'digital_assets', 's5100', 'p0', 'c1768',       'x1000', 'val',  'confirmed', 'Digital assets question override: 1=yes, 2=no. Boolean-true only when 1.'),
  (2025, 'IND', '35b',            's5100', 'p0', 'c20',         'x1000', 'desc', 'confirmed', 'Refund direct-deposit routing number (desc).'),
  (2025, 'IND', '35d',            's5100', 'p0', 'c21',         'x1000', 'desc', 'confirmed', 'Refund direct-deposit account number (desc).'),
  (2025, 'IND', '35c',            's5100', 'p0', 'c22',         'x1000', 'val',  'inferred',  'Account type code; 2=checking observed, 1 presumed savings — decode unverified. Viewer needs enum translation.'),
  (2025, 'IND', 'dep_name',       's2',    'p1', 'c1000200008', 'x1000', 'desc', 'confirmed', 'First dependent FIRST name only; last name = c1000200009.'),
  (2025, 'IND', 'dep_ssn',        's2',    'p1', 'c1000200003', 'x1000', 'desc', 'confirmed', 'First dependent SSN. SENSITIVE — mask in UI.'),
  (2025, 'IND', 'dep_rel',        's2',    'p1', 'c1000200004', 'x1000', 'desc', 'confirmed', 'First dependent relationship.')
ON CONFLICT (tax_year, return_type, line_code) DO UPDATE SET
  series_id  = EXCLUDED.series_id,
  prefix_id  = EXCLUDED.prefix_id,
  code_id    = EXCLUDED.code_id,
  suffix_id  = EXCLUDED.suffix_id,
  cell_field = EXCLUDED.cell_field,
  confidence = EXCLUDED.confidence,
  notes      = EXCLUDED.notes;

UPDATE form_1040_proconnect_map
   SET notes = 'Cell DISCOVERED 2026-07-30 but NOT mapped: filing status is ONE coded cell s1/p0/c1000100036/x1000 (observed 2=MFJ, 4=HOH). Boolean rendering needs a per-value conditional mechanism. Do not map to the raw cell.'
 WHERE tax_year = 2025 AND return_type = 'IND'
   AND line_code IN ('fs_single', 'fs_mfj', 'fs_mfs', 'fs_hoh', 'fs_qss');
