/**
 * Which IRS form a ProConnect return type files, and whether the Hub has a
 * formatted viewer for it. Every other return opens in the field viewer at
 * /tax/returns/[returnId], which works for any return type.
 */

/** ProConnect module code → the form it files. */
export const FORM_FOR_RETURN_TYPE: Record<string, string> = {
  IND: "1040",
  PAR: "1065",
  SCO: "1120-S",
  COR: "1120",
  FID: "1041",
  EXM: "990",
  GFT: "709",
}

/** Return types with a formatted viewer at /tax/returns/[returnId]/<path>. */
const FORMATTED_VIEWS: Record<string, { form: string; path: string }> = {
  IND: { form: "1040", path: "1040" },
  PAR: { form: "1065", path: "1065" },
}

export function formViewFor(returnType: string | null | undefined) {
  return returnType ? FORMATTED_VIEWS[returnType.toUpperCase()] ?? null : null
}

/**
 * Where a return's "View <form>" link should go: the formatted view when one
 * exists, otherwise the field viewer. `form` is null for an unknown type.
 */
export function returnViewLink(
  returnId: string,
  returnType: string | null | undefined,
  clientId?: string | null,
): { href: string; form: string | null; formatted: boolean } {
  const view = formViewFor(returnType)
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""
  const form = returnType ? FORM_FOR_RETURN_TYPE[returnType.toUpperCase()] ?? null : null
  return view
    ? { href: `/tax/returns/${returnId}/${view.path}${query}`, form: view.form, formatted: true }
    : { href: `/tax/returns/${returnId}${query}`, form, formatted: false }
}
