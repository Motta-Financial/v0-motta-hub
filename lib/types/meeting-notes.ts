export interface MeetingNote {
  id: string
  airtable_id?: string
  client_name: string
  meeting_date: string
  meeting_type?: string
  attendees?: string[]
  agenda?: string
  notes?: string
  action_items?: string[]
  follow_up_date?: string
  status?: string
  karbon_client_key?: string
  created_by?: string
  created_at?: string
  updated_at?: string
}

export interface AirtableMeetingNote {
  id: string
  fields: {
    "Client Name"?: string
    "Meeting Date"?: string
    "Meeting Type"?: string
    Attendees?: string[]
    Agenda?: string
    Notes?: string
    "Action Items"?: string[]
    "Follow Up Date"?: string
    Status?: string
    "Karbon Client Key"?: string
    "Created By"?: string
  }
}
