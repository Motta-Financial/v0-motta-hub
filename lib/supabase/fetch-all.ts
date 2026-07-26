/**
 * Paged fetch for reads that must see EVERY matching row.
 *
 * PostgREST silently caps a single response at 1,000 rows (db.max-rows)
 * no matter what .limit() asks for — so any un-ranged select that is
 * aggregated/filtered in JS is silently wrong once the table crosses
 * 1,000 rows. This helper loops .range() windows until a short page is
 * returned. Promoted from app/api/tax/overview/route.ts, which pioneered
 * the pattern; other routes should import it from here.
 *
 * The query factory must return a FRESH builder on every call because
 * .range() mutates the builder it's called on.
 *
 * Reads through the caller's client, so RLS (or service-role bypass)
 * follows from whichever client the caller passes in the factory.
 */
const PAGE_SIZE = 1000

export async function fetchAllPaged<T>(
  // supabase-js's filter-builder generic chain is too complex to thread
  // cleanly here; the row type is asserted by the caller via <T>.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFactory: () => any,
  opts?: {
    /** Hard safety ceiling on total rows (default 100,000). */
    maxRows?: number
  },
): Promise<T[]> {
  const maxRows = opts?.maxRows ?? 100_000
  const out: T[] = []
  let from = 0
  for (;;) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await queryFactory().range(from, to)
    if (error) throw error
    const batch = (data || []) as T[]
    out.push(...batch)
    if (batch.length < PAGE_SIZE || out.length >= maxRows) break
    from += PAGE_SIZE
  }
  return out
}

/**
 * Chunk an array for .in() filters. PostgREST encodes .in() lists into
 * the request URL, which breaks (414 / silent errors) past a few
 * thousand characters — batch the keys and merge results instead.
 */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
