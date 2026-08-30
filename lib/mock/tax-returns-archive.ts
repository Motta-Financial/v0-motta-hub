// Mock data for the client-portal "My tax returns" archive section.
// This is a permanent, browsable history of filed and in-progress
// returns — separate from the active "Tax" work-item list, which
// tracks the current season's in-flight project.

export type ReturnStatus = "draft" | "awaiting_approval" | "filed" | "accepted"

export interface TaxReturnDocument {
  id: string
  label: string
  fileType: string
  sizeLabel: string
}

export interface TaxReturnYear {
  id: string
  year: number
  formType: string
  status: ReturnStatus
  filedDate: string | null // ISO date, only set once filed
  preparerName: string
  documents: TaxReturnDocument[]
}

export const STATUS_LABEL: Record<ReturnStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting your approval",
  filed: "Filed",
  accepted: "Accepted",
}

// Deep green / sage / amber — matches the rest of the client portal.
export const STATUS_CHIP_STYLE: Record<ReturnStatus, { bg: string; color: string }> = {
  draft: { bg: "#E5E7EB", color: "#374151" },
  awaiting_approval: { bg: "#FEF3C7", color: "#92400E" },
  filed: { bg: "#8E9B791A", color: "#6B745D" },
  accepted: { bg: "#6B745D", color: "#FFFFFF" },
}

export const MOCK_TAX_RETURN_YEARS: TaxReturnYear[] = [
  {
    id: "tr-2024",
    year: 2024,
    formType: "Form 1040",
    status: "awaiting_approval",
    filedDate: null,
    preparerName: "Dana Whitfield, CPA",
    documents: [
      { id: "doc-2024-fed", label: "Federal return", fileType: "PDF", sizeLabel: "1.8 MB" },
      { id: "doc-2024-state", label: "State return — TX", fileType: "PDF", sizeLabel: "412 KB" },
      { id: "doc-2024-sched", label: "Supporting schedules", fileType: "PDF", sizeLabel: "926 KB" },
    ],
  },
  {
    id: "tr-2023",
    year: 2023,
    formType: "Form 1040",
    status: "accepted",
    filedDate: "2024-04-11",
    preparerName: "Dana Whitfield, CPA",
    documents: [
      { id: "doc-2023-fed", label: "Federal return", fileType: "PDF", sizeLabel: "1.7 MB" },
      { id: "doc-2023-state", label: "State return — TX", fileType: "PDF", sizeLabel: "398 KB" },
      { id: "doc-2023-sched", label: "Supporting schedules", fileType: "PDF", sizeLabel: "845 KB" },
    ],
  },
  {
    id: "tr-2022",
    year: 2022,
    formType: "Form 1040-X",
    status: "filed",
    filedDate: "2023-10-02",
    preparerName: "Marcus Iyer, EA",
    documents: [
      { id: "doc-2022-fed", label: "Amended federal return", fileType: "PDF", sizeLabel: "1.4 MB" },
      { id: "doc-2022-explanation", label: "Explanation of changes", fileType: "PDF", sizeLabel: "210 KB" },
    ],
  },
  {
    id: "tr-2021",
    year: 2021,
    formType: "Form 1040",
    status: "accepted",
    filedDate: "2022-04-08",
    preparerName: "Marcus Iyer, EA",
    documents: [
      { id: "doc-2021-fed", label: "Federal return", fileType: "PDF", sizeLabel: "1.6 MB" },
      { id: "doc-2021-state", label: "State return — TX", fileType: "PDF", sizeLabel: "365 KB" },
      { id: "doc-2021-sched", label: "Supporting schedules", fileType: "PDF", sizeLabel: "712 KB" },
    ],
  },
]
