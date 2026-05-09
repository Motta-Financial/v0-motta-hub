"use client"

/**
 * Read-only text renderer that highlights resolved @mentions.
 *
 * Pairs with `<MentionTextarea>` — anything the textarea inserts (and
 * anything a user types by hand that happens to match a teammate)
 * lights up here as a styled chip. Unresolved mentions ("@somebody",
 * "@everyone", an email-like @bar.com fragment) render as plain text.
 *
 * We deliberately use a `<span>` wrapper (not `<p>`) so the renderer
 * can be dropped inside existing `<p>` tags without invalid nesting —
 * every existing caller (message board posts, debrief comments, etc.)
 * had its content inside a `<p>` already.
 */

import { tokenizeMentions, type MentionMember } from "@/lib/mentions"
import { useTeamMembers } from "@/lib/use-team-members"
import { cn } from "@/lib/utils"

interface MentionTextProps {
  text: string | null | undefined
  members?: MentionMember[]
  className?: string
}

export function MentionText({ text, members: membersProp, className }: MentionTextProps) {
  const fetched = useTeamMembers()
  const members = membersProp ?? fetched.members

  if (!text) return null
  const tokens = tokenizeMentions(text, members)

  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {tokens.map((t, i) => {
        if (t.kind === "mention") {
          return (
            <span
              key={i}
              title={t.member.full_name}
              className="rounded bg-blue-100 px-1 py-0.5 font-medium text-blue-800"
            >
              {t.raw}
            </span>
          )
        }
        return <span key={i}>{t.text}</span>
      })}
    </span>
  )
}
