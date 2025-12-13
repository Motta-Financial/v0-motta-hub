"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Calendar, Building2, User, Clock, CheckCircle2, AlertCircle, FileText } from "lucide-react"

type TaxStatus = "not-started" | "in-progress" | "review" | "complete" | "extension"

interface TaxClient {
  id: string
  name: string
  type: "business" | "individual"
  status: TaxStatus
  assignedTo: string
  deadline: string
  entityType?: string
  filingType?: string
  notes: string
  documents: {
    w2: boolean
    1099: boolean
    scheduleC: boolean
    scheduleE: boolean
    k1: boolean
    other: boolean
  }
  progress: number
}

const initialBusinessClients: TaxClient[] = [
  {
    id: "b1",
    name: "Elmira 1460 LLC",
    type: "business",
    status: "in-progress",
    assignedTo: "Andrew",
    deadline: "2025-03-15",
    entityType: "LLC",
    filingType: "1065",
    notes: "Partnership return, 3 partners",
    documents: { w2: false, 1099: true, scheduleC: false, scheduleE: true, k1: true, other: false },
    progress: 45,
  },
  {
    id: "b2",
    name: "Renegade Contracting Solutions",
    type: "business",
    status: "not-started",
    assignedTo: "Thameem",
    deadline: "2025-03-15",
    entityType: "S-Corp",
    filingType: "1120S",
    notes: "",
    documents: { w2: true, 1099: false, scheduleC: false, scheduleE: false, k1: false, other: false },
    progress: 0,
  },
  {
    id: "b3",
    name: "Halifax Nails and Spa",
    type: "business",
    status: "review",
    assignedTo: "Andrew",
    deadline: "2025-03-15",
    entityType: "LLC",
    filingType: "1065",
    notes: "Waiting on final K-1 from investment",
    documents: { w2: true, 1099: true, scheduleC: false, scheduleE: false, k1: true, other: true },
    progress: 85,
  },
  {
    id: "b4",
    name: "Matt Coleman Plumbing",
    type: "business",
    status: "complete",
    assignedTo: "Thameem",
    deadline: "2025-03-15",
    entityType: "Sole Prop",
    filingType: "Schedule C",
    notes: "Filed 2/15/2025",
    documents: { w2: false, 1099: true, scheduleC: true, scheduleE: false, k1: false, other: false },
    progress: 100,
  },
]

const initialIndividualClients: TaxClient[] = [
  {
    id: "i1",
    name: "Christopher Martin",
    type: "individual",
    status: "in-progress",
    assignedTo: "Andrew",
    deadline: "2025-04-15",
    filingType: "1040",
    notes: "Has rental property income",
    documents: { w2: true, 1099: true, scheduleC: false, scheduleE: true, k1: false, other: false },
    progress: 60,
  },
  {
    id: "i2",
    name: "Sarah Johnson",
    type: "individual",
    status: "not-started",
    assignedTo: "Thameem",
    deadline: "2025-04-15",
    filingType: "1040",
    notes: "",
    documents: { w2: true, 1099: false, scheduleC: false, scheduleE: false, k1: false, other: false },
    progress: 0,
  },
  {
    id: "i3",
    name: "Michael Chen",
    type: "individual",
    status: "extension",
    assignedTo: "Andrew",
    deadline: "2025-10-15",
    filingType: "1040",
    notes: "Extension filed, waiting on K-1s",
    documents: { w2: true, 1099: true, scheduleC: false, scheduleE: false, k1: false, other: false },
    progress: 25,
  },
  {
    id: "i4",
    name: "Emily Rodriguez",
    type: "individual",
    status: "complete",
    assignedTo: "Thameem",
    deadline: "2025-04-15",
    filingType: "1040",
    notes: "Filed 3/1/2025",
    documents: { w2: true, 1099: true, scheduleC: true, scheduleE: false, k1: false, other: false },
    progress: 100,
  },
  {
    id: "i5",
    name: "David Thompson",
    type: "individual",
    status: "review",
    assignedTo: "Andrew",
    deadline: "2025-04-15",
    filingType: "1040",
    notes: "Ready for final review",
    documents: { w2: true, 1099: false, scheduleC: false, scheduleE: false, k1: false, other: false },
    progress: 90,
  },
]

