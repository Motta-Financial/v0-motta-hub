/**
 * Mock data for the Triage feed's "Emails" tab (components/triage-feed.tsx).
 *
 * There is no mailbox sync yet (no `client_emails` table or inbox
 * integration), so this is sample content only — realistic client email
 * threads used to prototype the layout, thread collapsing, project
 * assignment, and reply UI. The feed wraps this in the shared
 * `PreviewFeature` banner so nobody mistakes it for a real client's inbox.
 *
 * `createMockClientEmailThreads()` returns a fresh array/object graph on
 * every call so each mounted TriageFeed instance can safely mutate its own
 * copy (marking read, assigning a project, appending a reply) without
 * affecting other instances or a shared module-level singleton.
 */

export interface ClientEmailMessage {
  id: string
  direction: "inbound" | "outbound"
  senderName: string
  senderEmail: string
  bodyText: string
  sentAt: string // ISO
}

export interface ClientEmailProjectOption {
  id: string
  name: string
}

export interface ClientEmailThread {
  id: string
  /** Fake id — links to /clients/[id]. Not a real Hub client record. */
  clientId: string
  clientName: string
  subject: string
  /** Oldest first. */
  messages: ClientEmailMessage[]
  activeProjects: ClientEmailProjectOption[]
  assignedProjectId: string | null
  read: boolean
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24)
}

