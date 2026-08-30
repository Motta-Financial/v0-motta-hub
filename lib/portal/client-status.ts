/**
 * Collapses the portal's internal work-item status into the three
 * plain-English states a client actually needs: are we working on it,
 * do we need something from you, or is it done. Every surface that
 * shows a client-facing status — project cards, the project detail
 * header, and the dashboard's active work list — should derive its
 * copy from here so a client never sees a raw Karbon status code.
 *
 * The "waiting on" document names are mocked: there's no persisted
 * document-request pipeline yet (see lib/mock/document-requests.ts),
 * so we deterministically derive a plausible 1–2 item list from the
 * work item's id. Swap `pickWaitingOn` for a real lookup once document
 * requests are backed by a table.
 */

export type ClientStatusTone = "working" | "needs-you" | "done"

export interface ClientStatus {
  tone: ClientStatusTone
  label: string
  explanation: string
  waitingOn: string[] | null
}

interface DeriveClientStatusInput {
  id: string
  /** Raw statusDisplay.label from the API — never rendered directly. */
  rawLabel: string
  hasBlockingTodos: boolean
  assigneeName?: string | null
}

const DONE_PATTERN = /complete|filed|closed|finished/i

// Mock pool of realistic document names, standing in for a real
// document-request lookup.
const WAITING_ON_POOL = [
  "2024 W-2",
  "closing statement",
  "1099-INT",
  "prior year tax return",
  "signed engagement letter",
  "mortgage interest statement (1098)",
  "K-1 from partnership",
  "brokerage consolidated 1099",
]

/** Deterministic so the same work item shows the same items everywhere. */
function pickWaitingOn(seed: string): string[] {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  const count = (hash % 2) + 1 // 1 or 2 items
  const items: string[] = []
  let idx = hash % WAITING_ON_POOL.length
  for (let i = 0; i < count; i++) {
    items.push(WAITING_ON_POOL[idx % WAITING_ON_POOL.length])
    idx += 7
  }
  return Array.from(new Set(items))
}

export function deriveClientStatus({
  id,
  rawLabel,
  hasBlockingTodos,
  assigneeName,
}: DeriveClientStatusInput): ClientStatus {
  if (DONE_PATTERN.test(rawLabel)) {
    return {
      tone: "done",
      label: "Done",
      explanation: "This is complete — no action needed from you.",
      waitingOn: null,
    }
  }

  if (hasBlockingTodos) {
    const waitingOn = pickWaitingOn(id)
    const explanation =
      waitingOn.length === 1
        ? "We're waiting on one document before we can continue."
        : `We're waiting on ${waitingOn.length} documents before we can continue.`
    return {
      tone: "needs-you",
      label: "We need something from you",
      explanation,
      waitingOn,
    }
  }

  return {
    tone: "working",
    label: "We're working on it",
    explanation: assigneeName
      ? `${assigneeName} is preparing your return — we'll message you if we need anything.`
      : "Nothing needed from you right now — we'll reach out if that changes.",
    waitingOn: null,
  }
}
