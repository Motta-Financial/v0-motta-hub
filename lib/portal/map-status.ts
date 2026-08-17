/**
 * Maps raw Karbon internal work statuses to plain-English, client-facing
 * labels using the Motta green palette. Clients should never see raw
 * Karbon status codes.
 *
 * Shared by the portal work-items list, the task detail route, and the
 * documents routes so a status renders identically everywhere.
 */

export interface StatusDisplay {
  label: string
  variant: "default" | "secondary" | "destructive" | "outline"
  color: string
}

// Motta greens — mirrors STATUS_COLORS in the portal pages.
const MOTTA = {
  midGreen: "#8E9B79",
  deepGreen: "#6B745D",
  paleGreen: "#B5BFA8",
  darkGreen: "#4A5240",
} as const

export function mapStatus(karbonStatus: string | null): StatusDisplay {
  const s = (karbonStatus ?? "").toLowerCase()

  if (s.includes("complete") || s.includes("filed") || s.includes("finished")) {
    return { label: "Complete", variant: "default", color: MOTTA.darkGreen }
  }
  if (s.includes("review") || s.includes("partner")) {
    return { label: "Under Review", variant: "secondary", color: MOTTA.deepGreen }
  }
  if (
    s.includes("waiting") ||
    s.includes("info") ||
    s.includes("client") ||
    s.includes("block")
  ) {
    return { label: "Waiting on You", variant: "destructive", color: MOTTA.midGreen }
  }
  if (s.includes("progress") || s.includes("started") || s.includes("work")) {
    return { label: "In Progress", variant: "default", color: MOTTA.midGreen }
  }
  if (s.includes("not started") || s.includes("scheduled")) {
    return { label: "Scheduled", variant: "outline", color: MOTTA.paleGreen }
  }
  return { label: "In Progress", variant: "default", color: MOTTA.midGreen }
}
