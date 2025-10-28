export const SERVICE_LINES = {
  TAX: ["TAX", "TAXES", "1040", "1120", "1065"],
  ACCOUNTING: ["ACCT", "ACCOUNTING", "ACCTG"],
  BOOKKEEPING: ["BOOK", "BOOKKEEPING", "BK"],
  ADVISORY: ["ADVS", "ADVISORY", "ADV"],
  MOTTA: ["MOTTA", "INTERNAL"],
  "ALFRED AI": ["ALFRED", "AI", "AAI"],
  MWM: ["MWM", "WEALTH", "WEALTH MANAGEMENT", "WM"],
  SUFFOLK: ["SUFFOLK", "SUFF", "SEED"],
  PROSPECTS: ["PROSPECT", "PROSPECTS"],
} as const

export type ServiceLine = keyof typeof SERVICE_LINES | "OTHER"

export function categorizeServiceLine(title: string, clientName?: string): ServiceLine {
  if (title && title.toUpperCase().includes("PROSPECT")) {
    return "PROSPECTS"
  }

  // Check if client is Motta - all Motta client work is internal
  if (clientName && clientName.toUpperCase().includes("MOTTA")) {
    return "MOTTA"
  }

  if (!title) return "OTHER"

  // Extract the first word/prefix before any separator
  const firstPart =
    title
      .split(/[|\-:]/)[0]
      ?.trim()
      .toUpperCase() || ""

  // Check each service line's keywords
  for (const [serviceLine, keywords] of Object.entries(SERVICE_LINES)) {
    if (serviceLine === "PROSPECTS") continue

    if (keywords.some((keyword) => firstPart.includes(keyword))) {
      return serviceLine as ServiceLine
    }
  }

  return "OTHER"
}

export function getServiceLineColor(serviceLine: ServiceLine): string {
  switch (serviceLine) {
    case "TAX":
      return "bg-blue-100 text-blue-700 border-blue-300"
    case "ACCOUNTING":
      return "bg-green-100 text-green-700 border-green-300"
    case "BOOKKEEPING":
      return "bg-purple-100 text-purple-700 border-purple-300"
    case "ADVISORY":
      return "bg-orange-100 text-orange-700 border-orange-300"
    case "MOTTA":
      return "bg-gray-100 text-gray-700 border-gray-300"
    case "ALFRED AI":
      return "bg-indigo-100 text-indigo-700 border-indigo-300"
    case "MWM":
      return "bg-red-100 text-red-700 border-red-300"
    case "SUFFOLK":
      return "bg-teal-100 text-teal-700 border-teal-300"
    case "PROSPECTS":
      return "bg-yellow-100 text-yellow-700 border-yellow-300"
    default:
      return "bg-slate-100 text-slate-700 border-slate-300"
  }
}