export function createMockClientEmailThreads(): ClientEmailThread[] {
  return [
    {
      id: "client-email-sarah-whitman-1099",
      clientId: "mock-client-sarah-whitman",
      clientName: "Sarah Whitman",
      subject: "Missing 1099-DIV form for 2025 return",
      activeProjects: [
        { id: "proj-swhitman-2025-1040", name: "2025 Individual Tax Return" },
        { id: "proj-swhitman-q3-bk", name: "Q3 Bookkeeping" },
      ],
      assignedProjectId: null,
      read: false,
      messages: [
        {
          id: "msg-swhitman-1",
          direction: "inbound",
          senderName: "Sarah Whitman",
          senderEmail: "sarah.whitman@gmail.com",
          bodyText:
            "Hi team, I just got a corrected 1099-DIV from my brokerage and wanted to make sure you have the latest version before you file. Let me know if you need me to forward the PDF or if it's already showing up in the portal.",
          sentAt: hoursAgo(2),
        },
      ],
    },
    {
      id: "client-email-webb-logistics-salary",
      clientId: "mock-client-webb-logistics",
      clientName: "Webb Logistics LLC",
      subject: "Question about the S-corp reasonable salary calc",
      activeProjects: [
        { id: "proj-webb-payroll", name: "Payroll Setup" },
        { id: "proj-webb-2025-1120s", name: "2025 S-Corp Return" },
      ],
      assignedProjectId: null,
      read: false,
      messages: [
        {
          id: "msg-webb-1",
          direction: "inbound",
          senderName: "Marcus Webb",
          senderEmail: "marcus@webblogisticsllc.com",
          bodyText:
            "Quick question — how did you land on $86k for my reasonable salary this year? Payroll is asking me to confirm before the next run.",
          sentAt: daysAgo(2),
        },
        {
          id: "msg-webb-2",
          direction: "outbound",
          senderName: "Priya Raman, EA",
          senderEmail: "priya@mottafinancial.com",
          bodyText:
            "Good question — we benchmarked against BLS wage data for your role and region, then compared it against similar S-corp clients in our book. $86k keeps you well inside a defensible range while leaving healthy distributions. Happy to walk through the comps if useful.",
          sentAt: daysAgo(1.6),
        },
        {
          id: "msg-webb-3",
          direction: "inbound",
          senderName: "Marcus Webb",
          senderEmail: "marcus@webblogisticsllc.com",
          bodyText:
            "That's helpful, thank you. One more thing — can we revisit this again in Q1 once the new contract with Meridian is signed? Revenue's about to jump quite a bit.",
          sentAt: hoursAgo(5),
        },
      ],
    },
    {
      id: "client-email-priya-natarajan-q4",
      clientId: "mock-client-priya-natarajan",
      clientName: "Priya Natarajan",
      subject: "Your Q4 estimate is ready for review",
      activeProjects: [{ id: "proj-priya-2025-1040", name: "2025 Individual Tax Return" }],
      assignedProjectId: "proj-priya-2025-1040",
      read: true,
      messages: [
        {
          id: "msg-priya-1",
          direction: "outbound",
          senderName: "Alex Chen, CPA",
          senderEmail: "alex@mottafinancial.com",
          bodyText:
            "Hi Priya, I've posted your Q4 estimated payment voucher to the portal — it's due January 15. Numbers look consistent with your Q3 projection, no surprises. Let me know if anything's changed on your end.",
          sentAt: daysAgo(3),
        },
      ],
    },
    {
      id: "client-email-whitfield-inventory",
      clientId: "mock-client-whitfield-group",
      clientName: "The Whitfield Group",
      subject: "Year-end inventory count question",
      activeProjects: [
        { id: "proj-whitfield-yearend", name: "Year-End Close" },
        { id: "proj-whitfield-audit", name: "2025 Audit Prep" },
      ],
      assignedProjectId: "proj-whitfield-yearend",
      read: true,
      messages: [
        {
          id: "msg-whitfield-1",
          direction: "inbound",
          senderName: "Diane Whitfield",
          senderEmail: "diane@whitfieldgroup.com",
          bodyText:
            "Do we need to do a full physical inventory count on 12/31, or is our cycle-count schedule good enough for the year-end close this time?",
          sentAt: daysAgo(6),
        },
        {
          id: "msg-whitfield-2",
          direction: "outbound",
          senderName: "Alex Chen, CPA",
          senderEmail: "alex@mottafinancial.com",
          bodyText:
            "Cycle counts are fine as long as every SKU gets counted at least once this quarter and the variance log stays under our 2% threshold — you're tracking well within that, so no full count needed.",
          sentAt: daysAgo(5.5),
        },
      ],
    },
    {
      id: "client-email-daniel-ortiz-extension",
      clientId: "mock-client-daniel-ortiz",
      clientName: "Daniel Ortiz",
      subject: "Extension confirmation and next steps",
      activeProjects: [{ id: "proj-ortiz-2025-1040", name: "2025 Individual Tax Return" }],
      assignedProjectId: null,
      read: false,
      messages: [
        {
          id: "msg-ortiz-1",
          direction: "inbound",
          senderName: "Daniel Ortiz",
          senderEmail: "d.ortiz@ortizcreative.co",
          bodyText:
            "Hey, did the extension go through okay? I got a confirmation email from the IRS but wanted to double check with you all too.",
          sentAt: daysAgo(9),
        },
        {
          id: "msg-ortiz-2",
          direction: "outbound",
          senderName: "Priya Raman, EA",
          senderEmail: "priya@mottafinancial.com",
          bodyText:
            "Confirmed on our end as well — you're extended to October 15. We'll reach out once we have your K-1 to start the actual prep.",
          sentAt: daysAgo(8.7),
        },
        {
          id: "msg-ortiz-3",
          direction: "inbound",
          senderName: "Daniel Ortiz",
          senderEmail: "d.ortiz@ortizcreative.co",
          bodyText:
            "Perfect, thank you. The K-1 from the partnership should land by end of month — I'll forward it the day it shows up.",
          sentAt: daysAgo(8.5),
        },
        {
          id: "msg-ortiz-4",
          direction: "inbound",
          senderName: "Daniel Ortiz",
          senderEmail: "d.ortiz@ortizcreative.co",
          bodyText:
            "Following up — the K-1 finally came in, attached here. Also wanted to flag I sold a small crypto position in November that I don't think I mentioned before.",
          sentAt: hoursAgo(14),
        },
      ],
    },
  ]
}
