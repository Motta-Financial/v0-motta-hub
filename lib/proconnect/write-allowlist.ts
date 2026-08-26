/**
 * Import write allowlist.
 *
 * Intuit's Import API has no delete/clear (see the import-handoff doc), so a
 * commit to the wrong return is not recoverable through the API. Commits are
 * therefore restricted to return ids explicitly listed in
 * PROCONNECT_WRITE_ALLOWED_RETURN_IDS (comma-separated, case-insensitive,
 * whitespace-trimmed). An unset env var means no return may be committed to
 * — fail closed, not open.
 *
 * Extracted so the enforcement point (the import route) and every UI surface
 * that wants to show the verdict ahead of time (the return-data route, the
 * field-edit sheet) call the exact same function. Two independent copies of
 * this predicate is how "advisory" UI hints quietly drift from the real
 * rule; there must be exactly one implementation.
 *
 * Dry runs are NOT covered by this check — they persist nothing, and the
 * import route deliberately exempts them (`if (!dryRun && !isWriteAllowed(...))`).
 * Callers that want a dry-run-aware verdict must apply that exemption
 * themselves; this function only answers "is this return id on the list".
 */
export function isWriteAllowed(returnId: string): boolean {
  const allowed = (process.env.PROCONNECT_WRITE_ALLOWED_RETURN_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return allowed.includes(returnId.trim().toLowerCase())
}
