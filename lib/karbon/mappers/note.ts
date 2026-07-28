/**
 * Pure mapper: Karbon Note JSON -> Supabase karbon_notes row.
 *
 * NOTE on the response shape: GET /v3/Notes/{key} does NOT return the fields
 * the old mapper assumed. Verified against a live response (2026-07-28):
 *   - the key comes back as `Id`, not `NoteKey`
 *   - the author is `AuthorEmailAddress` only — no AuthorKey/AuthorName
 *   - there is no NoteType, IsPinned, WorkItemKey, ContactKey, or
 *     LastModifiedDateTime
 *   - work-item/contact linkage lives in `Timelines[]` as
 *     { EntityType: 'WorkItem' | 'Contact' | ..., EntityKey }
 * We keep the old field names as fallbacks in case other call sites (e.g. the
 * POST /Notes echo) still supply them.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

function timelineKey(note: any, entityType: string): string | null {
  if (!Array.isArray(note.Timelines)) return null
  const entry = note.Timelines.find((t: any) => t?.EntityType === entityType)
  return entry?.EntityKey || null
}

export function mapKarbonNoteToSupabase(note: any) {
  const noteKey = note.Id || note.NoteKey || null

  return {
    karbon_note_key: noteKey,
    subject: note.Subject || null,
    body: note.Body || null,
    note_type: note.NoteType || null,
    is_pinned: note.IsPinned || false,
    author_key: note.AuthorKey || null,
    author_name: note.AuthorName || note.AuthorEmailAddress || null,
    assignee_email: note.AssigneeEmailAddress || null,
    due_date: note.DueDate ? String(note.DueDate).split("T")[0] : null,
    todo_date: note.TodoDate ? String(note.TodoDate).split("T")[0] : null,
    timelines: note.Timelines || null,
    comments: note.Comments || null,
    karbon_work_item_key: note.WorkItemKey || timelineKey(note, "WorkItem"),
    work_item_title: note.WorkItemTitle || null,
    karbon_contact_key: note.ContactKey || timelineKey(note, "Contact"),
    contact_name: note.ContactName || null,
    karbon_url: noteKey ? `${KARBON_TENANT_PREFIX}/notes/${noteKey}` : null,
    karbon_created_at: note.CreatedDate || null,
    karbon_modified_at: note.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
