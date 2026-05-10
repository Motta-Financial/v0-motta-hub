"use client"

import { useState } from "react"
import useSWR from "swr"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ClientPicker, type ClientPickerValue } from "@/components/clients/client-picker"
import { AlertCircle, Building2, Calendar, CheckCircle, FileText, Link2, Loader2, Plus, User, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface UnlinkedRecord {
  id: string
  type: "ignition_client" | "ignition_proposal" | "calendly_invitee" | "debrief"
  name: string
  email?: string | null
  businessName?: string | null
  status?: string | null
  createdAt?: string | null
  extra?: Record<string, unknown>
}

interface UnlinkedStats {
  ignition_clients: number
  ignition_proposals: number
  calendly_invitees: number
  debriefs: number
}

function RecordCard({
  record,
  onLink,
  onCreateAndLink,
  isLinking,
}: {
  record: UnlinkedRecord
  onLink: (record: UnlinkedRecord, client: ClientPickerValue) => void
  onCreateAndLink?: (record: UnlinkedRecord) => void
  isLinking: boolean
}) {
  const [selectedClient, setSelectedClient] = useState<ClientPickerValue | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const handleLink = () => {
    if (selectedClient) {
      onLink(record, selectedClient)
      setShowPicker(false)
      setSelectedClient(null)
    }
  }

  const Icon = record.type === "ignition_client" || record.type === "ignition_proposal" 
    ? FileText 
    : record.type === "calendly_invitee" 
    ? Calendar 
    : Users

  return (
    <Card className="relative">
      <CardContent className="pt-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium truncate">{record.name}</span>
              {record.status && (
                <Badge variant="outline" className="text-xs shrink-0">
                  {record.status}
                </Badge>
              )}
            </div>
            {record.email && (
              <p className="text-sm text-muted-foreground truncate">{record.email}</p>
            )}
            {record.businessName && (
              <p className="text-sm text-muted-foreground truncate">
                <Building2 className="inline h-3 w-3 mr-1" />
                {record.businessName}
              </p>
            )}
            {record.createdAt && (
              <p className="text-xs text-muted-foreground">
                {new Date(record.createdAt).toLocaleDateString()}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2 shrink-0">
            {!showPicker ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowPicker(true)}
                  disabled={isLinking}
                >
                  <Link2 className="h-4 w-4 mr-1" />
                  Link
                </Button>
                {onCreateAndLink && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onCreateAndLink(record)}
                    disabled={isLinking}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Create New
                  </Button>
                )}
              </>
            ) : (
              <div className="flex flex-col gap-2 w-64">
                <ClientPicker
                  value={selectedClient}
                  onChange={setSelectedClient}
                  placeholder="Search clients..."
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleLink}
                    disabled={!selectedClient || isLinking}
                  >
                    {isLinking ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle className="h-4 w-4 mr-1" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowPicker(false)
                      setSelectedClient(null)
                    }}
                    disabled={isLinking}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function CreateClientDialog({
  open,
  onOpenChange,
  record,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: UnlinkedRecord | null
  onCreated: (recordId: string, clientId: string, clientKind: "contact" | "organization") => void
}) {
  const [clientType, setClientType] = useState<"contact" | "organization">("contact")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [orgName, setOrgName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [createInKarbon, setCreateInKarbon] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-populate from record
  useState(() => {
    if (record) {
      const nameParts = (record.name || "").split(" ")
      setFirstName(nameParts[0] || "")
      setLastName(nameParts.slice(1).join(" ") || "")
      setEmail(record.email || "")
      setOrgName(record.businessName || "")
      if (record.businessName) {
        setClientType("organization")
      }
    }
  })

  const handleCreate = async () => {
    if (!record) return
    setIsCreating(true)
    setError(null)

    try {
      const body = {
        type: clientType,
        firstName: clientType === "contact" ? firstName : undefined,
        lastName: clientType === "contact" ? lastName : undefined,
        name: clientType === "organization" ? orgName : undefined,
        email,
        phone,
        createInKarbon,
        linkToRecord: {
          type: record.type,
          id: record.id,
        },
      }

      const res = await fetch("/api/clients/create-and-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to create client")
      }

      const data = await res.json()
      onCreated(record.id, data.client.id, clientType)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Client</DialogTitle>
          <DialogDescription>
            Create a new contact or organization and link it to this record.
            {createInKarbon && " The client will also be created in Karbon."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Client Type</Label>
            <Select value={clientType} onValueChange={(v) => setClientType(v as "contact" | "organization")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contact">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Individual Contact
                  </div>
                </SelectItem>
                <SelectItem value="organization">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Organization
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {clientType === "contact" ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input
                id="orgName"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone (optional)</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="createInKarbon"
              checked={createInKarbon}
              onChange={(e) => setCreateInKarbon(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <Label htmlFor="createInKarbon" className="text-sm font-normal">
              Also create in Karbon
            </Label>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating}>
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create & Link
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordList({
  type,
  records,
  isLoading,
  onLink,
  onCreateAndLink,
  linkingId,
}: {
  type: string
  records: UnlinkedRecord[]
  isLoading: boolean
  onLink: (record: UnlinkedRecord, client: ClientPickerValue) => void
  onCreateAndLink?: (record: UnlinkedRecord) => void
  linkingId: string | null
}) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
          <p className="text-lg font-medium">All records linked!</p>
          <p className="text-sm text-muted-foreground">
            No unlinked {type} records found.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {records.map((record) => (
        <RecordCard
          key={record.id}
          record={record}
          onLink={onLink}
          onCreateAndLink={onCreateAndLink}
          isLinking={linkingId === record.id}
        />
      ))}
    </div>
  )
}

export function UnlinkedRecordsClient() {
  const [activeTab, setActiveTab] = useState("ignition_clients")
  const [linkingId, setLinkingId] = useState<string | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createDialogRecord, setCreateDialogRecord] = useState<UnlinkedRecord | null>(null)

  // Fetch stats
  const { data: stats, mutate: mutateStats } = useSWR<UnlinkedStats>(
    "/api/admin/unlinked-records/stats",
    fetcher
  )

  // Fetch records for active tab
  const { data: recordsData, isLoading, mutate: mutateRecords } = useSWR<{ records: UnlinkedRecord[] }>(
    `/api/admin/unlinked-records?type=${activeTab}`,
    fetcher
  )

  const handleLink = async (record: UnlinkedRecord, client: ClientPickerValue) => {
    setLinkingId(record.id)
    try {
      const res = await fetch("/api/admin/unlinked-records/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordType: record.type,
          recordId: record.id,
          clientId: client.id,
          clientKind: client.kind,
        }),
      })

      if (!res.ok) {
        throw new Error("Failed to link record")
      }

      // Refresh data
      mutateRecords()
      mutateStats()
    } catch (err) {
      console.error("Link error:", err)
    } finally {
      setLinkingId(null)
    }
  }

  const handleCreateAndLink = (record: UnlinkedRecord) => {
    setCreateDialogRecord(record)
    setCreateDialogOpen(true)
  }

  const handleCreated = () => {
    mutateRecords()
    mutateStats()
  }

  const records = recordsData?.records || []

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="ignition_clients" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Ignition Clients</span>
            <span className="sm:hidden">Ignition</span>
            {stats && stats.ignition_clients > 0 && (
              <Badge variant="secondary" className="ml-1">
                {stats.ignition_clients}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ignition_proposals" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Proposals</span>
            {stats && stats.ignition_proposals > 0 && (
              <Badge variant="secondary" className="ml-1">
                {stats.ignition_proposals}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="calendly_invitees" className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Calendly</span>
            {stats && stats.calendly_invitees > 0 && (
              <Badge variant="secondary" className="ml-1">
                {stats.calendly_invitees}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="debriefs" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Debriefs</span>
            {stats && stats.debriefs > 0 && (
              <Badge variant="secondary" className="ml-1">
                {stats.debriefs}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ignition_clients" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Unlinked Ignition Clients</CardTitle>
              <CardDescription>
                These Ignition clients could not be automatically matched to contacts or organizations.
                Link them manually or create new clients.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecordList
                type="Ignition client"
                records={records}
                isLoading={isLoading}
                onLink={handleLink}
                onCreateAndLink={handleCreateAndLink}
                linkingId={linkingId}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ignition_proposals" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Unlinked Ignition Proposals</CardTitle>
              <CardDescription>
                These proposals are not linked to any contact or organization.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecordList
                type="Ignition proposal"
                records={records}
                isLoading={isLoading}
                onLink={handleLink}
                onCreateAndLink={handleCreateAndLink}
                linkingId={linkingId}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendly_invitees" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Unlinked Calendly Invitees</CardTitle>
              <CardDescription>
                These meeting invitees could not be matched to existing contacts.
                Link them to existing clients or create new contacts.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecordList
                type="Calendly invitee"
                records={records}
                isLoading={isLoading}
                onLink={handleLink}
                onCreateAndLink={handleCreateAndLink}
                linkingId={linkingId}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="debriefs" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Unlinked Debriefs</CardTitle>
              <CardDescription>
                These debriefs are not linked to any contact or organization.
                Link them to improve reporting and client history.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RecordList
                type="debrief"
                records={records}
                isLoading={isLoading}
                onLink={handleLink}
                linkingId={linkingId}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CreateClientDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        record={createDialogRecord}
        onCreated={handleCreated}
      />
    </>
  )
}
