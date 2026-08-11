/**
 * Verification for lib/tax/intake/compute.ts — the Schedule 1-A block.
 *
 *   npx tsx scripts/verify-1040-intake-preview.ts
 *
 * Runs with no credentials. Constants mirror the TY2025 seeds (scripts/141 +
 * 352 + 372 + 386 + 389); if those change, this file must change with them.
 *
 * Focus: the OBBBA below-the-line deductions. Until 2026-08-11 this engine put
 * qualified tips and overtime on line 10 (Schedule 1 adjustments), which
 * understated AGI by their full amount — and AGI feeds Social Security
 * taxability, the CTC phaseout, NIIT, and the phase-outs of these very
 * deductions. They belong on line 13b, below the line.
 *
 * Figures trace to Schedule 1-A (Form 1040) 2025, Parts II-V.
 */

import {
  computeForm1040Preview,
  type ComputeInput,
  type Form1040Constants,
} from "../lib/tax/intake/compute"

let passed = 0
let failed = 0
function check(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++
  } else {
    failed++
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

const C: Form1040Constants = {
  stdDeductionSingle: 15750,
  stdDeductionMfj: 31500,
  stdDeductionMfs: 15750,
  stdDeductionHoh: 23625,
  additionalStd65BlindSingle: 2000,
  additionalStd65BlindMfj: 1600,
  bracketsVerified: true,
  brackets: {
    single: [
      { rate: 0.1, upTo: 11925 }, { rate: 0.12, upTo: 48475 }, { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 }, { rate: 0.32, upTo: 250525 }, { rate: 0.35, upTo: 626350 },
      { rate: 0.37, upTo: null },
    ],
    mfj: [
      { rate: 0.1, upTo: 23850 }, { rate: 0.12, upTo: 96950 }, { rate: 0.22, upTo: 206700 },
      { rate: 0.24, upTo: 394600 }, { rate: 0.32, upTo: 501050 }, { rate: 0.35, upTo: 751600 },
      { rate: 0.37, upTo: null },
    ],
    mfs: [
      { rate: 0.1, upTo: 11925 }, { rate: 0.12, upTo: 48475 }, { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 }, { rate: 0.32, upTo: 250525 }, { rate: 0.35, upTo: 375800 },
      { rate: 0.37, upTo: null },
    ],
    hoh: [
      { rate: 0.1, upTo: 17000 }, { rate: 0.12, upTo: 64850 }, { rate: 0.22, upTo: 103350 },
      { rate: 0.24, upTo: 197300 }, { rate: 0.32, upTo: 250525 }, { rate: 0.35, upTo: 626350 },
      { rate: 0.37, upTo: null },
    ],
  },
  itemizedVerified: false,
  medicalAgiFloorPct: 0.075,
  saltCap: 40000,
  saltCapMfs: 20000,
  saltPhaseoutStart: 500000,
  saltPhaseoutStartMfs: 250000,
  saltPhaseoutRate: 0.3,
  saltPhaseoutFloor: 10000,
  saltPhaseoutFloorMfs: 5000,
  charitableMileageRate: 0.14,
  // scripts/389
  tipsDeductionCap: 25000,
  overtimeDeductionCap: 12500,
  overtimeDeductionCapMfj: 25000,
  tipsOvertimePhaseoutStart: 150000,
  tipsOvertimePhaseoutStartMfj: 300000,
  tipsOvertimePhaseoutPer1000: 100,
  // scripts/386
  seniorDeductionMax: 6000,
  seniorDeductionPhaseoutStart: 75000,
  seniorDeductionPhaseoutStartMfj: 150000,
  seniorDeductionPhaseoutRate: 0.06,
}

const w2 = (box1Wages: number, tips = 0, overtime = 0) => ({
  box1Wages,
  box2FedWithheld: 0,
  obbbaQualifiedTips: tips || null,
  obbbaQualifiedOvertime: overtime || null,
})

const run = (i: Partial<ComputeInput> & { filingStatus: ComputeInput["filingStatus"] }) =>
  computeForm1040Preview({ w2s: [], ...i } as ComputeInput, C)

const line = (r: ReturnType<typeof run>, lc: string) =>
  r.lines.find((l) => l.lineCode === lc)?.value ?? null

// ===========================================================================
console.log("\nPlacement: tips/overtime are below the line")
{
  // 60,000 wages of which 10,000 is tips. AGI must be the full 60,000.
  const r = run({ filingStatus: "single", w2s: [w2(60000, 10000)] })
  check("REGRESSION line 10 no longer absorbs tips", line(r, "10"), 0)
  check("REGRESSION AGI is not reduced by tips", line(r, "11"), 60000)
  check("tips land on 13b", line(r, "13b"), 10000)
  // 60,000 − (15,750 + 10,000) = 34,250
  check("13b flows into total deductions (14)", line(r, "14"), 25750)
  check("13b reduces taxable income (15)", line(r, "15"), 34250)

  // The early-withdrawal penalty IS an above-the-line adjustment and stays.
  const r2 = run({
    filingStatus: "single",
    w2s: [w2(60000)],
    int1099s: [{
      interestBanks: 1000, interestUsBonds: null, interestMuniTotal: null, oid: null,
      fedWithheld: null, earlyWithdrawalPenalty: 300, accruedInterest: null, nomineeInterest: null,
    }],
  })
  check("early-withdrawal penalty stays on line 10", line(r2, "10"), 300)
  check("...and does reduce AGI", line(r2, "11"), 60700)
}

console.log("\nCaps and phase-outs (Schedule 1-A Parts II/III)")
{
  // Tips cap is 25,000 regardless of how much was reported.
  const r = run({ filingStatus: "single", w2s: [w2(120000, 40000)] })
  check("tips capped at 25,000", line(r, "13b"), 25000)

  // Overtime cap 12,500 single / 25,000 MFJ.
  check("overtime capped at 12,500 (single)", line(run({ filingStatus: "single", w2s: [w2(120000, 0, 30000)] }), "13b"), 12500)
  check("overtime capped at 25,000 (MFJ)", line(run({ filingStatus: "mfj", w2s: [w2(120000, 0, 30000)] }), "13b"), 25000)

  // Phase-out: AGI 160,000 is 10,000 over the 150,000 single threshold ->
  // 10 whole thousands x 100 = 1,000 off. Tips 5,000 -> 4,000.
  check("phase-out reduces by 100 per whole 1,000 over", line(run({ filingStatus: "single", w2s: [w2(160000, 5000)] }), "13b"), 4000)

  // The quotient rounds DOWN: 10,999 over is still 10 thousands, not 11.
  check("phase-out quotient rounds DOWN", line(run({ filingStatus: "single", w2s: [w2(160999, 5000)] }), "13b"), 4000)
  check("...and 161,000 crosses to 11", line(run({ filingStatus: "single", w2s: [w2(161000, 5000)] }), "13b"), 3900)

  // MFJ threshold is 300,000, so the same 160,000 AGI is not phased down.
  check("MFJ uses the 300,000 threshold", line(run({ filingStatus: "mfj", w2s: [w2(160000, 5000)] }), "13b"), 5000)

  // Never negative.
  check("phase-out floors at zero", line(run({ filingStatus: "single", w2s: [w2(400000, 5000)] }), "13b"), 0)

  // MFS is ineligible for every part of Schedule 1-A.
  check("MFS claims no Schedule 1-A deduction", line(run({ filingStatus: "mfs", w2s: [w2(60000, 10000)] }), "13b"), 0)
}

console.log("\nSenior deduction (Part V)")
{
  // Omitted, not guessed, when the intake has not recorded the count.
  const r = run({ filingStatus: "single", w2s: [w2(60000)] })
  check("no seniorCount -> no senior deduction", line(r, "13b"), 0)
  check("...and the omission is reported", r.outOfScope.some((s) => s.includes("enhanced deduction for seniors")), true)

  // One eligible person, AGI 60,000: full 6,000.
  check("one senior under the threshold", line(run({ filingStatus: "single", w2s: [w2(60000)], seniorCount: 1 }), "13b"), 6000)
  // AGI 100,000: 6,000 − 6% × 25,000 = 4,500.
  check("phases down at 6%", line(run({ filingStatus: "single", w2s: [w2(100000)], seniorCount: 1 }), "13b"), 4500)
  // MFJ, both eligible, AGI 160,000: 2 × (6,000 − 6% × 10,000) = 10,800.
  check("MFJ counts both spouses", line(run({ filingStatus: "mfj", w2s: [w2(160000)], seniorCount: 2 }), "13b"), 10800)
  // A non-joint return cannot claim two.
  check("non-joint is capped at one person", line(run({ filingStatus: "single", w2s: [w2(60000)], seniorCount: 2 }), "13b"), 6000)
  // MFS ineligible.
  check("MFS claims no senior deduction", line(run({ filingStatus: "mfs", w2s: [w2(60000)], seniorCount: 1 }), "13b"), 0)
  // Fully phased out at 175,000 single.
  check("fully phased out at 175,000", line(run({ filingStatus: "single", w2s: [w2(175000)], seniorCount: 1 }), "13b"), 0)
  // Tips and the senior deduction stack on the same line.
  // AGI 60,000: tips 10,000 (no phase-down) + 6,000 = 16,000.
  check("tips and senior stack on 13b", line(run({ filingStatus: "single", w2s: [w2(60000, 10000)], seniorCount: 1 }), "13b"), 16000)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
