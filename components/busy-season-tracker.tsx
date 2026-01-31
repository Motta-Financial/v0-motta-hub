"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Calendar, FileText, AlertCircle, CheckCircle2, Clock, Plus, Building2, User, Flag } from "lucide-react"

type PrimaryStatus =
  | "Prospect"
  | "Proposal Sent"
  | "Proposal Signed"
  | "Documents Received"
  | "Ready for Prep"
  | "Waiting for Client"
  | "Actively Preparing"
  | "In Review"
  | "Finalizing"
  | "Sent to Client"
  | "E-filed/Manually Filed"

type DocumentStatus = "Need to organize" | "Organized"

interface AssignmentNote {
  assignedTo: string
  assignedBy: string
  status: PrimaryStatus
  note: string
  timestamp: string
}

interface TaxReturn {
  id: string
  clientName: string
  entityType: string
  taxYear: number
  primaryStatus: PrimaryStatus
  documentStatus?: DocumentStatus
  discoveryDocSent?: boolean
  preparer: string
  reviewer?: string
  assignedTo?: string
  inQueue?: boolean
  assignmentNotes: AssignmentNote[]
  dueDate: string
  progress: number
  documentsReceived: boolean
  notes: string
  isPriority?: boolean
}

const initialBusinessReturns: TaxReturn[] = [
  {
    id: "1",
    clientName: "Elmira 1460 LLC",
    entityType: "1065 - Partnership",
    taxYear: 2024,
    primaryStatus: "Actively Preparing",
    preparer: "Andrew",
    reviewer: "Thameem",
    assignedTo: "Sophia Echevarria",
    assignmentNotes: [],
    dueDate: "2025-03-15",
    progress: 45,
    documentsReceived: true,
    notes: "Waiting on K-1s from investments",
  },
  {
    id: "2",
    clientName: "Renegade Contracting Solutions",
    entityType: "1120-S - S-Corp",
    taxYear: 2024,
    primaryStatus: "In Review",
    preparer: "Sarah",
    reviewer: "Thameem",
    assignedTo: "Thameem",
    assignmentNotes: [],
    dueDate: "2025-03-15",
    progress: 85,
    documentsReceived: true,
    notes: "Ready for final review",
  },
  {
    id: "3",
    clientName: "Halifax Nails and Spa",
    entityType: "1120 - C-Corp",
    taxYear: 2024,
    primaryStatus: "Ready for Prep",
    documentStatus: "Organized",
    preparer: "Andrew",
    assignedTo: "Andrew",
    assignmentNotes: [],
    dueDate: "2025-04-15",
    progress: 15,
    documentsReceived: true,
    notes: "Documents organized and ready to start",
    isPriority: true,
  },
  {
    id: "7",
    clientName: "Sunset Consulting Group",
    entityType: "1065 - Partnership",
    taxYear: 2024,
    primaryStatus: "Ready for Prep",
    documentStatus: "Organized",
    preparer: "Unassigned",
    inQueue: true,
    assignmentNotes: [],
    dueDate: "2025-03-15",
    progress: 5,
    documentsReceived: true,
    notes: "All documents received and organized, ready for assignment",
    isPriority: true,
  },
  {
    id: "8",
    clientName: "Mountain View Properties LLC",
    entityType: "1065 - Partnership",
    taxYear: 2024,
    primaryStatus: "Documents Received",
    documentStatus: "Need to organize",
    preparer: "Unassigned",
    inQueue: true,
    assignmentNotes: [],
    dueDate: "2025-03-15",
    progress: 0,
    documentsReceived: true,
    notes: "Documents need to be organized before prep can begin",
  },
]

