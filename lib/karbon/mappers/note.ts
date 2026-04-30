/**
 * Pure mapper: Karbon Note JSON -> Supabase karbon_notes row.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonNoteToSupabase(note: any) {
  return {
    karbon_note_key: note.NoteKey,
    subject: note.Subject || null,
    body: note.Body || null,
    note_type: note.NoteType || null,
    is_pinned: note.IsPinned || false,
    author_key: note.AuthorKey || null,
    author_name: note.AuthorName || null,
    assignee_email: note.AssigneeEmailAddress || null,
    due_date: note.DueDate ? String(note.DueDate).split("T")[0] : null,
    todo_date: note.TodoDate ? String(note.TodoDate).split("T")[0] : null,
    timelines: note.Timelines || null,
    comments: note.Comments || null,
    karbon_work_item_key: note.WorkItemKey || null,
    work_item_title: note.WorkItemTitle || null,
    karbon_contact_key: note.ContactKey || null,
    contact_name: note.ContactName || null,
    karbon_url: note.NoteKey ? `${KARBON_TENANT_PREFIX}/notes/${note.NoteKey}` : null,
    karbon_created_at: note.CreatedDate || null,
    karbon_modified_at: note.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
