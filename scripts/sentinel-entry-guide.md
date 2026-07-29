# ProConnect Sentinel Entry — Instructions (TY2025 1040 field labeling)

**What this is for:** Intuit doesn't publish which internal field code maps to which
1040 line, so the Hub's 1040 viewer can't fill itself in yet. The sanctioned
workaround (per Steve at Intuit) is to type known "sentinel" dollar amounts into a
dummy return in ProConnect, re-export it through the API, and see which internal
field each amount landed in. Each value below is unique, so wherever it shows up
in the export tells us exactly which field feeds which 1040 line.

**Time needed:** ~20–30 minutes of normal PTO data entry.

## Safety rules (non-negotiable)

- Work ONLY in the dummy client **"Test Return, Financial Analysis"** — never a
  real client's return.
- Do NOT open Return actions → Customer Support Tools → Batch Edit Data to make
  edits. (Browsing it is fine; its Edit button is support-only.)
- Ignore every diagnostic/critical warning on this return — it will never be filed.

## Step 1 — Create the return, then STOP

Create a **2025 Individual (1040)** return on the client
"Test Return, Financial Analysis":

- Filing status **Single**, any obviously fake SSN, taxpayer info can stay as-is.
- **Do not attach any state.** (State modules copy federal amounts and pollute
  the diff.)

Then **tell Sam the return exists before entering any amounts** — we take a
"before" snapshot first. Sam will give the go-ahead.

## Step 2 — Enter these exact amounts

Whole dollars, exactly as written (each value is intentionally unique):

| Enter | Where (input screen) | Feeds 1040 line |
|---|---|---|
| 111001 | W-2, box 1 wages (employer name "SENTINEL EMPLOYER") | 1a |
| 111017 | same W-2, box 2 federal withholding | 25a |
| 111002 | Household employee wages (not on W-2) | 1b |
| 111003 | Unreported tips (Form 4137) | 1c |
| 111004 | Other earned income | 1h |
| 111005 | 1099-INT, tax-exempt interest (payer "SENTINEL BANK") | 2a |
| 111006 | same 1099-INT, taxable interest | 2b |
| 111018 | same 1099-INT, federal tax withheld | 25b |
| 111007 | 1099-DIV, qualified dividends | 3a |
| 111008 | same 1099-DIV, ordinary dividends | 3b |
| 111014 | Capital gain distributions (no Sch D detail needed) | 7 |
| 111010 | 1099-R **with** IRA/SEP/SIMPLE box checked, gross | 4a |
| 111009 | same 1099-R, taxable amount | 4b |
| 111012 | second 1099-R, **no** IRA box, gross | 5a |
| 111011 | same 1099-R, taxable amount | 5b |
| 111013 | SSA-1099, box 5 benefits | 6a |
| 111015 | Schedule 1 other income (8z), any description | 8 |
| 111016 | Schedule 1 other adjustments (24z) | 10 |
| 111019 | Other withholding, e.g. W-2G box 4 — skip if awkward | 25c |
| 111020 | 2025 estimated tax payments, Q1 | 26 |
| 111021 | Amount of overpayment applied to 2026 | 36 |

Notes:
- Amounts are deliberately implausible (taxable > what makes sense, withholding >
  wages). That's fine — diagnostics don't matter here.
- If a field won't accept a value, skip it and note which one.

## Step 3 — Tell Sam you're done

Say which rows (if any) you skipped. The export/diff runs on our side; nothing
else is needed from you. Don't change the return afterward until Sam confirms
the labeling round is finished.
