-- ============================================================================
-- Form 1040 TY2025: EIC parameters (Rev. Proc. 2024-40 §2.06) — 2026-08-04
-- ============================================================================
-- Feeds the line-27 estimator stage. Arrays are indexed by number of
-- qualifying children [0, 1, 2, 3+]. Rates are statutory (§32(b)).

INSERT INTO form_1040_constants (tax_year, key, value, notes) VALUES
  (2025, 'eic_params', '{
    "rate": [0.0765, 0.34, 0.40, 0.45],
    "earnedAmount": [8490, 12730, 17880, 17880],
    "maxCredit": [649, 4328, 7152, 8046],
    "phaseoutRate": [0.0765, 0.1598, 0.2106, 0.2106],
    "phaseoutStart": [10620, 23350, 23350, 23350],
    "phaseoutStartMfj": [17730, 30470, 30470, 30470],
    "investmentIncomeLimit": 11950
  }', 'TY2025 EIC table (Rev Proc 2024-40): rate/earnedAmount/maxCredit/phaseout by qualifying-child count [0,1,2,3+]; investment income limit')
ON CONFLICT (tax_year, key) DO UPDATE SET value = EXCLUDED.value, notes = EXCLUDED.notes;
