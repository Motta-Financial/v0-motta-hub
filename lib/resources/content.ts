// ---------------------------------------------------------------------------
// Resources content — single source of truth for the /resources knowledge base.
//
// This is intentionally plain, typed data (no DB) so the Resources page renders
// instantly and the content is easy to edit in code review. The `clientResources`
// and `templates` banks are shaped so they can be swapped for a Supabase table +
// Vercel Blob uploads later WITHOUT touching the UI: add `id`, `createdAt`, etc.
// and replace the static arrays with a fetch.
//
// Naming rule (per firm guidance): this product is "ALFRED Hub". ALFRED Ai is the
// assistant/orchestrator that lives inside it. Never call the platform "Motta Hub"
// in user-facing copy.
// ---------------------------------------------------------------------------

export type ResourceTab =
  | "hub-guide"
  | "sops"
  | "faq"
  | "client-resources"
  | "templates"

export type LucideName =
  | "Compass"
  | "ClipboardList"
  | "HelpCircle"
  | "FolderKanban"
  | "FileText"
  | "Bot"
  | "Users"
  | "Calendar"
  | "Video"
  | "Calculator"
  | "Receipt"
  | "Workflow"
  | "Database"
  | "Mail"
  | "CreditCard"
  | "Briefcase"
  | "CheckSquare"
  | "MessageSquare"
  | "TrendingUp"
  | "Upload"
  | "ShieldCheck"
  | "Inbox"

// ── Top-level tabs ─────────────────────────────────────────────────────────
export const RESOURCE_TABS: {
  id: ResourceTab
  label: string
  icon: LucideName
  blurb: string
}[] = [
  {
    id: "hub-guide",
    label: "Hub Guide",
    icon: "Compass",
    blurb: "What every part of ALFRED Hub does and the systems behind it.",
  },
  {
    id: "sops",
    label: "SOPs",
    icon: "ClipboardList",
    blurb: "Step-by-step standard operating procedures for daily work.",
  },
  {
    id: "faq",
    label: "FAQ",
    icon: "HelpCircle",
    blurb: "Quick answers to the questions the team asks most.",
  },
  {
    id: "client-resources",
    label: "Client Resources",
    icon: "FolderKanban",
    blurb: "Vetted links and guides to share with clients.",
  },
  {
    id: "templates",
    label: "Templates",
    icon: "FileText",
    blurb: "Reusable email, document, and message templates.",
  },
]

// ── Hub Guide: what ALFRED Ai is ─────────────────────────────────────────────
export const ALFRED_OVERVIEW = {
  title: "Meet ALFRED",
  tagline: "Your virtual butler for the whole firm.",
  body: [
    "ALFRED Hub is the firm's operating system — clients, projects, intake, meetings, and tax returns all live in one place. ALFRED Ai is the assistant that lives inside the Hub and connects the dots across every tool the firm uses.",
    "Instead of logging into six systems to answer one question, you ask ALFRED. It reads from the Hub's centralized record and the systems wired into it, then answers in plain language — grounded in real client context and the latest communications.",
  ],
  capabilities: [
    "Answer questions about clients, deals, projects, and deadlines",
    "Summarize what was said in a recorded meeting",
    "Surface who referred a prospect and where they are in intake",
    "Pull a pipeline or project breakdown on demand",
  ],
}

// ── Hub Guide: feature areas (pages) ─────────────────────────────────────────
export const FEATURE_AREAS: {
  name: string
  icon: LucideName
  path: string
  what: string
  integrations: string[]
}[] = [
  {
    name: "Home & Triage",
    icon: "CheckSquare",
    path: "/",
    what: "Your launchpad. Triage surfaces what needs attention today across work items, clients, calendar, and debriefs.",
    integrations: ["Karbon", "Supabase"],
  },
  {
    name: "Clients",
    icon: "Users",
    path: "/clients",
    what: "The master client record — the single source of truth. Every contact and organization links back here, so nothing lives in just one tool.",
    integrations: ["Karbon", "Supabase", "ProConnect"],
  },
  {
    name: "Projects & Work Items",
    icon: "Workflow",
    path: "/projects",
    what: "Groups Karbon work items into projects by type and template, with status, owners, and assignees so you can see the whole book of work.",
    integrations: ["Karbon"],
  },
  {
    name: "Meetings & Deals",
    icon: "Video",
    path: "/meetings",
    what: "The deal pipeline is the landing page; meetings, recordings, and debriefs hang off it. Calendly bookings and Zoom calls auto-link to the right client and work item.",
    integrations: ["Calendly", "Zoom", "ALFRED Ai"],
  },
  {
    name: "Tax",
    icon: "Calculator",
    path: "/tax",
    what: "Individual (1040), business, and nonprofit returns with client relationships and return data synced from the tax software.",
    integrations: ["ProConnect"],
  },
  {
    name: "Sales & Billing",
    icon: "TrendingUp",
    path: "/sales",
    what: "Pipeline dashboard, proposals, invoices, recurring revenue, and payments — from first proposal to collected cash.",
    integrations: ["Ignition", "Stripe"],
  },
  {
    name: "Intake & Feedback",
    icon: "Inbox",
    path: "/sales/intake",
    what: "Prospect intake (internal and public forms) plus client feedback, all triaged and linked to the master record by ALFRED.",
    integrations: ["Jotform", "ALFRED Ai", "Resend"],
  },
  {
    name: "Talent",
    icon: "Briefcase",
    path: "/teammates",
    what: "The people side — team directory, Tommy Awards recognition, the Motta Alliance series, and the Training library.",
    integrations: ["Supabase"],
  },
]

