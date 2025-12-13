"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Calendar, CheckCircle2, Clock, AlertCircle, Info, X } from "lucide-react"

type ClientStatus = "pending" | "need-info" | "on-hold" | "review-integration"

type BookkeepingTask = {
  id: string
  label: string
  completed: boolean
}

type Client = {
  id: string
  name: string
  lead: string
  clientType: "MONTHLY" | "QUARTERLY"
  hasMeeting: boolean
  status: ClientStatus
  tasks: BookkeepingTask[]
  notes: string
  lastUpdated: string
}

const CHECKLIST_ITEMS = [
  { id: "A", label: "Review work item for the month or quarter - P24" },
  { id: "B", label: "Enter in and categorize all transactions for the month - P24" },
  { id: "C", label: "If you're not 100% on certain transactions, please code them to uncategorized expense - P24" },
  { id: "D", label: "Gather all statements (download from 1password or request from client) - P24" },
  { id: "E", label: "Reconcile all accounts - P24" },
  { id: "F", label: "Review monthly and quarterly accounting - Andrew" },
  { id: "G", label: "If transactions need to be reclassified, send the excel spreadsheet request to client - Andrew" },
  { id: "H", label: "Reclassify uncategorize transactions - Andrew" },
  { id: "I", label: "Send Monthly and Quarterly Reports - Andrew" },
  { id: "J", label: "Monthly or Quarterly Meeting Completed (if applicable) - Andrew" },
]

const INITIAL_CLIENTS: Client[] = [
  {
    id: "1",
    name: "Elmira 1460 LLC",
    lead: "Thameem",
    clientType: "QUARTERLY",
    hasMeeting: false,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "2",
    name: "Halifax Nails and Spa",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "3",
    name: "Matt Coleman Plumbing",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: false,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "4",
    name: "Renegade Contracting Solutions",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "5",
    name: "E 27th Ave/Christopher Martin",
    lead: "Thameem",
    clientType: "QUARTERLY",
    hasMeeting: false,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "6",
    name: "Harlow Contracting",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "7",
    name: "TLL Medical Transport",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "8",
    name: "411 Claims Restoration",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
  {
    id: "9",
    name: "Ola Loa Swim Academy",
    lead: "Thameem",
    clientType: "MONTHLY",
    hasMeeting: true,
    status: "pending",
    tasks: CHECKLIST_ITEMS.map((item) => ({ ...item, completed: false })),
    notes: "",
    lastUpdated: "2025-10-31",
  },
]

const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    color: "bg-red-500",
    textColor: "text-red-700",
    bgColor: "bg-red-50",
    icon: Clock,
  },
  "need-info": {
    label: "Need info from Client",
    color: "bg-yellow-500",
    textColor: "text-yellow-700",
    bgColor: "bg-yellow-50",
    icon: AlertCircle,
  },
  "on-hold": {
    label: "Clients on Hold",
    color: "bg-orange-500",
    textColor: "text-orange-700",
    bgColor: "bg-orange-50",
    icon: Info,
  },
  "review-integration": {
    label: "Need to review integration",
    color: "bg-blue-500",
    textColor: "text-blue-700",
    bgColor: "bg-blue-50",
    icon: CheckCircle2,
  },
}

