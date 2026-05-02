/**
 * Client Type — translates Karbon's `entity_type` field (and the contact /
 * organization split) into a single human-readable label that conveys what
 * IRS form the client typically files. The platform consolidates Karbon's
 * Contact + Organization tables into one "Client" view, so we need this
 * mapping in multiple places (Clients list, Client profile header, debrief
 * tagging dialogs, reports).
 *
 * Inputs accepted:
 *  - kind: "contact" | "organization" — which Karbon table the row came from
 *  - entityType: the raw `entity_type` value as Karbon stores it (free text)
 *
 * Returns a `ClientType` object so callers can:
 *  - Display the human label  (e.g. "S Corporation")
 *  - Show the IRS form code   (e.g. "1120-S")
 *  - Filter by a stable code  (e.g. "s_corp", "individual", "partnership")
 *  - Render an icon hint      (business vs. individual)
 *
 * Keep this file dependency-free — both server (API routes, scripts) and
 * client components import from it.
 */

export type ClientTypeCode =
  | "individual"
  | "sole_prop"
  | "partnership"
  | "s_corp"
  | "c_corp"
  | "corp"
  | "llc"
  | "trust_estate"
  | "non_profit"
  | "other_business"
  | "unknown"

export interface ClientType {
  /** Stable lowercase code, suitable for filter / sort keys. */
  code: ClientTypeCode
  /** Short display label, e.g. "S Corporation". */
  label: string
  /** Full label with IRS form code, e.g. "S Corporation (1120-S)". */
  labelWithForm: string
  /** IRS form code if applicable, else null. */
  form: string | null
  /** "individual" | "business" — used to pick an icon / color. */
  family: "individual" | "business"
  /** Hex/Tailwind color hint (used for the badge). */
  variant: "blue" | "green" | "purple" | "amber" | "rose" | "slate"
}

const BUSINESS_MAP: Record<string, Omit<ClientType, "family">> = {
  // Karbon's most common entity_type strings, normalized to lowercase.
  "s corporation": {
    code: "s_corp",
    label: "S Corporation",
    labelWithForm: "S-Corp (1120-S)",
    form: "1120-S",
    variant: "purple",
  },
  "c corporation": {
    code: "c_corp",
    label: "C Corporation",
    labelWithForm: "C-Corp (1120)",
    form: "1120",
    variant: "purple",
  },
  corporation: {
    code: "corp",
    label: "Corporation",
    labelWithForm: "Corp (1120)",
    form: "1120",
    variant: "purple",
  },
  partnership: {
    code: "partnership",
    label: "Partnership",
    labelWithForm: "Partnership (1065)",
    form: "1065",
    variant: "amber",
  },
  "limited liability": {
    code: "llc",
    label: "LLC",
    labelWithForm: "LLC",
    form: null,
    variant: "green",
  },
  llc: {
    code: "llc",
    label: "LLC",
    labelWithForm: "LLC",
    form: null,
    variant: "green",
  },
  "sole proprietor": {
    code: "sole_prop",
    label: "Sole Proprietor",
    labelWithForm: "Sole Prop (Sch C)",
    form: "Schedule C",
    variant: "rose",
  },
  "estate or trust": {
    code: "trust_estate",
    label: "Trust / Estate",
    labelWithForm: "Trust/Estate (1041)",
    form: "1041",
    variant: "slate",
  },
  trust: {
    code: "trust_estate",
    label: "Trust",
    labelWithForm: "Trust (1041)",
    form: "1041",
    variant: "slate",
  },
  estate: {
    code: "trust_estate",
    label: "Estate",
    labelWithForm: "Estate (1041)",
    form: "1041",
    variant: "slate",
  },
  "exempt organization": {
    code: "non_profit",
    label: "Non-Profit",
    labelWithForm: "Non-Profit (990)",
    form: "990",
    variant: "blue",
  },
  // Karbon's literal default placeholder when an entity hasn't been classified.
  organization: {
    code: "other_business",
    label: "Business",
    labelWithForm: "Business",
    form: null,
    variant: "green",
  },
  "other/none": {
    code: "other_business",
    label: "Business (Other)",
    labelWithForm: "Business (Other)",
    form: null,
    variant: "green",
  },
}

