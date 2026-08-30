/**
 * Shared mock data for the client portal "Meetings" feature.
 *
 * There is no backing schema for this yet (no `meetings` table), so both
 * the meetings list page (app/client-portal/(portal)/meetings/page.tsx) and
 * the dashboard "Latest meeting" summary card (components/portal/
 * latest-meeting-card.tsx) import this same sample set. Treat this as a UI
 * prototype, not a persisted feature.
 */

export interface MeetingTodo {
  id: string
  text: string
  completed: boolean
  dueDate: string | null // ISO date, no time
}

export interface Meeting {
  id: string
  title: string
  /** ISO datetime for the meeting start */
  startsAt: string
  durationMinutes: number
  firmAttendees: string[]
  recap: string
  clientTodos: MeetingTodo[]
  firmTodos: MeetingTodo[]
  recordingUrl: string | null
}

// Ordered newest first, matching how the list page renders them.
export const MOCK_MEETINGS: Meeting[] = [
  {
    id: "mtg-1",
    title: "Q3 Estimated Tax Planning Call",
    startsAt: "2026-08-23T14:00:00-04:00",
    durationMinutes: 30,
    firmAttendees: ["Alex Chen, CPA"],
    recap:
      "We reviewed your Q3 numbers and confirmed the estimated tax payment due September 15. Business income is tracking about 12% ahead of last year, so we adjusted your Q4 estimate accordingly.",
    clientTodos: [
      {
        id: "mtg-1-ct-1",
        text: "Send Q3 bank statements for the LLC",
        completed: false,
        dueDate: "2026-08-28",
      },
      {
        id: "mtg-1-ct-2",
        text: "Confirm home office square footage for 2026",
        completed: false,
        dueDate: "2026-09-05",
      },
      {
        id: "mtg-1-ct-3",
        text: "Review and sign the updated estimate schedule",
        completed: false,
        dueDate: null,
      },
    ],
    firmTodos: [
      {
        id: "mtg-1-ft-1",
        text: "Recalculate Q4 estimate once Q3 statements are in",
        completed: false,
        dueDate: "2026-09-10",
      },
      {
        id: "mtg-1-ft-2",
        text: "File the September 15 estimated payment on your behalf",
        completed: false,
        dueDate: "2026-09-15",
      },
      {
        id: "mtg-1-ft-3",
        text: "Update your safe-harbor tracking sheet",
        completed: true,
        dueDate: null,
      },
    ],
    recordingUrl: "#",
  },
  {
    id: "mtg-2",
    title: "2025 Return Kickoff",
    startsAt: "2026-08-05T10:30:00-04:00",
    durationMinutes: 45,
    firmAttendees: ["Alex Chen, CPA", "Priya Raman, EA"],
    recap:
      "Kicked off your 2025 individual return. Walked through what changed from last year — the new rental property and the HSA contributions — and agreed on a document list to get everything filed well ahead of the deadline.",
    clientTodos: [
      {
        id: "mtg-2-ct-1",
        text: "Upload closing statement for the rental property",
        completed: true,
        dueDate: "2026-08-12",
      },
      {
        id: "mtg-2-ct-2",
        text: "Send 1099-DIV and 1099-INT forms",
        completed: true,
        dueDate: "2026-08-12",
      },
      {
        id: "mtg-2-ct-3",
        text: "Provide HSA year-end contribution total",
        completed: false,
        dueDate: "2026-08-20",
      },
    ],
    firmTodos: [
      {
        id: "mtg-2-ft-1",
        text: "Set up the rental property schedule in the return",
        completed: true,
        dueDate: null,
      },
      {
        id: "mtg-2-ft-2",
        text: "Draft depreciation schedule for the new property",
        completed: false,
        dueDate: "2026-09-01",
      },
    ],
    recordingUrl: "#",
  },
  {
    id: "mtg-3",
    title: "Mid-Year Check-in",
    startsAt: "2026-07-18T11:00:00-04:00",
    durationMinutes: 25,
    firmAttendees: ["Alex Chen, CPA"],
    recap:
      "General check-in on cash flow and withholding. Payroll withholding looks slightly light for the year, so we talked through a small W-4 adjustment to avoid an underpayment penalty in April.",
    clientTodos: [
      {
        id: "mtg-3-ct-1",
        text: "Submit updated W-4 to payroll",
        completed: true,
        dueDate: "2026-07-25",
      },
      {
        id: "mtg-3-ct-2",
        text: "Share latest paystub once the change takes effect",
        completed: true,
        dueDate: "2026-08-01",
      },
    ],
    firmTodos: [
      {
        id: "mtg-3-ft-1",
        text: "Re-run the withholding projection with the updated W-4",
        completed: true,
        dueDate: null,
      },
    ],
    recordingUrl: null,
  },
]

export function isOverdue(dueDate: string | null, completed: boolean): boolean {
  if (!dueDate || completed) return false
  const due = new Date(dueDate + "T23:59:59")
  return due.getTime() < Date.now()
}