const statusConfig = {
  "not-started": { label: "Not Started", color: "bg-gray-100 text-gray-700", icon: Clock },
  "in-progress": { label: "In Progress", color: "bg-blue-100 text-blue-700", icon: FileText },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-700", icon: AlertCircle },
  complete: { label: "Complete", color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  extension: { label: "Extension", color: "bg-orange-100 text-orange-700", icon: Calendar },
}

export function TaxBusySeasonTracker() {
  const [businessClients, setBusinessClients] = useState<TaxClient[]>(initialBusinessClients)
  const [individualClients, setIndividualClients] = useState<TaxClient[]>(initialIndividualClients)
  const [selectedClient, setSelectedClient] = useState<TaxClient | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleClientClick = (client: TaxClient) => {
    setSelectedClient(client)
    setIsDialogOpen(true)
  }

  const handleUpdateClient = (updatedClient: TaxClient) => {
    if (updatedClient.type === "business") {
      setBusinessClients(businessClients.map((c) => (c.id === updatedClient.id ? updatedClient : c)))
    } else {
      setIndividualClients(individualClients.map((c) => (c.id === updatedClient.id ? updatedClient : c)))
    }
    setSelectedClient(updatedClient)
  }

  const calculateStats = (clients: TaxClient[]) => {
    const total = clients.length
    const complete = clients.filter((c) => c.status === "complete").length
    const inProgress = clients.filter((c) => c.status === "in-progress").length
    const notStarted = clients.filter((c) => c.status === "not-started").length
    const review = clients.filter((c) => c.status === "review").length
    return { total, complete, inProgress, notStarted, review }
  }

  const businessStats = calculateStats(businessClients)
  const individualStats = calculateStats(individualClients)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Tax Busy Season Tracker</h1>
        <p className="text-gray-600 mt-2">Track tax return preparation progress for the 2024 tax year</p>
      </div>

      <Tabs defaultValue="business" className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="business" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Business Returns
          </TabsTrigger>
          <TabsTrigger value="individual" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Individual Returns
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Total Returns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{businessStats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Complete</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{businessStats.complete}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">In Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{businessStats.inProgress}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Not Started</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-600">{businessStats.notStarted}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Business Tax Returns</CardTitle>
              <CardDescription>Click on any client to view and edit details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {businessClients.map((client) => {
                  const StatusIcon = statusConfig[client.status].icon
                  return (
                    <div
                      key={client.id}
                      onClick={() => handleClientClick(client)}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <Building2 className="h-5 w-5 text-gray-400" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{client.name}</div>
                          <div className="text-sm text-gray-500">
                            {client.entityType} • {client.filingType} • Due:{" "}
                            {new Date(client.deadline).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm text-gray-600">Assigned to {client.assignedTo}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={client.progress} className="w-24 h-2" />
                            <span className="text-xs text-gray-500">{client.progress}%</span>
                          </div>
                        </div>
                        <Badge className={statusConfig[client.status].color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig[client.status].label}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="individual" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Total Returns</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{individualStats.total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Complete</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600">{individualStats.complete}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">In Progress</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600">{individualStats.inProgress}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-gray-600">Not Started</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-gray-600">{individualStats.notStarted}</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Individual Tax Returns</CardTitle>
              <CardDescription>Click on any client to view and edit details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {individualClients.map((client) => {
                  const StatusIcon = statusConfig[client.status].icon
                  return (
                    <div
                      key={client.id}
                      onClick={() => handleClientClick(client)}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <User className="h-5 w-5 text-gray-400" />
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{client.name}</div>
                          <div className="text-sm text-gray-500">
                            {client.filingType} • Due: {new Date(client.deadline).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-sm text-gray-600">Assigned to {client.assignedTo}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <Progress value={client.progress} className="w-24 h-2" />
                            <span className="text-xs text-gray-500">{client.progress}%</span>
                          </div>
                        </div>
                        <Badge className={statusConfig[client.status].color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {statusConfig[client.status].label}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedClient && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selectedClient.type === "business" ? (
                    <Building2 className="h-5 w-5" />
                  ) : (
                    <User className="h-5 w-5" />
                  )}
                  {selectedClient.name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={selectedClient.status}
                      onValueChange={(value: TaxStatus) => handleUpdateClient({ ...selectedClient, status: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="not-started">Not Started</SelectItem>
                        <SelectItem value="in-progress">In Progress</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                        <SelectItem value="complete">Complete</SelectItem>
                        <SelectItem value="extension">Extension</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Assigned To</Label>
                    <Select
                      value={selectedClient.assignedTo}
                      onValueChange={(value) => handleUpdateClient({ ...selectedClient, assignedTo: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Andrew">Andrew</SelectItem>
                        <SelectItem value="Thameem">Thameem</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Filing Type</Label>
                    <Input value={selectedClient.filingType} readOnly />
                  </div>

                  <div className="space-y-2">
                    <Label>Deadline</Label>
                    <Input
                      type="date"
                      value={selectedClient.deadline}
                      onChange={(e) => handleUpdateClient({ ...selectedClient, deadline: e.target.value })}
                    />
                  </div>

                  {selectedClient.type === "business" && (
                    <div className="space-y-2">
                      <Label>Entity Type</Label>
                      <Input value={selectedClient.entityType} readOnly />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Progress</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={selectedClient.progress}
                        onChange={(e) => handleUpdateClient({ ...selectedClient, progress: Number(e.target.value) })}
                        className="w-20"
                      />
                      <Progress value={selectedClient.progress} className="flex-1" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Documents Received</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.entries(selectedClient.documents).map(([doc, received]) => (
                      <label key={doc} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={received}
                          onChange={(e) =>
                            handleUpdateClient({
                              ...selectedClient,
                              documents: { ...selectedClient.documents, [doc]: e.target.checked },
                            })
                          }
                          className="rounded"
                        />
                        <span className="text-sm capitalize">{doc.replace(/([A-Z])/g, " $1").trim()}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea
                    value={selectedClient.notes}
                    onChange={(e) => handleUpdateClient({ ...selectedClient, notes: e.target.value })}
                    rows={4}
                    placeholder="Add notes about this tax return..."
                  />
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => setIsDialogOpen(false)}>Close</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
