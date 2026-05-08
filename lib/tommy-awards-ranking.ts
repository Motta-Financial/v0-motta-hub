/**
 * Tommy Awards rank assignment helpers.
 *
 * The Tommy Awards program needs to handle ties at every podium position
 * (1st, 2nd, 3rd) consistently across three surfaces:
 *   - The weekly podium counters (`weeks_in_first` / `_second` / `_third`)
 *     in `/api/tommy-awards?type=ytd_stats`, which drive the YTD widget.
 *   - The season-long leaderboard rank in `/api/tommy-awards?type=leaderboard`
 *     and `?type=ytd_stats`, which display in the Weekly Leaderboard and
 *     YTD Standings cards.
 *   - The Friday recap email (`/api/cron/tommy-weekly-recap`), which
 *     announces the top 3 to the firm.
 *
 * We use **dense ranking** (1, 1, 2, 3) rather than Olympic / competition
 * ranking (1, 1, 3, 4). Dense ranking is the right model for an internal
 * recognition program because it keeps the podium spots "full" even when
 * there are ties at the top — if Alex and Sam tie for 1st in a given
 * week, the next-best teammate still earns a 2nd-place finish, and the
 * one after them earns a 3rd. Olympic ranking would silently delete
 * those podium spots, denying credit to people who legitimately finished
 * second- or third-best behind a tied pair.
 */

/**
 * Assigns a dense rank to each item in an already-sorted list. The
 * `isTie` predicate must be consistent with the sort order used to
 * produce `sorted` — typically it should compare exactly the fields the
 * sort comparator considers. Items that compare equal share a rank;
 * everyone else's rank is exactly one greater than the previous group's.
 *
 * Pure function — does not mutate `sorted`.
 */
export function assignDenseRanks<T extends object>(
  sorted: readonly T[],
  isTie: (a: T, b: T) => boolean,
): Array<T & { rank: number }> {
  const result: Array<T & { rank: number }> = []
  let rank = 0
  let previous: T | null = null
  for (const item of sorted) {
    if (previous === null || !isTie(previous, item)) {
      rank += 1
    }
    result.push({ ...item, rank })
    previous = item
  }
  return result
}

/**
 * Walks a list of `{ name, points }` entries (already sorted descending
 * by `points`) and increments the supplied per-member podium counters
 * for every member whose dense rank is 1, 2, or 3 in this snapshot.
 *
 * Used by the per-week loop in `?type=ytd_stats`. Pulled out so the rank
 * model is defined in one place rather than reinvented inline. The
 * `applyCredit(name, place)` callback exists because the caller's
 * counters live in a normalized `memberStats` map that the caller
 * populates with `ensureMember(...)`; keeping that detail outside this
 * helper avoids leaking the caller's data shape into a generic file.
 */
export function awardWeeklyPodiumCredit(
  sorted: ReadonlyArray<{ name: string; points: number }>,
  applyCredit: (name: string, place: 1 | 2 | 3) => void,
): void {
  let rank = 0
  let lastPoints: number | null = null
  for (const entry of sorted) {
    if (lastPoints === null || entry.points < lastPoints) {
      rank += 1
      lastPoints = entry.points
    }
    if (rank > 3) break
    applyCredit(entry.name, rank as 1 | 2 | 3)
  }
}
