export interface ZoomMeeting {
  id: string
  uuid: string
  host_id: string
  host_email: string
  topic: string
  type: number // 1=Instant, 2=Scheduled, 3=Recurring with no fixed time, 8=Recurring with fixed time
  status: string // waiting, started, finished
  start_time: string
  duration: number // in minutes
  timezone: string
  agenda?: string
  created_at: string
  join_url: string
  password?: string
  participants?: ZoomParticipant[]
}

export interface ZoomParticipant {
  id: string
  user_id: string
  name: string
  user_email: string
  join_time: string
  leave_time?: string
  duration: number // in seconds
  attentiveness_score?: number
}

export interface ZoomRecording {
  id: string
  uuid: string
  meeting_id: string
  recording_start: string
  recording_end: string
  file_type: string // MP4, M4A, TIMELINE, TRANSCRIPT, CHAT, CC
  file_size: number
  play_url: string
  download_url: string
  status: string
  recording_type: string // shared_screen_with_speaker_view, audio_only, etc.
}

export interface ZoomCallHistory {
  id: string
  caller_number: string
  caller_name?: string
  callee_number: string
  callee_name?: string
  direction: "inbound" | "outbound"
  duration: number // in seconds
  result: string // Call Accepted, Voicemail, Missed, Cancelled, etc.
  date_time: string
  path?: string
  has_recording?: boolean
  recording_url?: string
}

export interface ZoomUser {
  id: string
  first_name: string
  last_name: string
  email: string
  type: number // 1=Basic, 2=Licensed, 3=On-prem
  status: string // active, inactive, pending
  pmi: number
  timezone: string
  verified: number
  dept?: string
  created_at: string
  last_login_time?: string
  pic_url?: string
  phone_number?: string
  phone_numbers?: Array<{
    country: string
    code: string
    number: string
    verified: boolean
    label: string
  }>
}

export interface ZoomTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope: string
}
