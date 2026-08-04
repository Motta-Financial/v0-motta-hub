-- ============================================================================
-- Form 1040 TY2025: map 6c (SS lump-sum election) — 2026-08-04
-- ============================================================================
-- Discovered by checkbox flip on the sentinel copy: entering 1 in
-- "1=lump-sum election for social security benefits" created
-- s200M/p0/c12/x1000 = 1. The catalog (plain s200 — it has no M-series)
-- shows two identical descriptions: c12 (taxpayer) and c62 (spouse);
-- the flip proves the taxpayer column is c12. Boolean line: renderer
-- coerces val "1" to true.
--
-- dep_odc remains unmapped: changing the sentinel dependent's DOB to an
-- ODC-age did NOT move any of the four flag cells — they are preparer
-- inputs, not derived eligibility — and the "Type" code (c1000200006)
-- has no constraint enumeration in the catalog. Needs the Type dropdown
-- exercised in PTO before it can be decoded.

INSERT INTO form_1040_proconnect_map
  (tax_year, return_type, line_code, series_id, prefix_id, code_id, suffix_id, cell_field, confidence, notes)
VALUES
  (2025, 'IND', '6c', 's200M', 'p0', 'c12', 'x1000', 'val', 'confirmed',
   'SS lump-sum election checkbox, taxpayer column (c62 = spouse variant). Sentinel-confirmed 2026-08-04 by checkbox flip; catalog s200/c12 description matches verbatim.')
ON CONFLICT (tax_year, return_type, line_code) DO UPDATE SET
  series_id  = EXCLUDED.series_id,
  prefix_id  = EXCLUDED.prefix_id,
  code_id    = EXCLUDED.code_id,
  suffix_id  = EXCLUDED.suffix_id,
  cell_field = EXCLUDED.cell_field,
  confidence = EXCLUDED.confidence,
  notes      = EXCLUDED.notes;