const INDIVIDUAL_FALLBACK: Omit<ClientType, "family"> = {
  code: "individual",
  label: "Individual",
  labelWithForm: "Individual (1040)",
  form: "1040",
  variant: "blue",
}

const UNKNOWN_FALLBACK: Omit<ClientType, "family"> = {
  code: "unknown",
  label: "Unclassified",
  labelWithForm: "Unclassified",
  form: null,
  variant: "slate",
}

/**
 * Resolve a normalized ClientType from the raw Karbon fields.
 *
 *   getClientType("organization", "S Corporation")   // S-Corp (1120-S)
 *   getClientType("contact", "Individual")            // Individual (1040)
 *   getClientType("contact", null)                    // Individual (1040)
 *   getClientType("organization", null)               // Business
 */
export function getClientType(
  kind: "contact" | "organization",
  entityType: string | null | undefined,
): ClientType {
  const family: ClientType["family"] = kind === "organization" ? "business" : "individual"
  const key = (entityType || "").trim().toLowerCase()

  // Contacts almost always file 1040 unless they're flagged as a sole prop /
  // single-member LLC. We check for the business-y tags first.
  if (family === "individual") {
    if (key === "sole proprietor" || key === "sole prop") {
      return { family: "individual", ...BUSINESS_MAP["sole proprietor"] }
    }
    if (key === "trust" || key === "estate" || key === "estate or trust") {
      return { family: "individual", ...BUSINESS_MAP["estate or trust"] }
    }
    return { family, ...INDIVIDUAL_FALLBACK }
  }

  // Organizations: lookup by normalized entity_type, otherwise fall back to
  // the generic "Business" label.
  const hit = BUSINESS_MAP[key]
  if (hit) return { family, ...hit }
  if (!key) return { family, ...BUSINESS_MAP["organization"] }
  // Unknown business — surface the raw text so analysts can spot drift.
  return {
    family,
    code: "other_business",
    label: entityType || "Business",
    labelWithForm: entityType || "Business",
    form: null,
    variant: "green",
  }
}

/**
 * Tailwind classes for the badge that displays a client type. Keeps the
 * palette consistent across list rows, profile header, dropdown chips.
 */
export function clientTypeBadgeClass(variant: ClientType["variant"]): string {
  switch (variant) {
    case "blue":
      return "border-blue-200 text-blue-700 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/30 dark:text-blue-300"
    case "green":
      return "border-green-200 text-green-700 bg-green-50 dark:border-green-800/50 dark:bg-green-950/30 dark:text-green-300"
    case "purple":
      return "border-purple-200 text-purple-700 bg-purple-50 dark:border-purple-800/50 dark:bg-purple-950/30 dark:text-purple-300"
    case "amber":
      return "border-amber-200 text-amber-700 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300"
    case "rose":
      return "border-rose-200 text-rose-700 bg-rose-50 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300"
    case "slate":
    default:
      return "border-slate-200 text-slate-700 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
  }
}

/**
 * Stable list of all ClientType filter options for dropdowns / facet filters.
 * Order = the order they appear in the UI.
 */
export const CLIENT_TYPE_FILTER_OPTIONS: Array<{
  code: ClientTypeCode
  label: string
}> = [
  { code: "individual", label: "Individual (1040)" },
  { code: "sole_prop", label: "Sole Proprietor (Sch C)" },
  { code: "partnership", label: "Partnership (1065)" },
  { code: "s_corp", label: "S Corporation (1120-S)" },
  { code: "c_corp", label: "C Corporation (1120)" },
  { code: "corp", label: "Corporation (1120)" },
  { code: "llc", label: "LLC" },
  { code: "trust_estate", label: "Trust / Estate (1041)" },
  { code: "non_profit", label: "Non-Profit (990)" },
  { code: "other_business", label: "Business (Other)" },
  { code: "unknown", label: "Unclassified" },
]
