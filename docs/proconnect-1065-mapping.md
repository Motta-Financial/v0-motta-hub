# ProConnect 1065 (PAR) mapping — working notes

Status as of 2026-10-11. Intuit opened Import to every module back to TY2022; the firm is doing 1065s first. Nothing writes to a client 1065 until after 2026-10-15, and then only returns on `PROCONNECT_WRITE_ALLOWED_RETURN_IDS` with `PROCONNECT_ENABLED_RETURN_TYPES` including `PAR`.

Sources: all 85 of our TY2023–2025 1065s exported into the Hub (`scripts/428`), Intuit's 2025 series-code workbook, ProConnect's own TaxReport summaries, and a practice 1065 round trip (`scripts/429`).

## How to check a mapping without touching a return

The Export API returns only what was typed into a return, never the totals ProConnect calculates. But every new year's return carries the prior year's totals on **s6100 "Federal Prior Year Summary"**. So rules applied to year N's inputs must reproduce year N+1's s6100. `scripts/430-1065-selfcheck.ts` runs that check (read-only).

| s6100 code | Total |
|---|---|
| c1 | Gross receipts less returns and allowances |
| c8 | Total income (loss) |
| c16 | Depreciation |
| c21 | Total deductions |
| c22 | Ordinary business income (loss) |
| c23 | Net rental real estate income (loss) |
| c49 | Net earnings from self-employment |
| c67 | Distributions of cash and marketable securities |
| c70 / c72 | Beginning / ending total assets |
| c73 | Ending liabilities and capital |

## Field map

Prefix `p0` unless noted. On most screens `c1xx` is the federal amount and `c2xx` is a state-specific copy of the same line. `c1000+` codes are prior-year mirrors and must never be summed with the current year.

| Screen | Series | What we know | Checked |
|---|---|---|---|
| Client information | s1 | Name c1000100001, street c1000100003, city/state/zip c1000100004–06, phone c1000100007, EIN c1000100009, business code/activity/product c1000100012–14, email c1000100029 | Used on every TY2025 return |
| Partner information | s2 | One prefix per partner (`p1`, `p2`, …). Name c1000200002, street c1000200004, city/state/zip c1000200005–07, phone c1000200008, SSN/EIN c1000200009, resident state c1000200017, email c1000200022, entity type c1000200010, LLC classification c1000200012, GP/manager c1000200013 | Round trip 3/3 |
| Partner percentages | s700 | Per partner prefix: beginning profit/loss/capital % c501–c503, ending c504–c506 | Round trip 6/6 |
| Income | s200 | Gross receipts c101, returns and allowances c102, other income c105 (detail rows `x1`, `x2`, …) | 9/9 self-check; round trip 2/2 |
| Cost of goods sold | s300 | Not mapped yet (11/40 returns) | — |
| Deductions | s400 | c101–c152 federal lines; see rules below | 12/14 self-check; round trip 2/2 |
| Balance sheet (Schedule L) | s5700 | c101–c118 assets and c151–c157 liabilities/capital at beginning of year; c201–c218 and c251–c257 at end of year | Beginning 16/16; ending 7/25 (see below); round trip 2/2 |
| Capital accounts (M-2) | s1500 | Beginning capital c101, cash contributed c102, other increases c103 (detail rows), cash distributions c104 | Matched TaxReport; round trip 3/3 |
| Partner basis | s1800 | Not mapped yet (15/40 returns) | — |
| Depreciation | s61 | Not mapped yet; the heaviest screen (19/40 returns) | — |
| Rental real estate (8825) | s53 | Not mapped yet (15/40 returns; many of our partnerships are rental entities) | — |
| M-1 | s1400 | Used on 0 of 40 TY2025 returns | — |

**Deduction rules** (s6100/c21 total deductions): sum c101–c199, except:
- meals c123 counts at 50%, DOT meals c146 at 80%
- employment credits c152 are subtracted
- entertainment c169 and the 163(j) fields c179/c180 are excluded
- depreciation is added from the depreciation module unless c111 overrides it
- guaranteed payments (c115/c116, c181/c182) are included

The two self-check misses are a client with two TY2024 returns and an amended TY2023 return, not rule gaps as far as we can tell.

**Ending balance sheet:** the lines marked `*` (depreciable assets c210, accumulated depreciation c211, depletion c212–c213, land c214, intangibles c215–c216) are computed from the depreciation module. The ending total only reconciles once depreciation is mapped.

## Not importable or not supported

- **s5400** — used on 24/40 TY2025 returns, but Import rejects it with `CATALOG_SERIES_NOT_FOUND` (practice return, 2026-10-11).
- **Special allocations** — Intuit: not supported through the Import API.
- **Deleting or clearing a value** — still not possible. Intuit reports a clear as imported while leaving the value. A wrong write is only fixed by writing the right value or deleting the return.

## Partner data: where it comes from

Our 39 TY2025 1065s with partner data carry 108 partners, with percentages. The Hub's `tax_client_relationships` covers 7 of 38 partnership clients, none confirmed, none with an ownership %. So for existing partnerships ProConnect is the source of truth: partners roll forward when a return is created from the prior year's (Create Return with `source` = prior engagement id), and the Hub only needs to write changes. New partnerships have no partner data in the Hub today, so that has to come from intake.

## Still needed before building

- Intuit: the business modules in the IND V2 layout (agency, type, char limit, tsj, constraints) so the catalog can be loaded (`scripts/358 --diff` first), and catalogs for 2022–2024.
- Which partnerships keep books in a QuickBooks file the Hub can reach. That decides which ones page 1 and Schedule L can be filled for.
- Which partnerships use special allocations.
- A proforma (roll-forward) test for a 1065, to confirm partners and prior-year data carry over.