// ── Hub Guide: integrations (the liaison layer) ──────────────────────────────
export const INTEGRATIONS: {
  name: string
  icon: LucideName
  role: string
  detail: string
  dataFlow: string
}[] = [
  {
    name: "ALFRED Ai",
    icon: "Bot",
    role: "Assistant & orchestrator",
    detail: "Reads across the Hub and answers in plain language, grounded in real client context.",
    dataFlow: "Reads a governed allowlist of Hub tables; never sees raw download tokens.",
  },
  {
    name: "Karbon",
    icon: "Workflow",
    role: "Practice management",
    detail: "The system of record for work items, clients, and workflow status.",
    dataFlow: "Two-way: webhooks push changes in; the Hub links work to the master record.",
  },
  {
    name: "ProConnect",
    icon: "Calculator",
    role: "Tax software",
    detail: "Source of tax returns, return data, and client tax relationships.",
    dataFlow: "Syncs return + engagement data into the Tax section via OAuth.",
  },
  {
    name: "Calendly",
    icon: "Calendar",
    role: "Scheduling",
    detail: "Booking links, event types, and routing forms for client meetings.",
    dataFlow: "Webhooks create meeting records and auto-link the invitee to a client.",
  },
  {
    name: "Zoom",
    icon: "Video",
    role: "Meetings & recordings",
    detail: "Call recordings and transcripts that ALFRED can summarize.",
    dataFlow: "Account-wide sweep pulls recordings + transcripts and links them to clients.",
  },
  {
    name: "Ignition",
    icon: "Receipt",
    role: "Proposals & billing",
    detail: "Client proposals and engagement-based billing.",
    dataFlow: "Webhooks sync proposal and billing status into Sales.",
  },
  {
    name: "Stripe",
    icon: "CreditCard",
    role: "Payments",
    detail: "Processes client payments and surfaces them against invoices.",
    dataFlow: "Payment events reconcile to invoices in the Sales section.",
  },
  {
    name: "Resend",
    icon: "Mail",
    role: "Email",
    detail: "Transactional email — team notifications and client-facing sends.",
    dataFlow: "The Hub triggers templated emails on key events.",
  },
  {
    name: "Supabase",
    icon: "Database",
    role: "Central database",
    detail: "The centralized store behind the entire Hub and the master client record.",
    dataFlow: "Single source of truth; every other system links back to it.",
  },
]

// ── SOPs ─────────────────────────────────────────────────────────────────────
export type Sop = {
  id: string
  title: string
  audience: string
  icon: LucideName
  summary: string
  steps: { title: string; detail: string }[]
  tips?: string[]
}

