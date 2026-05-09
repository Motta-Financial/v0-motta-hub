"use client"

/**
 * Drop-in replacement for `<Textarea>` that adds @-mention support.
 *
 * Behavior (modeled after Slack / GitHub / Linear):
 *   - Typing "@" opens a popover anchored under the textarea with the
 *     active team-members directory.
 *   - Continuing to type narrows the list (first-name `startsWith`,
 *     then full_name `startsWith`, then `includes`).
 *   - Up/Down arrows move the highlight; Enter or Tab inserts the
 *     selected teammate; Esc dismisses.
 *   - On selection we splice the typed token out and replace it with
 *     "@FirstName " (with a trailing space so the user can keep typing).
 *     If the picker resolves to an ambiguous first name (two Carolines)
 *     we insert the disambiguated "@First Last " form.
 *
 * Keeps every other Textarea prop (rows, className, placeholder, …)
 * working transparently by forwarding `...rest` to the inner element
 * so existing call sites need ~no other changes.
 *
 * Storage: still raw text. The selected mention is just inlined as
 * "@FirstName " — the same shape a user would type by hand. This
 * means there's no special markup the rest of the system has to learn,
 * and the read-only renderer (`<MentionText>`) handles both
 * picker-inserted and hand-typed mentions identically.
 */

import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import {
  detectActiveMentionToken,
  searchMembers,
  type MentionMember,
} from "@/lib/mentions"
import { useTeamMembers } from "@/lib/use-team-members"
import { cn } from "@/lib/utils"

type TextareaProps = ComponentProps<typeof Textarea>

interface MentionTextareaProps extends Omit<TextareaProps, "onChange" | "value"> {
  value: string
  onChange: (next: string) => void
  /**
   * Optional override of the directory. Defaults to the result of
   * `useTeamMembers()` — pass this only when a parent already has the
   * list in memory and wants to avoid the SWR fetch.
   */
  members?: MentionMember[]
}

function initialsFor(member: MentionMember): string {
  if (member.first_name && member.last_name) {
    return `${member.first_name[0]}${member.last_name[0]}`.toUpperCase()
  }
  const parts = (member.full_name || "").split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return "?"
}

export const MentionTextarea = forwardRef<HTMLTextAreaElement, MentionTextareaProps>(
  function MentionTextarea(
    { value, onChange, members: membersProp, onKeyDown, className, ...rest },
    ref,
  ) {
    const innerRef = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement)

    // Fall back to the SWR-cached directory when the parent didn't
    // supply one. The hook short-circuits to the cached payload on
    // subsequent mounts so this stays cheap.
    const fetched = useTeamMembers()
    const members = membersProp ?? fetched.members

    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [tokenStart, setTokenStart] = useState(0)
    const [activeIdx, setActiveIdx] = useState(0)

    const filtered = useMemo(
      () => (open ? searchMembers(query, members, 8) : []),
      [open, query, members],
    )

    /**
     * Re-evaluate whether the caret is inside an active "@…" token after
     * every change/selection event. We use `selectionStart` straight
     * off the underlying element (not React state) because uncontrolled
     * caret tracking is faster and avoids a render lag where the
     * picker briefly disagrees with the actual cursor.
     */
    function syncMentionState(nextValue: string, caret: number) {
      const trigger = detectActiveMentionToken(nextValue, caret)
      if (trigger) {
        setOpen(true)
        setTokenStart(trigger.start)
        setQuery(trigger.query)
        setActiveIdx(0)
      } else if (open) {
        setOpen(false)
      }
    }

    function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
      const next = e.target.value
      onChange(next)
      syncMentionState(next, e.target.selectionStart ?? next.length)
    }

    /**
     * Insert the selected member, replacing the in-progress token. We
     * insert "@FirstName " when the first name is unambiguous, else
     * "@First Last " — picking the form that will round-trip back to
     * the same person through `findMember`.
     */
    function selectMember(member: MentionMember) {
      const ta = innerRef.current
      if (!ta) return
      const caret = ta.selectionStart ?? value.length

      const firstNameUnique =
        !!member.first_name &&
        members.filter(
          (m) =>
            (m.first_name || "").trim().toLowerCase() ===
            (member.first_name || "").trim().toLowerCase(),
        ).length === 1

      const display = firstNameUnique
        ? member.first_name!
        : member.full_name || member.first_name || "user"

      const insertion = `@${display} `
      const before = value.slice(0, tokenStart)
      const after = value.slice(caret)
      const next = before + insertion + after
      onChange(next)
      setOpen(false)

      // Restore caret right after the inserted mention. We schedule on
      // the next frame because React hasn't reconciled the new value
      // into the DOM yet at this point.
      requestAnimationFrame(() => {
        const node = innerRef.current
        if (!node) return
        const pos = before.length + insertion.length
        node.focus()
        node.setSelectionRange(pos, pos)
      })
    }

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (open && filtered.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault()
          setActiveIdx((i) => (i + 1) % filtered.length)
          return
        }
        if (e.key === "ArrowUp") {
          e.preventDefault()
          setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length)
          return
        }
        if (e.key === "Enter" || e.key === "Tab") {
          // Steal the keystroke when the picker is open so the parent
          // form's Enter-to-submit / Tab-to-next-field doesn't fire.
          e.preventDefault()
          e.stopPropagation()
          selectMember(filtered[activeIdx])
          return
        }
        if (e.key === "Escape") {
          e.preventDefault()
          setOpen(false)
          return
        }
      }
      onKeyDown?.(e)
    }

    function handleSelect(e: React.SyntheticEvent<HTMLTextAreaElement>) {
      // Cursor moved (arrow keys, mouse click) — re-evaluate context.
      const node = e.currentTarget
      syncMentionState(node.value, node.selectionStart ?? node.value.length)
    }

    function handleBlur() {
      // Defer the close so a click on the popover registers as a
      // selection before the popover unmounts.
      setTimeout(() => setOpen(false), 120)
    }

    return (
      <div className="relative">
        <Textarea
          ref={innerRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onSelect={handleSelect}
          onBlur={handleBlur}
          className={className}
          {...rest}
        />
        {open && filtered.length > 0 && (
          <div
            role="listbox"
            className={cn(
              "absolute left-0 z-50 mt-1 w-72 rounded-md border bg-popover text-popover-foreground shadow-lg",
              "top-full",
            )}
          >
            <ul className="py-1 max-h-72 overflow-y-auto">
              {filtered.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === activeIdx}
                    // onMouseDown (not onClick) so the textarea blur
                    // handler doesn't dismiss the popover before the
                    // click registers.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectMember(m)
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                      i === activeIdx ? "bg-accent" : "hover:bg-accent/60",
                    )}
                  >
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="bg-blue-100 text-blue-700 text-xs font-medium">
                        {initialsFor(m)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{m.full_name}</span>
                      {m.first_name && (
                        <span className="truncate text-xs text-muted-foreground">
                          @{m.first_name}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  },
)
