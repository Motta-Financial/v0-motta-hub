-- ============================================================================
-- Form 1040 TY2025: NIIT + Additional Medicare Tax thresholds (2026-08-04)
-- ============================================================================
-- Feeds the line-23 estimator stage (lib/forms/form-1040-estimates.ts).
-- Statutory amounts (IRC §1411, §3101(b)(2)) — NOT inflation-indexed.
--
-- Filing-status nuance the estimator must honor:
--   * NIIT (Form 8960): MFJ and QSS share 250k; MFS 125k; Single/HOH 200k.
--   * Additional Medicare (Form 8959): only MFJ gets 250k; MFS 125k;
--     Single/HOH/QSS all 200k.

INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'niit_threshold_single', '200000', 'NIIT MAGI threshold: Single/HOH (§1411)'),
  (2025, 'niit_threshold_mfj',    '250000', 'NIIT MAGI threshold: MFJ/QSS'),
  (2025, 'niit_threshold_mfs',    '125000', 'NIIT MAGI threshold: MFS'),
  (2025, 'addl_medicare_threshold_single', '200000', 'Additional Medicare wage threshold: Single/HOH/QSS (§3101(b)(2))'),
  (2025, 'addl_medicare_threshold_mfj',    '250000', 'Additional Medicare wage threshold: MFJ'),
  (2025, 'addl_medicare_threshold_mfs',    '125000', 'Additional Medicare wage threshold: MFS')
ON CONFLICT (tax_year, key) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes;