export const SOPS: Sop[] = [
  {
    id: "daily-triage",
    title: "Start your day in Triage",
    audience: "Everyone",
    icon: "CheckSquare",
    summary:
      "Triage is the launchpad. Run it first thing so nothing slips between systems.",
    steps: [
      { title: "Open Home", detail: "Triage loads automatically with today's priorities pulled from Karbon and the Hub." },
      { title: "Clear assignments", detail: "Work top-to-bottom; open each work item to see linked client, meetings, and notes." },
      { title: "Check the calendar rail", detail: "Confirm today's meetings have a linked client. If one is missing, link it manually." },
      { title: "Ask ALFRED", detail: "Unsure what a client needs? Ask ALFRED for a summary before you start." },
    ],
    tips: ["If a work item has no client, it likely needs linking — fix it so it shows up everywhere."],
  },
  {
    id: "new-prospect",
    title: "Log a new prospect",
    audience: "Sales / Front desk",
    icon: "Inbox",
    summary:
      "Use the internal prospect form so the lead, referral, and master record all connect.",
    steps: [
      { title: "Open the Prospect Form", detail: "Use Forms → Prospect Form in the header, or /prospects/new." },
      { title: "Pick the prospect type", detail: "Individual, business, or both — this drives which fields are required." },
      { title: "Capture the referral", detail: "Enter who referred them; the Hub matches it to an existing contact when possible." },
      { title: "Submit", detail: "ALFRED enriches the lead, links it to the master record, and notifies the team." },
    ],
    tips: ["Never manually create a duplicate contact — let the form resolve to the master record."],
  },
  {
    id: "meeting-to-debrief",
    title: "From meeting to debrief",
    audience: "Advisors",
    icon: "Video",
    summary:
      "Calendly + Zoom auto-link to the client; you just add the debrief.",
    steps: [
      { title: "Meeting is booked", detail: "Calendly creates the meeting record and links the client automatically." },
      { title: "Hold the Zoom call", detail: "The recording and transcript sync back and attach to the meeting." },
      { title: "Review the transcript", detail: "Open the meeting; ask ALFRED to summarize what was discussed." },
      { title: "File a debrief", detail: "Use Forms → Debrief Form to capture outcomes and next steps." },
    ],
  },
  {
    id: "tax-return-flow",
    title: "Track a tax return",
    audience: "Tax team",
    icon: "Calculator",
    summary: "Returns flow in from ProConnect — keep the client relationship clean.",
    steps: [
      { title: "Find the client", detail: "Tax → Clients shows everyone with a linked return." },
      { title: "Open the return", detail: "Individual (1040), business, or nonprofit — return data syncs from ProConnect." },
      { title: "Verify relationships", detail: "Tax → Relationships shows linked spouses, entities, and owners." },
      { title: "Work the return", detail: "Status and data stay in sync; no manual re-keying between systems." },
    ],
  },
  {
    id: "ask-alfred",
    title: "Get a good answer from ALFRED",
    audience: "Everyone",
    icon: "Bot",
    summary: "ALFRED is grounded in Hub data — ask specific, context-rich questions.",
    steps: [
      { title: "Be specific", detail: "Name the client, deal, or project. 'What's open for Acme LLC?' beats 'what's open?'" },
      { title: "Ask for the source", detail: "ALFRED can tell you which meeting, work item, or record an answer came from." },
      { title: "Chain follow-ups", detail: "Refine in the same thread — ALFRED keeps the context." },
      { title: "Escalate if unsure", detail: "For anything sensitive or ambiguous, verify against the source record." },
    ],
  },
]

// ── FAQ ────────────────────────────────────────────────────────────────────
export type FaqCategory = {
  category: string
  items: { q: string; a: string }[]
}

export const FAQS: FaqCategory[] = [
  {
    category: "Getting started",
    items: [
      { q: "What is the difference between ALFRED Hub and ALFRED Ai?", a: "ALFRED Hub is the platform — the firm's operating system. ALFRED Ai is the assistant inside it that answers questions and connects information across every tool." },
      { q: "How do I sign in?", a: "Use your firm account at the Hub URL. If you can't get in, ask an admin to check your access under Settings → Users." },
      { q: "Where do I start each day?", a: "Home → Triage. It pulls together everything that needs attention today." },
    ],
  },
  {
    category: "Clients & data",
    items: [
      { q: "Why is the client record the 'source of truth'?", a: "Every system (Karbon, ProConnect, Calendly, Zoom) links back to one master contact/organization record in the Hub, so you never chase the same client across tools." },
      { q: "I see a duplicate client — what do I do?", a: "Don't delete anything. Flag it for review; admins resolve merges through Master Client Mapping so links aren't broken." },
      { q: "A meeting isn't linked to a client. How do I fix it?", a: "Open the meeting and link the client manually. Auto-linking handles most cases, but low-confidence matches are left for a human." },
    ],
  },
  {
    category: "ALFRED Ai",
    items: [
      { q: "Can ALFRED see everything?", a: "No. ALFRED reads from a governed allowlist of Hub data. Sensitive items like recording download links are deliberately excluded." },
      { q: "Does ALFRED read meeting transcripts?", a: "Yes — through a restricted view that exposes the transcript text only, never download tokens or raw media." },
      { q: "Why did ALFRED say it couldn't find something?", a: "Either the data isn't in the Hub yet, or it's outside ALFRED's allowlist. Check the source system or ask an admin." },
    ],
  },
  {
    category: "Meetings & scheduling",
    items: [
      { q: "Where do my Calendly bookings show up?", a: "Under Meetings → Calendly, and as meeting records that link to the client automatically." },
      { q: "Where are Zoom recordings?", a: "Meetings → Zoom. Admins can run an account-wide sync to pull in recordings from teammates who never personally connected." },
    ],
  },
  {
    category: "Billing & sales",
    items: [
      { q: "Where do proposals come from?", a: "Ignition. Proposal and billing status sync into the Sales section." },
      { q: "How are payments tracked?", a: "Stripe processes payments and reconciles them against invoices under Sales." },
    ],
  },
]