const initialIndividualReturns: TaxReturn[] = [
  {
    id: "4",
    clientName: "Christopher Martin",
    entityType: "1040 - Individual",
    taxYear: 2024,
    primaryStatus: "E-filed/Manually Filed",
    preparer: "Sarah",
    reviewer: "Thameem",
    assignmentNotes: [],
    dueDate: "2025-04-15",
    progress: 100,
    documentsReceived: true,
    notes: "E-filed and accepted",
  },
  {
    id: "5",
    clientName: "Matt Coleman",
    entityType: "1040 - Individual",
    taxYear: 2024,
    primaryStatus: "Actively Preparing",
    preparer: "Andrew",
    assignedTo: "Andrew",
    assignmentNotes: [],
    dueDate: "2025-04-15",
    progress: 60,
    documentsReceived: true,
    notes: "Waiting on brokerage statements",
  },
  {
    id: "6",
    clientName: "John Harlow",
    entityType: "1040 - Individual",
    taxYear: 2024,
    primaryStatus: "Waiting for Client",
    preparer: "Sarah",
    assignedTo: "Sarah",
    assignmentNotes: [],
    dueDate: "2025-10-15",
    progress: 10,
    documentsReceived: false,
    notes: "Waiting for client to send documents",
  },
]

export function BusySeasonTracker() {
  const [businessReturns, setBusinessReturns] = useState<TaxReturn[]>(initialBusinessReturns)
  const [individualReturns, setIndividualReturns] = useState<TaxReturn[]>(initialIndividualReturns)
  const [selectedReturn, setSelectedReturn] = useState<TaxReturn | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"business" | "individual" | "queue">("business")
  const [businessEntityFilter, setBusinessEntityFilter] = useState<"all" | "partnership" | "s-corp" | "c-corp">("all")
  const [statusFilter, setStatusFilter] = useState<PrimaryStatus | "all">("all")

  const [assignmentForm, setAssignmentForm] = useState({
    assignTo: "",
    status: "" as PrimaryStatus | "",
    note: "",
    isPriority: false,
  })

  const getStatusColor = (status: PrimaryStatus) => {
    switch (status) {
      case "Prospect":
      case "Proposal Sent":
        return "bg-gray-100 text-gray-700 border-gray-300"
      case "Proposal Signed":
      case "Documents Received":
        return "bg-blue-100 text-blue-700 border-blue-300"
      case "Ready for Prep":
        return "bg-cyan-100 text-cyan-700 border-cyan-300"
      case "Waiting for Client":
        return "bg-amber-100 text-amber-700 border-amber-300"
      case "Actively Preparing":
        return "bg-yellow-100 text-yellow-700 border-yellow-300"
      case "In Review":
      case "Finalizing":
        return "bg-orange-100 text-orange-700 border-orange-300"
      case "Sent to Client":
        return "bg-purple-100 text-purple-700 border-purple-300"
      case "E-filed/Manually Filed":
        return "bg-green-100 text-green-700 border-green-300"
    }
  }

  const getStatusIcon = (status: PrimaryStatus) => {
    switch (status) {
      case "Prospect":
      case "Proposal Sent":
        return <AlertCircle className="h-4 w-4" />
      case "Proposal Signed":
      case "Documents Received":
        return <FileText className="h-4 w-4" />
      case "Actively Preparing":
        return <Clock className="h-4 w-4" />
      case "In Review":
      case "Finalizing":
        return <FileText className="h-4 w-4" />
      case "Sent to Client":
        return <Calendar className="h-4 w-4" />
      case "E-filed/Manually Filed":
        return <CheckCircle2 className="h-4 w-4" />
      case "Ready for Prep":
        return <FileText className="h-4 w-4" />
      case "Waiting for Client":
        return <Clock className="h-4 w-4" />
    }
  }

  const calculateStats = (returns: TaxReturn[]) => {
    return {
      total: returns.length,
      prospect: returns.filter((r) => r.primaryStatus === "Prospect" || r.primaryStatus === "Proposal Sent").length,
      preparing: returns.filter((r) => r.primaryStatus === "Actively Preparing").length,
      review: returns.filter((r) => r.primaryStatus === "In Review").length,
      complete: returns.filter((r) => r.primaryStatus === "E-filed/Manually Filed").length,
      avgProgress: Math.round(returns.reduce((sum, r) => sum + r.progress, 0) / returns.length || 0),
    }
  }

  const getFilteredBusinessReturns = () => {
    let filtered = businessReturns

    if (businessEntityFilter !== "all") {
      const filterMap = {
        partnership: "1065 - Partnership",
        "s-corp": "1120-S - S-Corp",
        "c-corp": "1120 - C-Corp",
      }
      filtered = filtered.filter((r) => r.entityType === filterMap[businessEntityFilter])
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.primaryStatus === statusFilter)
    }

    return filtered
  }

  const getFilteredIndividualReturns = () => {
    if (statusFilter === "all") return individualReturns
    return individualReturns.filter((r) => r.primaryStatus === statusFilter)
  }

  const allReturns = [...businessReturns, ...individualReturns]

  const getFilteredQueueReturns = () => {
    const queueReturns = allReturns.filter((r) => r.inQueue)
    if (statusFilter === "all") return queueReturns
    return queueReturns.filter((r) => r.primaryStatus === statusFilter)
  }

  const filteredBusinessReturns = getFilteredBusinessReturns()
  const filteredIndividualReturns = getFilteredIndividualReturns()
  const filteredQueueReturns = getFilteredQueueReturns()
  const businessStats = calculateStats(filteredBusinessReturns)
  const individualStats = calculateStats(individualReturns)

  const queueReturns = allReturns.filter((r) => r.inQueue)
  const queueStats = calculateStats(queueReturns)

  const getReturnsByStatus = (status: PrimaryStatus) => {
    return allReturns.filter((r) => r.primaryStatus === status)
  }

  const summaryStatuses: PrimaryStatus[] = [
    "Ready for Prep",
    "Waiting for Client",
    "Actively Preparing",
    "In Review",
    "Finalizing",
  ]

  const completedReturns = getReturnsByStatus("E-filed/Manually Filed")

  const handleRowClick = (taxReturn: TaxReturn) => {
    setSelectedReturn(taxReturn)
    setAssignmentForm({
      assignTo: taxReturn.assignedTo || "",
      status: taxReturn.primaryStatus,
      note: "",
      isPriority: taxReturn.isPriority || false,
    })
    setIsDetailOpen(true)
  }

  const handleUpdateReturn = (updatedReturn: TaxReturn) => {
    if (updatedReturn.entityType !== "1040 - Individual") {
      setBusinessReturns(businessReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    } else {
      setIndividualReturns(individualReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    }
    setIsDetailOpen(false)
  }

  const handleAssignment = () => {
    if (!selectedReturn || !assignmentForm.assignTo || !assignmentForm.status) return

    const isQueueAssignment = assignmentForm.assignTo === "Tax Prep Queue"

    const newAssignmentNote: AssignmentNote = {
      assignedTo: assignmentForm.assignTo,
      assignedBy: "Current User",
      status: assignmentForm.status,
      note: assignmentForm.note,
      timestamp: new Date().toISOString(),
    }

    const updatedReturn = {
      ...selectedReturn,
      assignedTo: isQueueAssignment ? undefined : assignmentForm.assignTo,
      inQueue: isQueueAssignment,
      primaryStatus: assignmentForm.status,
      assignmentNotes: [newAssignmentNote, ...selectedReturn.assignmentNotes],
      isPriority: assignmentForm.isPriority,
    }

    setSelectedReturn(updatedReturn)

    if (updatedReturn.entityType === "1040 - Individual") {
      setIndividualReturns(individualReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    } else {
      setBusinessReturns(businessReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    }

    setAssignmentForm({
      assignTo: "",
      status: assignmentForm.status,
      note: "",
      isPriority: assignmentForm.isPriority,
    })
  }

  const handleClaimReturn = () => {
    if (!selectedReturn) return

    const currentUser = "Current User"

    const claimNote: AssignmentNote = {
      assignedTo: currentUser,
      assignedBy: currentUser,
      status: selectedReturn.primaryStatus,
      note: "Claimed from Tax Prep Queue",
      timestamp: new Date().toISOString(),
    }

    const updatedReturn = {
      ...selectedReturn,
      assignedTo: currentUser,
      inQueue: false,
      assignmentNotes: [claimNote, ...selectedReturn.assignmentNotes],
    }

    setSelectedReturn(updatedReturn)

    if (updatedReturn.entityType === "1040 - Individual") {
      setIndividualReturns(individualReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    } else {
      setBusinessReturns(businessReturns.map((r) => (r.id === updatedReturn.id ? updatedReturn : r)))
    }
  }

  const handleStatusFilterClick = (status: PrimaryStatus | "all") => {
    setStatusFilter(status)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Busy Season Tracker</h1>
          <p className="text-muted-foreground">Track tax return preparation progress during busy season</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Tax Return
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add New Tax Return</DialogTitle>
              <DialogDescription>Create a new tax return to track during busy season</DialogDescription>
            </DialogHeader>
            {/* ... existing add form code ... */}
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-muted-foreground">STATUS OVERVIEW</h2>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Badge
            variant="outline"
            className={`px-3 py-1.5 text-sm font-medium cursor-pointer hover:shadow-sm transition-all ${
              statusFilter === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background hover:bg-muted"
            }`}
            onClick={() => handleStatusFilterClick("all")}
          >
            All ({allReturns.length})
          </Badge>
          {summaryStatuses.map((status) => {
            const returns = getReturnsByStatus(status)
            if (returns.length === 0) return null

            return (
              <Badge
                key={status}
                variant="outline"
                className={`${getStatusColor(status)} px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${
                  statusFilter === status ? "shadow-md ring-2 ring-offset-2 ring-current" : "hover:shadow-sm"
                }`}
                onClick={() => handleStatusFilterClick(status)}
              >
                {status} ({returns.length})
              </Badge>
            )
          })}
          {completedReturns.length > 0 && (
            <Badge
              variant="outline"
              className={`bg-green-100 text-green-700 border-green-300 px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${
                statusFilter === "E-filed/Manually Filed"
                  ? "shadow-md ring-2 ring-offset-2 ring-green-400"
                  : "hover:shadow-sm"
              }`}
              onClick={() => handleStatusFilterClick("E-filed/Manually Filed")}
            >
              Completed ({completedReturns.length})
            </Badge>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "business" | "individual" | "queue")}>
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="business" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Business ({businessReturns.length})
          </TabsTrigger>
          <TabsTrigger value="individual" className="flex items-center gap-2">
            <User className="h-4 w-4" />
            Individual ({individualStats.total})
          </TabsTrigger>
          <TabsTrigger value="queue" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Queue ({queueReturns.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business" className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-3 flex items-center gap-2 flex-wrap">
            <Button
              variant={businessEntityFilter === "all" ? "default" : "ghost"}
              size="sm"
              onClick={() => setBusinessEntityFilter("all")}
              className="h-8"
            >
              All ({businessReturns.length})
            </Button>
            <Button
              variant={businessEntityFilter === "partnership" ? "default" : "ghost"}
              size="sm"
              onClick={() => setBusinessEntityFilter("partnership")}
              className="h-8"
            >
              Partnerships ({businessReturns.filter((r) => r.entityType === "1065 - Partnership").length})
            </Button>
            <Button
              variant={businessEntityFilter === "s-corp" ? "default" : "ghost"}
              size="sm"
              onClick={() => setBusinessEntityFilter("s-corp")}
              className="h-8"
            >
              S-Corps ({businessReturns.filter((r) => r.entityType === "1120-S - S-Corp").length})
            </Button>
            <Button
              variant={businessEntityFilter === "c-corp" ? "default" : "ghost"}
              size="sm"
              onClick={() => setBusinessEntityFilter("c-corp")}
              className="h-8"
            >
              C-Corps ({businessReturns.filter((r) => r.entityType === "1120 - C-Corp").length})
            </Button>
          </div>

          <div className="space-y-3">
            {filteredBusinessReturns.map((taxReturn) => (
              <div
                key={taxReturn.id}
                className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleRowClick(taxReturn)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {taxReturn.isPriority && <Flag className="h-4 w-4 text-red-600 fill-red-600 shrink-0" />}
                      <h3 className="font-semibold truncate">{taxReturn.clientName}</h3>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {taxReturn.entityType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>Due: {new Date(taxReturn.dueDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[100px]">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${taxReturn.progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">{taxReturn.progress}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {taxReturn.inQueue ? (
                      <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                        In Queue
                      </Badge>
                    ) : taxReturn.assignedTo ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs">
                        <User className="h-3 w-3" />
                        <span>{taxReturn.assignedTo}</span>
                      </div>
                    ) : null}
                    <Badge variant="outline" className={getStatusColor(taxReturn.primaryStatus)}>
                      {taxReturn.primaryStatus}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="individual" className="space-y-6">
          <div className="space-y-3">
            {filteredIndividualReturns.map((taxReturn) => (
              <div
                key={taxReturn.id}
                className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleRowClick(taxReturn)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      {taxReturn.isPriority && <Flag className="h-4 w-4 text-red-600 fill-red-600 shrink-0" />}
                      <h3 className="font-semibold truncate">{taxReturn.clientName}</h3>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {taxReturn.entityType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        <span>Due: {new Date(taxReturn.dueDate).toLocaleDateString()}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[100px]">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${taxReturn.progress}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">{taxReturn.progress}%</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {taxReturn.inQueue ? (
                      <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                        In Queue
                      </Badge>
                    ) : taxReturn.assignedTo ? (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs">
                        <User className="h-3 w-3" />
                        <span>{taxReturn.assignedTo}</span>
                      </div>
                    ) : null}
                    <Badge variant="outline" className={getStatusColor(taxReturn.primaryStatus)}>
                      {taxReturn.primaryStatus}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="queue" className="space-y-6">
          {filteredQueueReturns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No returns in the queue</p>
              <p className="text-sm mt-2">
                {statusFilter !== "all"
                  ? `No returns with status "${statusFilter}" in the queue`
                  : "Assign returns to the Tax Prep Queue to see them here"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredQueueReturns.map((taxReturn) => (
                <div
                  key={taxReturn.id}
                  className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => handleRowClick(taxReturn)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        {taxReturn.isPriority && <Flag className="h-4 w-4 text-red-600 fill-red-600 shrink-0" />}
                        <h3 className="font-semibold truncate">{taxReturn.clientName}</h3>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {taxReturn.entityType}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>Due: {new Date(taxReturn.dueDate).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[100px]">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${taxReturn.progress}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{taxReturn.progress}%</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                        In Queue
                      </Badge>
                      <Badge variant="outline" className={getStatusColor(taxReturn.primaryStatus)}>
                        {taxReturn.primaryStatus}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedReturn && (
            <>
              <DialogHeader>
                <DialogTitle className="text-2xl">{selectedReturn.clientName}</DialogTitle>
                <DialogDescription>
                  {selectedReturn.entityType} - Tax Year {selectedReturn.taxYear}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {selectedReturn.inQueue && (
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-purple-900">This return is in the Tax Prep Queue</h3>
                        <p className="text-sm text-purple-700 mt-1">
                          Claim this return to assign it to yourself and start working on it
                        </p>
                      </div>
                      <Button onClick={handleClaimReturn} className="bg-purple-600 hover:bg-purple-700">
                        Claim This Return
                      </Button>
                    </div>
                  </div>
                )}

                <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
                  <h3 className="font-semibold flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Assignment
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Assign To</label>
                      <select
                        className="w-full p-2 border rounded-md"
                        value={assignmentForm.assignTo}
                        onChange={(e) => setAssignmentForm({ ...assignmentForm, assignTo: e.target.value })}
                      >
                        <option value="">Select team member...</option>
                        <option value="Tax Prep Queue">Tax Prep Queue</option>
                        <option value="Andrew">Andrew</option>
                        <option value="Sarah">Sarah</option>
                        <option value="Thameem">Thameem</option>
                        <option value="Sophia Echevarria">Sophia Echevarria</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Update Status</label>
                      <select
                        className="w-full p-2 border rounded-md"
                        value={assignmentForm.status}
                        onChange={(e) =>
                          setAssignmentForm({ ...assignmentForm, status: e.target.value as PrimaryStatus })
                        }
                      >
                        <option value="">Select status...</option>
                        <option value="Prospect">Prospect</option>
                        <option value="Proposal Sent">Proposal Sent</option>
                        <option value="Proposal Signed">Proposal Signed</option>
                        <option value="Documents Received">Documents Received</option>
                        <option value="Ready for Prep">Ready for Prep</option>
                        <option value="Waiting for Client">Waiting for Client</option>
                        <option value="Actively Preparing">Actively Preparing</option>
                        <option value="In Review">In Review</option>
                        <option value="Finalizing">Finalizing</option>
                        <option value="Sent to Client">Sent to Client</option>
                        <option value="E-filed/Manually Filed">E-filed/Manually Filed</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Assignment Note</label>
                    <textarea
                      className="w-full p-2 border rounded-md"
                      rows={3}
                      placeholder="Add a note for the assignee..."
                      value={assignmentForm.note}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, note: e.target.value })}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="priority"
                      checked={assignmentForm.isPriority}
                      onChange={(e) => setAssignmentForm({ ...assignmentForm, isPriority: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <label htmlFor="priority" className="text-sm font-medium cursor-pointer">
                      Mark as Priority
                    </label>
                  </div>
                  <Button onClick={handleAssignment} disabled={!assignmentForm.assignTo || !assignmentForm.status}>
                    Assign Return
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Current Status</label>
                    <Badge variant="outline" className={`${getStatusColor(selectedReturn.primaryStatus)} w-fit`}>
                      {selectedReturn.primaryStatus}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Currently Assigned To</label>
                    <div className="text-sm">
                      {selectedReturn.inQueue ? (
                        <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300">
                          In Queue
                        </Badge>
                      ) : selectedReturn.assignedTo ? (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3" />
                          <span>{selectedReturn.assignedTo}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not assigned</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Preparer</label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded-md"
                      value={selectedReturn.preparer}
                      onChange={(e) => setSelectedReturn({ ...selectedReturn, preparer: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Reviewer</label>
                    <input
                      type="text"
                      className="w-full p-2 border rounded-md"
                      value={selectedReturn.reviewer || ""}
                      onChange={(e) => setSelectedReturn({ ...selectedReturn, reviewer: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Progress</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        className="flex-1"
                        value={selectedReturn.progress}
                        onChange={(e) =>
                          setSelectedReturn({ ...selectedReturn, progress: Number.parseInt(e.target.value) })
                        }
                      />
                      <span className="text-sm font-medium w-12">{selectedReturn.progress}%</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Due Date</label>
                    <input
                      type="date"
                      className="w-full p-2 border rounded-md"
                      value={selectedReturn.dueDate}
                      onChange={(e) => setSelectedReturn({ ...selectedReturn, dueDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Notes</label>
                  <textarea
                    className="w-full p-2 border rounded-md"
                    rows={4}
                    value={selectedReturn.notes}
                    onChange={(e) => setSelectedReturn({ ...selectedReturn, notes: e.target.value })}
                  />
                </div>

                {selectedReturn.assignmentNotes.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold">Assignment History</h3>
                    <div className="space-y-2">
                      {selectedReturn.assignmentNotes.map((note, index) => (
                        <div key={index} className="p-3 bg-muted rounded-lg text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">
                              Assigned to {note.assignedTo} by {note.assignedBy}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(note.timestamp).toLocaleString()}
                            </span>
                          </div>
                          <div className="text-muted-foreground">
                            Status:{" "}
                            <Badge variant="outline" className="text-xs">
                              {note.status}
                            </Badge>
                          </div>
                          {note.note && <div className="mt-2">{note.note}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={() => handleUpdateReturn(selectedReturn)}>Save Changes</Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default BusySeasonTracker
