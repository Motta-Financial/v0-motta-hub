"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Calendar, Upload, Plus, Search, FileText, Users, CheckSquare, RefreshCw, Cloud, Database } from "lucide-react"
import { format } from "date-fns"
import type { MeetingNote } from "@/lib/types/meeting-notes"

interface AirtableRecord {
  id: string
  fields: Record<string, unknown>
}

interface AirtableResponse {
  success: boolean
  totalRecords: number
  fieldNames: string[]
  sampleRecord: AirtableRecord | null
  records: AirtableRecord[]
}

export function MeetingNotesView() {
  const [notes, setNotes] = useState<MeetingNote[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [jsonInput, setJsonInput] = useState("")
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)
  const [selectedNote, setSelectedNote] = useState<MeetingNote | null>(null)

  const [airtableDialogOpen, setAirtableDialogOpen] = useState(false)
  const [airtableData, setAirtableData] = useState<AirtableResponse | null>(null)
  const [fetchingAirtable, setFetchingAirtable] = useState(false)
  const [importingToSupabase, setImportingToSupabase] = useState(false)

  const [newNote, setNewNote] = useState({
    client_name: "",
    meeting_date: "",
    meeting_type: "",
    attendees: "",
    agenda: "",
    notes: "",
    action_items: "",
    follow_up_date: "",
    status: "active",
    created_by: "",
  })

  useEffect(() => {
    fetchNotes()
  }, [])

  const fetchNotes = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/meeting-notes")
      const data = await res.json()
      if (data.data) {
        setNotes(data.data)
      }
    } catch (error) {
      console.error("Error fetching notes:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    setImporting(true)
    setImportResult(null)
    try {
      const parsed = JSON.parse(jsonInput)

      let records: Partial<MeetingNote>[] = []

      if (parsed.records) {
        records = parsed.records.map((record: { id: string; fields: Record<string, unknown> }) => ({
          airtable_id: record.id,
          client_name: record.fields["Client Name"] || record.fields["client_name"] || "",
          meeting_date: record.fields["Meeting Date"] || record.fields["meeting_date"] || null,
          meeting_type: record.fields["Meeting Type"] || record.fields["meeting_type"] || "",
          attendees: Array.isArray(record.fields["Attendees"])
            ? record.fields["Attendees"]
            : record.fields["attendees"]
              ? [record.fields["attendees"]]
              : [],
          agenda: record.fields["Agenda"] || record.fields["agenda"] || "",
          notes: record.fields["Notes"] || record.fields["notes"] || "",
          action_items: Array.isArray(record.fields["Action Items"])
            ? record.fields["Action Items"]
            : record.fields["action_items"]
              ? [record.fields["action_items"]]
              : [],
          follow_up_date: record.fields["Follow Up Date"] || record.fields["follow_up_date"] || null,
          status: record.fields["Status"] || record.fields["status"] || "active",
          karbon_client_key: record.fields["Karbon Client Key"] || record.fields["karbon_client_key"] || "",
          created_by: record.fields["Created By"] || record.fields["created_by"] || "",
        }))
      } else if (Array.isArray(parsed)) {
        records = parsed
      } else {
        throw new Error("Invalid format. Expected Airtable export or array of records.")
      }

      const res = await fetch("/api/meeting-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
      })

      const result = await res.json()

      if (result.error) {
        setImportResult(`Error: ${result.error}`)
      } else {
        setImportResult(`Successfully imported ${result.count} records!`)
        setJsonInput("")
        fetchNotes()
        setTimeout(() => setImportDialogOpen(false), 2000)
      }
    } catch (error) {
      setImportResult(`Error: ${error instanceof Error ? error.message : "Invalid JSON"}`)
    } finally {
      setImporting(false)
    }
  }

  const handleAddNote = async () => {
    try {
      const record = {
        ...newNote,
        attendees: newNote.attendees
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
        action_items: newNote.action_items
          .split("\n")
          .map((a) => a.trim())
          .filter(Boolean),
        meeting_date: newNote.meeting_date || null,
        follow_up_date: newNote.follow_up_date || null,
      }

      const res = await fetch("/api/meeting-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record),
      })

      const result = await res.json()

      if (!result.error) {
        setNewNote({
          client_name: "",
          meeting_date: "",
          meeting_type: "",
          attendees: "",
          agenda: "",
          notes: "",
          action_items: "",
          follow_up_date: "",
          status: "active",
          created_by: "",
        })
        setAddDialogOpen(false)
        fetchNotes()
      }
    } catch (error) {
      console.error("Error adding note:", error)
    }
  }

  const fetchFromAirtable = async () => {
    setFetchingAirtable(true)
    setAirtableData(null)
    try {
      const res = await fetch("/api/airtable/meeting-notes")
      const data = await res.json()
      if (data.error) {
        console.error("[v0] Airtable error:", data.error)
        setImportResult(`Error: ${data.error}`)
      } else {
        setAirtableData(data)
        console.log("[v0] Airtable data fetched:", data.totalRecords, "records")
        console.log("[v0] Field names:", data.fieldNames)
      }
    } catch (error) {
      console.error("[v0] Error fetching Airtable:", error)
      setImportResult(`Error: ${error instanceof Error ? error.message : "Failed to fetch"}`)
    } finally {
      setFetchingAirtable(false)
    }
  }

  const importToSupabase = async () => {
    if (!airtableData?.records) return

    setImportingToSupabase(true)
    setImportResult(null)

    try {
      const records = airtableData.records.map((record) => {
        const fields = record.fields

        return {
          airtable_id: record.id,
          client_name:
            fields["Client Name"] ||
            fields["client_name"] ||
            fields["Name"] ||
            fields["Client"] ||
            fields["Company"] ||
            "",
          meeting_date:
            fields["Meeting Date"] || fields["meeting_date"] || fields["Date"] || fields["Meeting date"] || null,
          meeting_type:
            fields["Meeting Type"] || fields["meeting_type"] || fields["Type"] || fields["Meeting type"] || "",
          attendees: Array.isArray(fields["Attendees"])
            ? fields["Attendees"]
            : typeof fields["Attendees"] === "string"
              ? [fields["Attendees"]]
              : Array.isArray(fields["attendees"])
                ? fields["attendees"]
                : [],
          agenda: fields["Agenda"] || fields["agenda"] || fields["Topics"] || "",
          notes:
            fields["Notes"] ||
            fields["notes"] ||
            fields["Meeting Notes"] ||
            fields["Summary"] ||
            fields["Debrief"] ||
            "",
          action_items: Array.isArray(fields["Action Items"])
            ? fields["Action Items"]
            : typeof fields["Action Items"] === "string"
              ? fields["Action Items"].split("\n").filter(Boolean)
              : Array.isArray(fields["action_items"])
                ? fields["action_items"]
                : [],
          follow_up_date:
            fields["Follow Up Date"] ||
            fields["follow_up_date"] ||
            fields["Follow-up Date"] ||
            fields["Follow Up"] ||
            null,
          status: fields["Status"] || fields["status"] || "active",
          karbon_client_key: fields["Karbon Client Key"] || fields["karbon_client_key"] || fields["Karbon Key"] || null,
          created_by: fields["Created By"] || fields["created_by"] || fields["Owner"] || fields["Author"] || "",
        }
      })

      console.log("[v0] Importing", records.length, "records to Supabase")
      console.log("[v0] Sample mapped record:", records[0])

      const res = await fetch("/api/meeting-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(records),
      })

      const result = await res.json()

      if (result.error) {
        setImportResult(`Error: ${result.error}`)
      } else {
        setImportResult(`Successfully imported ${result.count || records.length} records to Supabase!`)
        fetchNotes()
      }
    } catch (error) {
      console.error("[v0] Import error:", error)
      setImportResult(`Error: ${error instanceof Error ? error.message : "Import failed"}`)
    } finally {
      setImportingToSupabase(false)
    }
  }

  const filteredNotes = notes.filter(
    (note) =>
      note.client_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.agenda?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const meetingTypes = [...new Set(notes.map((n) => n.meeting_type).filter(Boolean))]
  const totalActionItems = notes.reduce((acc, n) => acc + (n.action_items?.length || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Meeting Notes & Debriefs</h1>
          <p className="text-sm text-muted-foreground">Manage client meeting notes imported from Airtable</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchNotes}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Dialog open={airtableDialogOpen} onOpenChange={setAirtableDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Cloud className="h-4 w-4 mr-1" />
                Fetch from Airtable
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Fetch from Airtable</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Button onClick={fetchFromAirtable} disabled={fetchingAirtable}>
                    {fetchingAirtable ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                        Fetching...
                      </>
                    ) : (
                      <>
                        <Cloud className="h-4 w-4 mr-1" />
                        Fetch Latest Data
                      </>
                    )}
                  </Button>
                  {airtableData && (
                    <Button onClick={importToSupabase} disabled={importingToSupabase} variant="default">
                      {importingToSupabase ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Database className="h-4 w-4 mr-1" />
                          Import to Supabase ({airtableData.totalRecords} records)
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {importResult && (
                  <p className={`text-sm ${importResult.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>
                    {importResult}
                  </p>
                )}

                {airtableData && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <Card className="p-3">
                        <p className="text-sm text-muted-foreground">Total Records</p>
                        <p className="text-2xl font-bold">{airtableData.totalRecords}</p>
                      </Card>
                      <Card className="p-3">
                        <p className="text-sm text-muted-foreground">Fields Detected</p>
                        <p className="text-2xl font-bold">{airtableData.fieldNames.length}</p>
                      </Card>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Detected Field Names</h4>
                      <div className="flex flex-wrap gap-1">
                        {airtableData.fieldNames.map((field) => (
                          <Badge key={field} variant="outline">
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {airtableData.sampleRecord && (
                      <div>
                        <h4 className="font-medium mb-2">Sample Record</h4>
                        <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-60">
                          {JSON.stringify(airtableData.sampleRecord.fields, null, 2)}
                        </pre>
                      </div>
                    )}

                    <div>
                      <h4 className="font-medium mb-2">Preview ({Math.min(5, airtableData.records.length)} records)</h4>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {airtableData.fieldNames.slice(0, 5).map((field) => (
                              <TableHead key={field} className="text-xs">
                                {field}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {airtableData.records.slice(0, 5).map((record) => (
                            <TableRow key={record.id}>
                              {airtableData.fieldNames.slice(0, 5).map((field) => (
                                <TableCell key={field} className="text-xs">
                                  {String(record.fields[field] || "-").substring(0, 50)}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4 mr-1" />
                Import JSON
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Import from JSON</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  <p className="mb-2">To export from Airtable:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Open your Airtable base</li>
                    <li>Click the three dots menu → Download CSV or use API</li>
                    <li>Or use the Airtable API to get JSON export</li>
                    <li>Paste the JSON data below</li>
                  </ol>
                </div>
                <Textarea
                  placeholder='Paste Airtable JSON export here... (format: {"records": [...]})'
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
                {importResult && (
                  <p className={`text-sm ${importResult.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>
                    {importResult}
                  </p>
                )}
                <Button onClick={handleImport} disabled={importing || !jsonInput.trim()}>
                  {importing ? "Importing..." : "Import Records"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Note
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add Meeting Note</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Client Name</Label>
                    <Input
                      value={newNote.client_name}
                      onChange={(e) => setNewNote({ ...newNote, client_name: e.target.value })}
                      placeholder="Client name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Meeting Date</Label>
                    <Input
                      type="date"
                      value={newNote.meeting_date}
                      onChange={(e) => setNewNote({ ...newNote, meeting_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Meeting Type</Label>
                    <Input
                      value={newNote.meeting_type}
                      onChange={(e) => setNewNote({ ...newNote, meeting_type: e.target.value })}
                      placeholder="e.g., Discovery, Planning, Review"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Created By</Label>
                    <Input
                      value={newNote.created_by}
                      onChange={(e) => setNewNote({ ...newNote, created_by: e.target.value })}
                      placeholder="Your name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Attendees (comma separated)</Label>
                  <Input
                    value={newNote.attendees}
                    onChange={(e) => setNewNote({ ...newNote, attendees: e.target.value })}
                    placeholder="John Doe, Jane Smith"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Agenda</Label>
                  <Textarea
                    value={newNote.agenda}
                    onChange={(e) => setNewNote({ ...newNote, agenda: e.target.value })}
                    placeholder="Meeting agenda..."
                    rows={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={newNote.notes}
                    onChange={(e) => setNewNote({ ...newNote, notes: e.target.value })}
                    placeholder="Meeting notes..."
                    rows={4}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Action Items (one per line)</Label>
                  <Textarea
                    value={newNote.action_items}
                    onChange={(e) => setNewNote({ ...newNote, action_items: e.target.value })}
                    placeholder="- Follow up on tax documents\n- Schedule next meeting"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Follow Up Date</Label>
                  <Input
                    type="date"
                    value={newNote.follow_up_date}
                    onChange={(e) => setNewNote({ ...newNote, follow_up_date: e.target.value })}
                  />
                </div>
                <Button onClick={handleAddNote}>Save Meeting Note</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-500" />
            <div>
              <p className="text-xs text-muted-foreground">Total Notes</p>
              <p className="text-xl font-bold">{notes.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-green-500" />
            <div>
              <p className="text-xs text-muted-foreground">Clients</p>
              <p className="text-xl font-bold">{new Set(notes.map((n) => n.client_name)).size}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">Meeting Types</p>
              <p className="text-xl font-bold">{meetingTypes.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">Action Items</p>
              <p className="text-xl font-bold">{totalActionItems}</p>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search notes by client, content, or agenda..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No meeting notes yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Import from Airtable or add a new note to get started
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Attendees</TableHead>
                  <TableHead>Action Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNotes.map((note) => (
                  <TableRow
                    key={note.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedNote(note)}
                  >
                    <TableCell className="font-medium">{note.client_name}</TableCell>
                    <TableCell>
                      {note.meeting_date ? format(new Date(note.meeting_date), "MMM d, yyyy") : "-"}
                    </TableCell>
                    <TableCell>{note.meeting_type && <Badge variant="outline">{note.meeting_type}</Badge>}</TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{note.attendees?.length || 0} attendees</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{note.action_items?.length || 0} items</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={note.status === "active" ? "default" : "secondary"}>{note.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedNote} onOpenChange={() => setSelectedNote(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedNote && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedNote.client_name}
                  {selectedNote.meeting_type && <Badge variant="outline">{selectedNote.meeting_type}</Badge>}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Meeting Date:</span>{" "}
                    {selectedNote.meeting_date ? format(new Date(selectedNote.meeting_date), "MMMM d, yyyy") : "-"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Follow Up:</span>{" "}
                    {selectedNote.follow_up_date ? format(new Date(selectedNote.follow_up_date), "MMMM d, yyyy") : "-"}
                  </div>
                </div>

                {selectedNote.attendees && selectedNote.attendees.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Attendees</h4>
                    <div className="flex flex-wrap gap-1">
                      {selectedNote.attendees.map((attendee, i) => (
                        <Badge key={i} variant="secondary">
                          {attendee}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {selectedNote.agenda && (
                  <div>
                    <h4 className="font-medium mb-2">Agenda</h4>
                    <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded">{selectedNote.agenda}</p>
                  </div>
                )}

                {selectedNote.notes && (
                  <div>
                    <h4 className="font-medium mb-2">Notes</h4>
                    <p className="text-sm whitespace-pre-wrap bg-muted p-3 rounded">{selectedNote.notes}</p>
                  </div>
                )}

                {selectedNote.action_items && selectedNote.action_items.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-2">Action Items</h4>
                    <ul className="space-y-1">
                      {selectedNote.action_items.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm">
                          <CheckSquare className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="text-xs text-muted-foreground pt-4 border-t">
                  {selectedNote.created_by && <span>Created by {selectedNote.created_by} • </span>}
                  {selectedNote.created_at && (
                    <span>{format(new Date(selectedNote.created_at), "MMM d, yyyy 'at' h:mm a")}</span>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
