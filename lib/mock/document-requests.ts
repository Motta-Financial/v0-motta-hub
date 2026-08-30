/**
 * Shared mock data for the document request checklist feature.
 *
 * There is no backing schema for this yet (no `document_requests` table),
 * so both the staff-side panel (components/clients/document-request-
 * checklist-staff.tsx) and the client-side upload cards (components/
 * portal/document-request-checklist-client.tsx) import this same sample
 * set and manage it as local component state. Treat this as a UI
 * prototype, not a persisted feature — nothing here survives a refresh
 * across the two surfaces since they run in different sessions.
 */

export type DocRequestStatus = "not_requested" | "waiting" | "received" | "accepted"

export interface DocRequestUpload {
  fileName: string
  fileSizeBytes: number
  uploadedAt: string // ISO
  note: string | null
}

export interface DocRequest {
  id: string
  name: string
  instruction: string | null
  required: boolean
  status: DocRequestStatus
  sortOrder: number
  upload: DocRequestUpload | null
}

export const STATUS_LABEL: Record<DocRequestStatus, string> = {
  not_requested: "Not requested",
  waiting: "Waiting on client",
  received: "Received",
  accepted: "Accepted",
}

// Tailwind classes for the staff-side status chip — neutral Hub palette.
export const STATUS_CHIP_CLASS: Record<DocRequestStatus, string> = {
  not_requested: "bg-muted text-muted-foreground border-border",
  waiting: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-700/50",
  received: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-700/50",
  accepted: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-700/50",
}

export const INITIAL_DOCUMENT_REQUESTS: DocRequest[] = [
  {
    id: "dr-1",
    name: "2023 W-2 — Acme Corp",
    instruction: "The one from your primary employer, all pages.",
    required: true,
    status: "accepted",
    sortOrder: 0,
    upload: {
      fileName: "W2_Acme_2023.pdf",
      fileSizeBytes: 412_000,
      uploadedAt: "2026-08-18T15:22:00Z",
      note: "This is the corrected copy HR sent in February.",
    },
  },
  {
    id: "dr-2",
    name: "2023 W-2 — second employer",
    instruction: "You mentioned a short-term contract role earlier in the year — include that W-2 too.",
    required: true,
    status: "waiting",
    sortOrder: 1,
    upload: null,
  },
  {
    id: "dr-3",
    name: "1099-INT — Chase Bank savings",
    instruction: null,
    required: false,
    status: "received",
    sortOrder: 2,
    upload: {
      fileName: "1099-INT_Chase_2023.pdf",
      fileSizeBytes: 88_400,
      uploadedAt: "2026-08-24T13:05:00Z",
      note: null,
    },
  },
  {
    id: "dr-4",
    name: "1099-DIV — Fidelity brokerage account",
    instruction: "Should show up under Tax Documents in your Fidelity login if you haven't received it by mail.",
    required: true,
    status: "accepted",
    sortOrder: 3,
    upload: {
      fileName: "1099-DIV_Fidelity_2023.pdf",
      fileSizeBytes: 156_200,
      uploadedAt: "2026-08-20T18:47:00Z",
      note: null,
    },
  },
  {
    id: "dr-5",
    name: "Mortgage interest statement (Form 1098)",
    instruction: "From your lender for the home on Birchwood Ave.",
    required: true,
    status: "waiting",
    sortOrder: 4,
    upload: null,
  },
  {
    id: "dr-6",
    name: "Closing disclosure — home purchase",
    instruction: "The 5-page settlement statement you signed at closing in June.",
    required: true,
    status: "received",
    sortOrder: 5,
    upload: {
      fileName: "Closing_Disclosure_Birchwood.pdf",
      fileSizeBytes: 1_240_000,
      uploadedAt: "2026-08-22T10:12:00Z",
      note: "Let me know if you need the addendum too — I have it separately.",
    },
  },
  {
    id: "dr-7",
    name: "Property tax bill",
    instruction: null,
    required: false,
    status: "not_requested",
    sortOrder: 6,
    upload: null,
  },
  {
    id: "dr-8",
    name: "Charitable donation receipts",
    instruction: "Anything over $250 needs a written acknowledgment letter from the organization, not just a bank statement line.",
    required: false,
    status: "waiting",
    sortOrder: 7,
    upload: null,
  },
  {
    id: "dr-9",
    name: "Prior year tax return (2022)",
    instruction: "Full PDF as filed, so we can carry forward the depreciation schedules.",
    required: true,
    status: "accepted",
    sortOrder: 8,
    upload: {
      fileName: "2022_Federal_Return.pdf",
      fileSizeBytes: 2_050_000,
      uploadedAt: "2026-08-15T09:30:00Z",
      note: null,
    },
  },
]

export interface DocRequestTemplateItem {
  name: string
  instruction: string | null
  required: boolean
}

export interface DocRequestTemplate {
  id: string
  label: string
  description: string
  items: DocRequestTemplateItem[]
}

export const DOCUMENT_REQUEST_TEMPLATES: DocRequestTemplate[] = [
  {
    id: "individual-1040",
    label: "Individual 1040",
    description: "Standard personal return document set",
    items: [
      { name: "W-2 (each employer)", instruction: "One per employer for the tax year.", required: true },
      { name: "1099-INT / 1099-DIV", instruction: null, required: false },
      { name: "1099-NEC / 1099-MISC (self-employment)", instruction: null, required: false },
      { name: "Prior year tax return", instruction: "Full PDF as filed.", required: true },
      { name: "Form 1095-A/B/C (health coverage)", instruction: null, required: false },
    ],
  },
  {
    id: "home-purchase",
    label: "Home purchase",
    description: "For a client who bought a home this year",
    items: [
      { name: "Closing disclosure (Form HUD-1)", instruction: "The full settlement statement signed at closing.", required: true },
      { name: "Form 1098 Mortgage Interest Statement", instruction: null, required: true },
      { name: "Property tax bill", instruction: null, required: false },
      { name: "Home insurance declaration page", instruction: null, required: false },
    ],
  },
  {
    id: "new-business",
    label: "New business",
    description: "For a client setting up a new entity",
    items: [
      { name: "EIN confirmation letter (Form SS-4)", instruction: null, required: true },
      { name: "Articles of Organization / Incorporation", instruction: null, required: true },
      { name: "Operating agreement or bylaws", instruction: null, required: false },
      { name: "Business bank statements (12 months)", instruction: "Every account used for business activity.", required: true },
      { name: "Prior bookkeeping records or QuickBooks export", instruction: null, required: false },
    ],
  },
]

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}