// ── Client Resources bank (curated; DB-ready) ────────────────────────────────
export type ClientResource = {
  title: string
  description: string
  category: string
  icon: LucideName
  href?: string
}

export const CLIENT_RESOURCES: ClientResource[] = [
  { title: "New Client Welcome Guide", description: "What to expect in the first 30 days working with the firm.", category: "Onboarding", icon: "Users" },
  { title: "Document Upload Instructions", description: "How clients securely send tax and bookkeeping documents.", category: "Onboarding", icon: "Upload" },
  { title: "Tax Season Checklist", description: "Everything an individual client needs to gather before filing.", category: "Tax", icon: "Calculator" },
  { title: "Business Tax Prep Checklist", description: "Entity documents and records needed for business returns.", category: "Tax", icon: "Calculator" },
  { title: "Bookkeeping Best Practices", description: "Monthly habits that keep books clean and audit-ready.", category: "Accounting", icon: "Receipt" },
  { title: "Paying an Invoice", description: "Step-by-step guide for clients paying online.", category: "Billing", icon: "CreditCard" },
  { title: "Booking a Meeting", description: "How clients schedule time with their advisor.", category: "Meetings", icon: "Calendar" },
  { title: "Security & Privacy Overview", description: "How the firm protects client data and communications.", category: "Trust", icon: "ShieldCheck" },
]

// ── Templates bank (curated; DB-ready) ───────────────────────────────────────
export type TemplateItem = {
  title: string
  description: string
  type: "Email" | "Document" | "Message" | "Checklist"
  icon: LucideName
  body?: string
}

export const TEMPLATES: TemplateItem[] = [
  {
    title: "Prospect intro reply",
    description: "First response to a new inbound prospect.",
    type: "Email",
    icon: "Mail",
    body: "Hi {{first_name}},\n\nThank you for reaching out to Motta Financial — we're glad you found us. I'd love to learn a bit more about what you're looking for so we can point you in the right direction.\n\nAre you available for a quick call this week? You can grab a time that works here: {{scheduling_link}}\n\nTalk soon,\n{{advisor_name}}",
  },
  {
    title: "Meeting follow-up",
    description: "Recap and next steps after a client call.",
    type: "Email",
    icon: "MessageSquare",
    body: "Hi {{first_name}},\n\nGreat speaking with you today. Here's a quick recap of what we covered and the next steps:\n\n- {{recap_point_1}}\n- {{recap_point_2}}\n\nNext steps:\n- {{next_step_1}}\n\nIf anything looks off, just reply here.\n\nBest,\n{{advisor_name}}",
  },
  {
    title: "Document request",
    description: "Ask a client for missing documents.",
    type: "Email",
    icon: "Upload",
    body: "Hi {{first_name}},\n\nTo keep your {{engagement}} moving, we still need the following:\n\n- {{document_1}}\n- {{document_2}}\n\nYou can upload them securely here: {{upload_link}}\n\nThanks so much,\n{{advisor_name}}",
  },
  {
    title: "Engagement kickoff checklist",
    description: "Internal checklist to launch a new engagement.",
    type: "Checklist",
    icon: "ClipboardList",
    body: "- [ ] Confirm signed proposal in Ignition\n- [ ] Create / link client in the Hub\n- [ ] Set up Karbon work items\n- [ ] Schedule kickoff meeting\n- [ ] Send welcome guide",
  },
  {
    title: "Payment reminder",
    description: "Friendly nudge on an outstanding invoice.",
    type: "Message",
    icon: "CreditCard",
    body: "Hi {{first_name}}, a quick reminder that invoice {{invoice_number}} for {{amount}} is due {{due_date}}. You can pay securely here: {{payment_link}}. Thank you!",
  },
  {
    title: "Annual review invite",
    description: "Invite a client to their yearly planning meeting.",
    type: "Email",
    icon: "Calendar",
    body: "Hi {{first_name}},\n\nIt's time for your annual review — a chance to look back at the year and plan ahead. Grab a time that works for you here: {{scheduling_link}}.\n\nLooking forward to it,\n{{advisor_name}}",
  },
]