export function BookkeepingTracker() {
  const [clients, setClients] = useState<Client[]>(INITIAL_CLIENTS)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const handleClientClick = (client: Client) => {
    setSelectedClient(client)
    setIsDialogOpen(true)
  }

  const handleUpdateClient = (updatedClient: Client) => {
    setClients(clients.map((c) => (c.id === updatedClient.id ? updatedClient : c)))
    setSelectedClient(updatedClient)
  }

  const handleCloseDialog = () => {
    setIsDialogOpen(false)
    setTimeout(() => setSelectedClient(null), 200)
  }

  const getCompletionPercentage = (client: Client) => {
    const completed = client.tasks.filter((t) => t.completed).length
    return Math.round((completed / client.tasks.length) * 100)
  }

  return (
    <div className="space-y-6">
      <Card className="bg-white shadow-sm border-gray-200">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-gray-900">Monthly Bookkeeping Checklist</CardTitle>
              <CardDescription className="mt-1">
                As of 10/31/2025 - Click on any client to view and edit details
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">October 2025</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-6">
            {Object.entries(STATUS_CONFIG).map(([key, config]) => {
              const Icon = config.icon
              return (
                <div key={key} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded ${config.color}`} />
                  <span className="text-sm text-gray-700">{config.label}</span>
                </div>
              )
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Client</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Lead</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Type</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-700">Meeting</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Progress</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const statusConfig = STATUS_CONFIG[client.status]
                  const completion = getCompletionPercentage(client)

                  return (
                    <tr
                      key={client.id}
                      onClick={() => handleClientClick(client)}
                      className="border-b border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <span className="text-sm font-medium text-gray-900">{client.name}</span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-gray-600">{client.lead}</span>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="outline" className="text-xs">
                          {client.clientType}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {client.hasMeeting && <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[120px]">
                            <div
                              className="bg-green-600 h-2 rounded-full transition-all"
                              style={{ width: `${completion}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600 min-w-[35px]">{completion}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge className={`${statusConfig.bgColor} ${statusConfig.textColor} border-0`}>
                          {statusConfig.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedClient && (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-start justify-between">
                <div>
                  <DialogTitle className="text-2xl font-bold text-gray-900">{selectedClient.name}</DialogTitle>
                  <DialogDescription className="mt-1">
                    Update bookkeeping progress and client information
                  </DialogDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={handleCloseDialog} className="h-8 w-8">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>

            <div className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="lead">Lead</Label>
                  <Input
                    id="lead"
                    value={selectedClient.lead}
                    onChange={(e) => handleUpdateClient({ ...selectedClient, lead: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clientType">Client Type</Label>
                  <Select
                    value={selectedClient.clientType}
                    onValueChange={(value: "MONTHLY" | "QUARTERLY") =>
                      handleUpdateClient({ ...selectedClient, clientType: value })
                    }
                  >
                    <SelectTrigger id="clientType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MONTHLY">Monthly</SelectItem>
                      <SelectItem value="QUARTERLY">Quarterly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="status">Status</Label>
                  <Select
                    value={selectedClient.status}
                    onValueChange={(value: ClientStatus) => handleUpdateClient({ ...selectedClient, status: value })}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                        <SelectItem key={key} value={key}>
                          {config.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 flex items-end">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="hasMeeting"
                      checked={selectedClient.hasMeeting}
                      onCheckedChange={(checked) =>
                        handleUpdateClient({
                          ...selectedClient,
                          hasMeeting: checked as boolean,
                        })
                      }
                    />
                    <Label htmlFor="hasMeeting" className="cursor-pointer">
                      Meeting Scheduled
                    </Label>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Add any notes or comments about this client..."
                  value={selectedClient.notes}
                  onChange={(e) => handleUpdateClient({ ...selectedClient, notes: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Bookkeeping Checklist</h3>
                <div className="space-y-3">
                  {selectedClient.tasks.map((task, index) => (
                    <div
                      key={task.id}
                      className="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Checkbox
                        id={`task-${task.id}`}
                        checked={task.completed}
                        onCheckedChange={(checked) => {
                          const updatedTasks = [...selectedClient.tasks]
                          updatedTasks[index] = { ...task, completed: checked as boolean }
                          handleUpdateClient({
                            ...selectedClient,
                            tasks: updatedTasks,
                          })
                        }}
                      />
                      <Label
                        htmlFor={`task-${task.id}`}
                        className={`flex-1 cursor-pointer text-sm leading-relaxed ${
                          task.completed ? "line-through text-gray-500" : "text-gray-700"
                        }`}
                      >
                        <span className="font-semibold">{task.id}.</span> {task.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <span className="text-sm text-gray-500">
                  Last updated: {new Date(selectedClient.lastUpdated).toLocaleDateString()}
                </span>
                <Button onClick={handleCloseDialog}>Done</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
