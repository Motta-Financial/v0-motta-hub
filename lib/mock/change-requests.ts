export type ChangeRequestField = "Phone number" | "Mailing address" | "Email"
export type ChangeRequestStatus = "pending" | "approved" | "dismissed"

export interface ChangeRequest {
  id: string
  clientName: string
  clientInitials: string
  field: ChangeRequestField
  currentValue: string
  requestedValue: string
  requestedBy: string
  requestedAtIso: string
  status: ChangeRequestStatus
}

const FIELD_ICON_KEY: Record<ChangeRequestField, "phone" | "address" | "email"> = {
  "Phone number": "phone",
  "Mailing address": "address",
  Email: "email",
}

export function fieldIconKey(field: ChangeRequestField) {
  return FIELD_ICON_KEY[field]
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24)
}

export const INITIAL_CHANGE_REQUESTS: ChangeRequest[] = [
  {
    id: "cr-1",
    clientName: "Priya Nandakumar",
    clientInitials: "PN",
    field: "Phone number",
    currentValue: "(415) 555-0148",
    requestedValue: "(415) 555-0192",
    requestedBy: "Priya Nandakumar",
    requestedAtIso: hoursAgo(3),
    status: "pending",
  },
  {
    id: "cr-2",
    clientName: "Priya Nandakumar",
    clientInitials: "PN",
    field: "Email",
    currentValue: "priya.n@nandakumardesign.com",
    requestedValue: "priya@nandakumardesign.com",
    requestedBy: "Priya Nandakumar",
    requestedAtIso: hoursAgo(3),
    status: "pending",
  },
  {
    id: "cr-3",
    clientName: "Marcus Webb",
    clientInitials: "MW",
    field: "Mailing address",
    currentValue: "482 Larkspur Rd, Unit 3, Sausalito, CA 94965",
    requestedValue: "1290 Bridgeway, Suite 210, Sausalito, CA 94965",
    requestedBy: "Marcus Webb",
    requestedAtIso: hoursAgo(9),
    status: "pending",
  },
  {
    id: "cr-4",
    clientName: "Golden Gate Rides LLC",
    clientInitials: "GR",
    field: "Phone number",
    currentValue: "(510) 555-0107",
    requestedValue: "(510) 555-0173",
    requestedBy: "Denise Alvarado",
    requestedAtIso: daysAgo(1),
    status: "pending",
  },
  {
    id: "cr-5",
    clientName: "Golden Gate Rides LLC",
    clientInitials: "GR",
    field: "Mailing address",
    currentValue: "77 Ferry Plaza, San Francisco, CA 94111",
    requestedValue: "77 Ferry Plaza, Suite 402, San Francisco, CA 94111",
    requestedBy: "Denise Alvarado",
    requestedAtIso: daysAgo(1),
    status: "pending",
  },
  {
    id: "cr-6",
    clientName: "Harold Fisk",
    clientInitials: "HF",
    field: "Email",
    currentValue: "hfisk@fiskandsons.net",
    requestedValue: "harold.fisk@fiskandsons.net",
    requestedBy: "Harold Fisk",
    requestedAtIso: daysAgo(2),
    status: "pending",
  },
  {
    id: "cr-7",
    clientName: "Marcus Webb",
    clientInitials: "MW",
    field: "Email",
    currentValue: "m.webb@webbconsulting.io",
    requestedValue: "marcus@webbconsulting.io",
    requestedBy: "Marcus Webb",
    requestedAtIso: daysAgo(6),
    status: "approved",
  },
  {
    id: "cr-8",
    clientName: "Harold Fisk",
    clientInitials: "HF",
    field: "Phone number",
    currentValue: "(650) 555-0121",
    requestedValue: "(650) 555-0199",
    requestedBy: "Harold Fisk",
    requestedAtIso: daysAgo(10),
    status: "dismissed",
  },
]
