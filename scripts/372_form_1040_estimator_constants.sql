-- ============================================================================
-- Form 1040 TY2025 estimator constants (Rev. Proc. 2024-40)
-- ============================================================================
-- Feeds lib/forms/form-1040-estimates.ts — the deterministic tier that
-- estimates PTO-calculated lines (12a, 6b, 16, 19) from mapped inputs.
-- Estimates render with source='estimated' and are NEVER written back to
-- ProConnect.
--
-- tax_brackets_*: array of [rate, upper-bound] pairs, null bound = top.
-- qdcg_*: qualified dividends & LTCG 0%/15% bracket tops.
-- ss_*: Social Security taxability worksheet base/adjusted thresholds.

INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'tax_brackets_single', '[[0.10,11925],[0.12,48475],[0.22,103350],[0.24,197300],[0.32,250525],[0.35,626350],[0.37,null]]', 'TY2025 Single brackets (Rev Proc 2024-40)'),
  (2025, 'tax_brackets_mfj',    '[[0.10,23850],[0.12,96950],[0.22,206700],[0.24,394600],[0.32,501050],[0.35,751600],[0.37,null]]', 'TY2025 MFJ/QSS brackets'),
  (2025, 'tax_brackets_mfs',    '[[0.10,11925],[0.12,48475],[0.22,103350],[0.24,197300],[0.32,250525],[0.35,375800],[0.37,null]]', 'TY2025 MFS brackets'),
  (2025, 'tax_brackets_hoh',    '[[0.10,17000],[0.12,64850],[0.22,103350],[0.24,197300],[0.32,250525],[0.35,626350],[0.37,null]]', 'TY2025 HOH brackets'),
  (2025, 'qdcg_zero_top_single', '48350',  'TY2025 LTCG/QD 0% bracket top: Single'),
  (2025, 'qdcg_zero_top_mfj',    '96700',  'TY2025 LTCG/QD 0% top: MFJ/QSS'),
  (2025, 'qdcg_zero_top_mfs',    '48350',  'TY2025 LTCG/QD 0% top: MFS'),
  (2025, 'qdcg_zero_top_hoh',    '64750',  'TY2025 LTCG/QD 0% top: HOH'),
  (2025, 'qdcg_fifteen_top_single', '533400', 'TY2025 LTCG/QD 15% bracket top: Single'),
  (2025, 'qdcg_fifteen_top_mfj',    '600050', 'TY2025 LTCG/QD 15% top: MFJ/QSS'),
  (2025, 'qdcg_fifteen_top_mfs',    '300000', 'TY2025 LTCG/QD 15% top: MFS'),
  (2025, 'qdcg_fifteen_top_hoh',    '566700', 'TY2025 LTCG/QD 15% top: HOH'),
  (2025, 'ss_base_single', '25000', 'SS taxability base threshold: Single/HOH/QSS'),
  (2025, 'ss_adj_single',  '34000', 'SS taxability adjusted threshold: Single/HOH/QSS'),
  (2025, 'ss_base_mfj',    '32000', 'SS taxability base threshold: MFJ'),
  (2025, 'ss_adj_mfj',     '44000', 'SS taxability adjusted threshold: MFJ')
ON CONFLICT (tax_year, key) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes;
