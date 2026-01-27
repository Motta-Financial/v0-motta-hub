"use client"

import { useEffect, useState, useMemo, useCallback } from "react"
import useSWR from "swr"
import { useTaxWorkItems, type KarbonWorkItem } from "@/contexts/karbon-work-items-context"
import type { TeamMember } from "@/contexts/user-context"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Calendar, FileText, AlertCircle, CheckCircle2, Clock, Plus, Building2, User, Flag, Search, Loader2, RefreshCw, ExternalLink, ChevronDown, ChevronRight } from "lucide-react"

// Karbon workflow statuses for 2025 Busy Season (in order)
const BUSY_SEASON_2025_STATUSES = [
  "SEND PROPOSAL TO CLIENT",
  "Proposal | Sent",
  "Proposal | Signed",
  "Client Requests | Sent",
  "Client Requests | Rec'd",
  "Actively Preparing",
  "Preparing | Follow Ups",
  "Internal Review | Prelim",
  "Prepared | Client Review",
  "Client Reviewed | Updates",
  "Internal Review | Final",
  "Motta Review'd | Fllw Ups",
  "Motta | Final Reviewed",
  "Client Aprvd | Finalizing",
  "Invoice (Requested)",
  "E-Filed & Ready to Bill",
]

// Work types to include for 2025 Busy Season
const BUSY_SEASON_2025_WORK_TYPES = [
  "TAX | C-Corp (1120)",
  "TAX | Individual (1040)",
  "TAX | Individual (1040c)",
  "TAX | Non-Profit & Exempt (990)",
  "TAX | Partnership (1065)",
  "Tax | S-Corp (1120S)",
]

// Tax year for this busy season
const BUSY_SEASON_TAX_YEAR = 2025

// Helper to get entity type badge color and short label
function getEntityTypeDisplay(entityType: string): { label: string; color: string } {
  if (entityType.includes("1065") || entityType.toLowerCase().includes("partnership")) {
    return { label: "1065", color: "bg-blue-100 text-blue-700 border-blue-300" }
  }
  if (entityType.includes("1120-S") || entityType.includes("1120S") || entityType.toLowerCase().includes("s-corp")) {
    return { label: "1120-S", color: "bg-green-100 text-green-700 border-green-300" }
  }
  if (entityType.includes("1120") || entityType.toLowerCase().includes("c-corp")) {
    return { label: "1120", color: "bg-orange-100 text-orange-700 border-orange-300" }
  }
  if (entityType.includes("1040")) {
    return { label: "1040", color: "bg-purple-100 text-purple-700 border-purple-300" }
  }
  if (entityType.includes("990") || entityType.toLowerCase().includes("non-profit")) {
    return { label: "990", color: "bg-pink-100 text-pink-700 border-pink-300" }
  }
  return { label: entityType, color: "bg-gray-100 text-gray-700 border-gray-300" }
}

// Helper to extract the actual status from Karbon's prefixed status format
// e.g., "In Progress - Actively Preparing" -> "Actively Preparing"
// e.g., "Ready To Start - Send Client Requests" -> "Send Client Requests"
function extractKarbonStatusSuffix(fullStatus: string): string {
  if (!fullStatus) return "Unknown"
  
  // Common prefixes in Karbon statuses
  const prefixes = [
    "In Progress - ",
    "Ready To Start - ",
    "Completed - ",
    "Planned - ",
    "On Hold - ",
  ]
  
  for (const prefix of prefixes) {
    if (fullStatus.startsWith(prefix)) {
      return fullStatus.substring(prefix.length)
    }
  }
  
  // If no prefix found, return as-is
  return fullStatus
}

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

// Workflow status - internal tracking for busy season
type WorkflowStatus = 
  | "Lead"
  | "Proposal Pending"
  | "Requesting Documents"
  | "Documents Received"
  | "Ready for Prep"
  | "In Preparation"
  | "In Review"
  | "Finalizing"
  | "Awaiting Client Approval"
  | "Filed"
  | "Waiting on Client"
  | "Pending Review"

interface TaxReturn {
  id: string
  clientName: string
  entityType: string
  taxYear: number
  karbonStatus: string // Raw status from Karbon
  primaryStatus: PrimaryStatus // Mapped status for display
  workflowStatus: WorkflowStatus // Internal workflow status
  documentStatus?: DocumentStatus
  discoveryDocSent?: boolean
  preparer: string
  reviewer?: string
  assignedTo?: string
  inQueue?: boolean
  readyForPrep?: boolean
  assignmentNotes: AssignmentNote[]
  dueDate: string
  progress: number
  documentsReceived: boolean
  notes: string
  isPriority?: boolean
  lastUpdated: string
  lastUpdatedBy: string
  lastUpdatedByType: "internal" | "client"
  lastFollowUpDate?: string
  totalTasks?: number
  completedTasks?: number
  karbonWorkKey?: string
  karbonUrl?: string
}

// Karbon Task type
interface KarbonTask {
  TaskKey: string
  WorkItemTaskKey: string
  Title: string
  Description?: string
  Status: string
  IsComplete: boolean
  DueDate?: string
  CompletedDate?: string
  SortOrder: number
  AssignedTo?: { FullName: string; Email?: string; UserKey?: string }
  EstimatedMinutes?: number
  ActualMinutes?: number
}

// Karbon Note type
interface KarbonNote {
  NoteKey: string
  WorkItemNoteKey: string
  Subject?: string
  Body: string
  NoteType: string
  Author?: { FullName: string; UserKey?: string }
  CreatedDate: string
  ModifiedDate?: string
  IsPinned?: boolean
}

// Parse Karbon work item title format: "TAX | Individual (1040) | Client Name | YYYY"
function parseKarbonTitle(title: string): { 
  category: string
  entityType: string
  clientName: string
  taxYear: number
} {
  const parts = title.split("|").map(p => p.trim())
  
  // Default values
  let category = "TAX"
  let entityType = "Other"
  let clientName = title
  let taxYear = new Date().getFullYear()
  
  if (parts.length >= 4) {
    // Format: TAX | Individual (1040) | Client Name | YYYY
    category = parts[0]
    const entityPart = parts[1].toLowerCase()
    clientName = parts[2]
    const yearPart = parts[3]
    
    // Parse entity type from second part
    if (entityPart.includes("1040") || entityPart.includes("individual")) {
      entityType = "1040 - Individual"
    } else if (entityPart.includes("1065") || entityPart.includes("partnership")) {
      entityType = "1065 - Partnership"
    } else if (entityPart.includes("1120-s") || entityPart.includes("1120s") || entityPart.includes("s-corp") || entityPart.includes("s corp")) {
      entityType = "1120-S - S-Corp"
    } else if (entityPart.includes("1120") || entityPart.includes("c-corp") || entityPart.includes("c corp") || entityPart.includes("corporation")) {
      entityType = "1120 - C-Corp"
    } else if (entityPart.includes("990") || entityPart.includes("nonprofit") || entityPart.includes("non-profit")) {
      entityType = "990 - Nonprofit"
    } else if (entityPart.includes("709") || entityPart.includes("gift")) {
      entityType = "709 - Gift Tax"
    } else {
      entityType = parts[1] // Use the raw entity type
    }
    
    // Parse year from last part
    const yearMatch = yearPart.match(/20\d{2}/)
    if (yearMatch) {
      taxYear = parseInt(yearMatch[0])
    }
  } else if (parts.length === 3) {
    // Format: TAX | Entity Type | Client Name (year in entity or missing)
    category = parts[0]
    const entityPart = parts[1].toLowerCase()
    clientName = parts[2]
    
    if (entityPart.includes("1040") || entityPart.includes("individual")) {
      entityType = "1040 - Individual"
    } else if (entityPart.includes("1065") || entityPart.includes("partnership")) {
      entityType = "1065 - Partnership"
    } else if (entityPart.includes("1120-s") || entityPart.includes("1120s") || entityPart.includes("s-corp")) {
      entityType = "1120-S - S-Corp"
    } else if (entityPart.includes("1120") || entityPart.includes("c-corp")) {
      entityType = "1120 - C-Corp"
    }
    
    // Try to extract year from anywhere in title
    const yearMatch = title.match(/20\d{2}/)
    if (yearMatch) {
      taxYear = parseInt(yearMatch[0])
    }
  } else {
    // Fallback: try to extract what we can
    const yearMatch = title.match(/20\d{2}/)
    if (yearMatch) {
      taxYear = parseInt(yearMatch[0])
    }
    
    const titleLower = title.toLowerCase()
    if (titleLower.includes("1040") || titleLower.includes("individual")) {
      entityType = "1040 - Individual"
    } else if (titleLower.includes("1065") || titleLower.includes("partnership")) {
      entityType = "1065 - Partnership"
    } else if (titleLower.includes("1120-s") || titleLower.includes("1120s") || titleLower.includes("s-corp")) {
      entityType = "1120-S - S-Corp"
    } else if (titleLower.includes("1120") || titleLower.includes("c-corp")) {
      entityType = "1120 - C-Corp"
    }
  }
  
  return { category, entityType, clientName, taxYear }
}

// Check if work item is tax-related based on title format
function isTaxWorkItem(title: string, workType: string): boolean {
  const titleLower = (title || "").toLowerCase().trim()
  
  // STRICT: Only match work items where title starts with "TAX |"
  // This is the Motta Hub format: "TAX | Individual/Partnership/S-Corp/C-Corp | Client Name | Year"
  return titleLower.startsWith("tax |") || titleLower.startsWith("tax|")
}

// Helper to map Karbon status to our PrimaryStatus
function mapKarbonStatus(workStatus: string, primaryStatus: string): PrimaryStatus {
  const status = (primaryStatus || workStatus || "").toLowerCase()
  if (status.includes("prospect")) return "Prospect"
  if (status.includes("proposal") && status.includes("sent")) return "Proposal Sent"
  if (status.includes("proposal") && status.includes("signed")) return "Proposal Signed"
  if (status.includes("document") && status.includes("received")) return "Documents Received"
  if (status.includes("ready") && status.includes("prep")) return "Ready for Prep"
  if (status.includes("waiting") || status.includes("client")) return "Waiting for Client"
  if (status.includes("preparing") || status.includes("in progress") || status.includes("active")) return "Actively Preparing"
  if (status.includes("review")) return "In Review"
  if (status.includes("final")) return "Finalizing"
  if (status.includes("sent to client")) return "Sent to Client"
  if (status.includes("filed") || status.includes("complete") || status.includes("done")) return "E-filed/Manually Filed"
  return "Actively Preparing"
}

// Helper to calculate progress based on status
function calculateProgress(status: PrimaryStatus): number {
  const progressMap: Record<PrimaryStatus, number> = {
    "Prospect": 0,
    "Proposal Sent": 5,
    "Proposal Signed": 10,
    "Documents Received": 15,
    "Ready for Prep": 20,
    "Waiting for Client": 30,
    "Actively Preparing": 50,
    "In Review": 75,
    "Finalizing": 90,
    "Sent to Client": 95,
    "E-filed/Manually Filed": 100,
  }
  return progressMap[status] || 50
}

// Transform Karbon work item to TaxReturn
function transformKarbonToTaxReturn(item: KarbonWorkItem): TaxReturn {
  // Parse the structured title format
  const parsed = parseKarbonTitle(item.Title)
  const primaryStatus = mapKarbonStatus(item.WorkStatus, item.PrimaryStatus)
  const assignedTo = item.AssignedTo?.FullName || undefined
  
  // Use ClientName from Karbon if available, otherwise use parsed client name from title
  const clientName = item.ClientName || parsed.clientName
  
  return {
    id: item.WorkKey,
    clientName,
    entityType: parsed.entityType,
    taxYear: parsed.taxYear,
    primaryStatus,
    preparer: assignedTo || "Unassigned",
    assignedTo,
    inQueue: !assignedTo,
    assignmentNotes: [],
    dueDate: item.DueDate || new Date().toISOString(),
    progress: calculateProgress(primaryStatus),
    documentsReceived: primaryStatus !== "Prospect" && primaryStatus !== "Proposal Sent" && primaryStatus !== "Proposal Signed",
    notes: item.Description || "",
    isPriority: item.Priority === "High",
    lastUpdated: item.ModifiedDate || new Date().toISOString(),
    lastUpdatedBy: assignedTo || "System",
    lastUpdatedByType: "internal",
    karbonWorkKey: item.WorkKey,
    karbonUrl: `https://app2.karbonhq.com/work/${item.WorkKey}`,
  }
}

// Helper function to determine entity type based on work type and title
function determineEntityType(workType: string, title: string): string {
  const workTypeLower = workType.toLowerCase()
  const titleLower = title.toLowerCase()

  if (workTypeLower.includes("individual") || titleLower.includes("1040")) {
    return "1040 - Individual"
  } else if (workTypeLower.includes("partnership") || titleLower.includes("1065")) {
    return "1065 - Partnership"
  } else if (workTypeLower.includes("s-corp") || titleLower.includes("1120-s")) {
    return "1120-S - S-Corp"
  } else if (workTypeLower.includes("c-corp") || titleLower.includes("1120")) {
    return "1120 - C-Corp"
  } else if (workTypeLower.includes("nonprofit") || titleLower.includes("990")) {
    return "990 - Nonprofit"
  } else if (workTypeLower.includes("gift") || titleLower.includes("709")) {
    return "709 - Gift Tax"
  }

  return "Other"
}

// Helper function to extract tax year from title
function extractTaxYear(title: string): number {
  const yearMatch = title.match(/20\d{2}/)
  if (yearMatch) {
    return parseInt(yearMatch[0])
  }
  return new Date().getFullYear()
}

// SWR fetcher function
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    // Try to parse error message from JSON, otherwise use status text
    let errorMessage = res.statusText
    try {
      const errorData = await res.json()
      errorMessage = errorData.error || errorMessage
    } catch {
      // Response wasn't JSON, use status text
    }
    throw new Error(errorMessage)
  }
  return res.json()
}

export function BusySeasonTracker() {
  const [selectedReturn, setSelectedReturn] = useState<TaxReturn | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"business" | "individual" | "queue">("business")
  const [businessEntityFilter, setBusinessEntityFilter] = useState<"all" | "partnership" | "s-corp" | "c-corp">("all")
  const [statusFilter, setStatusFilter] = useState<PrimaryStatus | "all">("all")
  const [workflowFilter, setWorkflowFilter] = useState<"all" | "leads" | "requesting-docs" | "ready-for-prep" | "in-progress" | "completed">("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [karbonStatusFilter, setKarbonStatusFilter] = useState<string>("all")
  const [internalStatusFilter, setInternalStatusFilter] = useState<"all" | "Unassigned" | "Ready for Prep" | "Actively Preparing" | "Waiting for Client" | "In Review" | "Finalizing" | "Completed">("all")
  
  // Track which status sections are expanded (default: all expanded)
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(BUSY_SEASON_2025_STATUSES))
  
  // Fetch team members from database
  const { data: teamMembersData } = useSWR<{ team_members: TeamMember[] }>(
    "/api/team-members",
    fetcher,
    { revalidateOnFocus: false }
  )
  const teamMembers = teamMembersData?.team_members || []
  
  // Toggle section expansion
  const toggleSection = (status: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev)
      if (newSet.has(status)) {
        newSet.delete(status)
      } else {
        newSet.add(status)
      }
      return newSet
    })
  }
  
  // Expand all sections
  const expandAll = () => {
    setExpandedSections(new Set([...BUSY_SEASON_2025_STATUSES, "Other"]))
  }
  
  // Collapse all sections
  const collapseAll = () => {
    setExpandedSections(new Set())
  }
  
  // Tasks and notes for selected work item
  const [selectedTasks, setSelectedTasks] = useState<KarbonTask[]>([])
  const [selectedNotes, setSelectedNotes] = useState<KarbonNote[]>([])
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get tax work items from shared context (already filtered from Karbon)
  const { taxWorkItems, isLoading: isLoadingKarbon, error: karbonError, refresh: refreshKarbon } = useTaxWorkItems()

  // Fetch internal data from Supabase (assignments, queue status, notes, etc.)
  const { data: internalData, mutate: mutateInternal } = useSWR(
    "/api/busy-season",
    fetcher,
    {
      revalidateOnFocus: true, // Keep team in sync
      revalidateOnReconnect: true,
      refreshInterval: 30000, // Refresh every 30 seconds for real-time updates
      dedupingInterval: 5000,
    }
  )

  // Create a map of internal data by karbon_work_key for quick lookup
  const internalDataMap = useMemo(() => {
    const map = new Map<string, any>()
    if (internalData?.workItems) {
      internalData.workItems.forEach((item: any) => {
        if (item.karbon_work_key) {
          map.set(item.karbon_work_key, item)
        }
      })
    }
    return map
  }, [internalData])

  // Transform tax work items and merge with internal Supabase data
  // Filter for 2025 tax year AND matching work types only
  const allReturns = useMemo(() => {
    if (!taxWorkItems || taxWorkItems.length === 0) return []
    
    return taxWorkItems
      .filter((item: KarbonWorkItem) => {
        // Extract tax year from title and filter for 2025 only
        const taxYear = extractTaxYear(item.Title)
        if (taxYear !== BUSY_SEASON_TAX_YEAR) return false
        
        // Filter by work type - check if title matches any of the 2025 busy season work types
        const titleLower = item.Title.toLowerCase()
        const matchesWorkType = 
          titleLower.includes("c-corp") || titleLower.includes("1120)") ||
          titleLower.includes("individual") || titleLower.includes("1040") ||
          titleLower.includes("non-profit") || titleLower.includes("990") ||
          titleLower.includes("partnership") || titleLower.includes("1065") ||
          titleLower.includes("s-corp") || titleLower.includes("1120s")
        
        return matchesWorkType
      })
      .map((item: KarbonWorkItem): TaxReturn => {
      // Get internal data if exists
      const internal = internalDataMap.get(item.WorkKey)
      
      // Determine workflow status based on Karbon status
      const karbonStatus = item.WorkStatus || "Unknown"
      let workflowStatus: WorkflowStatus = "Pending Review"
      const statusLower = karbonStatus.toLowerCase()
      
      if (statusLower.includes("proposal") && !statusLower.includes("signed")) {
        workflowStatus = "Lead"
      } else if (statusLower.includes("proposal signed") || statusLower.includes("engagement")) {
        workflowStatus = "Requesting Documents"
      } else if (statusLower.includes("documents received") || statusLower.includes("ready")) {
        workflowStatus = "Ready for Prep"
      } else if (statusLower.includes("in progress") || statusLower.includes("preparing")) {
        workflowStatus = "In Preparation"
      } else if (statusLower.includes("review")) {
        workflowStatus = "In Review"
      } else if (statusLower.includes("complete") || statusLower.includes("filed")) {
        workflowStatus = "Filed"
      }
      
      return {
        id: internal?.id || item.WorkKey,
        clientName: item.ClientName || item.Title?.split("|")[2]?.trim() || "Unknown Client",
        entityType: determineEntityType(item.Title, item.WorkType || ""),
        taxYear: extractTaxYear(item.Title),
        karbonStatus: karbonStatus,
        // Use internal status if set, otherwise derive from Karbon
        primaryStatus: internal?.primary_status || derivePrimaryStatus(karbonStatus),
        workflowStatus: internal?.workflow_status || workflowStatus,
        preparer: internal?.preparer || "Unassigned",
        reviewer: internal?.reviewer,
        assignedTo: internal?.assigned_to,
        inQueue: internal?.in_queue || false,
        readyForPrep: internal?.ready_for_prep || false,
        assignmentNotes: [],
        dueDate: item.DueDate || new Date().toISOString(),
        progress: internal?.progress || 0,
        documentsReceived: internal?.documents_received || false,
        notes: internal?.notes || "",
        isPriority: internal?.is_priority || false,
        lastUpdated: item.LastModifiedDateTime || new Date().toISOString(),
        lastUpdatedBy: internal?.last_updated_by || "Karbon",
        lastUpdatedByType: internal ? "internal" : "client",
        lastFollowUpDate: internal?.last_follow_up_date,
        totalTasks: 0,
        completedTasks: 0,
        karbonWorkKey: item.WorkKey,
        karbonUrl: `https://app.karbonhq.com/work/${item.WorkKey}`,
      }
    })
  }, [taxWorkItems, internalDataMap])

  // Helper to derive primary status from Karbon status
  function derivePrimaryStatus(karbonStatus: string): PrimaryStatus {
    const statusLower = karbonStatus.toLowerCase()
    if (statusLower.includes("complete") || statusLower.includes("filed")) {
      return "E-filed/Manually Filed"
    } else if (statusLower.includes("wait") || statusLower.includes("pending")) {
      return "Waiting for Client"
    }
    return "Actively Preparing"
  }

  const isLoading = isLoadingKarbon

  useEffect(() => {
    if (karbonError) {
      setError(karbonError)
    }
  }, [karbonError])

  // Refresh from Karbon
  const refreshWorkItems = useCallback(() => {
    refreshKarbon()
    mutateInternal()
  }, [refreshKarbon, mutateInternal])



  // Update a work item in Supabase (or create if doesn't exist)
  const updateWorkItem = useCallback(async (karbonWorkKey: string, updates: Partial<TaxReturn>, taxReturn?: TaxReturn) => {
    try {
      // Map TaxReturn fields to database columns
      const dbUpdates: Record<string, any> = {}
      if (updates.primaryStatus !== undefined) dbUpdates.primary_status = updates.primaryStatus
      if (updates.assignedTo !== undefined) dbUpdates.assigned_to = updates.assignedTo
      if (updates.preparer !== undefined) dbUpdates.preparer = updates.preparer
      if (updates.reviewer !== undefined) dbUpdates.reviewer = updates.reviewer
      if (updates.inQueue !== undefined) dbUpdates.in_queue = updates.inQueue
      if (updates.isPriority !== undefined) dbUpdates.is_priority = updates.isPriority
      if (updates.progress !== undefined) dbUpdates.progress = updates.progress
      if (updates.notes !== undefined) dbUpdates.notes = updates.notes
      if (updates.documentsReceived !== undefined) dbUpdates.documents_received = updates.documentsReceived
      if (updates.lastUpdatedBy !== undefined) dbUpdates.last_updated_by = updates.lastUpdatedBy
  if (updates.workflowStatus !== undefined) dbUpdates.workflow_status = updates.workflowStatus
  
  // Include client info for new records
      if (taxReturn) {
        dbUpdates.client_name = taxReturn.clientName
        dbUpdates.entity_type = taxReturn.entityType
        dbUpdates.tax_year = taxReturn.taxYear
        dbUpdates.due_date = taxReturn.dueDate
        dbUpdates.karbon_status = taxReturn.karbonStatus
        dbUpdates.karbon_url = taxReturn.karbonUrl
      }
      
      const response = await fetch(`/api/busy-season/${karbonWorkKey}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dbUpdates),
      })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Update failed")
      }
      
      // Optimistically update local data
      mutateInternal()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update work item")
      return false
    }
  }, [mutateInternal])

  // Derive business and individual returns from allReturns
  const businessReturns = useMemo(() => 
    allReturns.filter((r: TaxReturn) => {
      const et = r.entityType.toLowerCase()
      const isIndividual = et.includes("1040") || et.includes("individual")
      return !isIndividual
    }),
    [allReturns]
  )
  
  const individualReturns = useMemo(() => 
    allReturns.filter((r: TaxReturn) => {
      const et = r.entityType.toLowerCase()
      return et.includes("1040") || et.includes("individual")
    }),
    [allReturns]
  )

  // Get unique Karbon statuses and their counts - only show the defined 2025 busy season statuses
  const karbonStatusGroups = useMemo(() => {
    const groups: Record<string, TaxReturn[]> = {}
    
    // Initialize with all defined statuses (to maintain order)
    BUSY_SEASON_2025_STATUSES.forEach(status => {
      groups[status] = []
    })
    
    // Add "Other" for statuses not in our list
    groups["Other"] = []
    
    allReturns.forEach((r) => {
      // Extract the actual status suffix from Karbon's prefixed format
      const extractedStatus = extractKarbonStatusSuffix(r.karbonStatus || "Unknown")
      
      if (BUSY_SEASON_2025_STATUSES.includes(extractedStatus)) {
        groups[extractedStatus].push(r)
      } else {
        groups["Other"].push(r)
      }
    })
    
    // Return in the defined order, filtering out empty groups
    return BUSY_SEASON_2025_STATUSES
      .filter(status => groups[status].length > 0)
      .map(status => ({ status, items: groups[status], count: groups[status].length }))
      .concat(groups["Other"].length > 0 ? [{ status: "Other", items: groups["Other"], count: groups["Other"].length }] : [])
  }, [allReturns])

  // Get Karbon statuses for business returns - only show the defined 2025 busy season statuses
  const businessKarbonStatusGroups = useMemo(() => {
    const groups: Record<string, TaxReturn[]> = {}
    
    BUSY_SEASON_2025_STATUSES.forEach(status => {
      groups[status] = []
    })
    groups["Other"] = []
    
    businessReturns.forEach((r) => {
      const extractedStatus = extractKarbonStatusSuffix(r.karbonStatus || "Unknown")
      if (BUSY_SEASON_2025_STATUSES.includes(extractedStatus)) {
        groups[extractedStatus].push(r)
      } else {
        groups["Other"].push(r)
      }
    })
    
    return BUSY_SEASON_2025_STATUSES
      .filter(status => groups[status].length > 0)
      .map(status => ({ status, items: groups[status], count: groups[status].length }))
      .concat(groups["Other"].length > 0 ? [{ status: "Other", items: groups["Other"], count: groups["Other"].length }] : [])
  }, [businessReturns])

  // Get Karbon statuses for individual returns - only show the defined 2025 busy season statuses
  const individualKarbonStatusGroups = useMemo(() => {
    const groups: Record<string, TaxReturn[]> = {}
    
    BUSY_SEASON_2025_STATUSES.forEach(status => {
      groups[status] = []
    })
    groups["Other"] = []
    
    individualReturns.forEach((r) => {
      const extractedStatus = extractKarbonStatusSuffix(r.karbonStatus || "Unknown")
      if (BUSY_SEASON_2025_STATUSES.includes(extractedStatus)) {
        groups[extractedStatus].push(r)
      } else {
        groups["Other"].push(r)
      }
    })
    
    return BUSY_SEASON_2025_STATUSES
      .filter(status => groups[status].length > 0)
      .map(status => ({ status, items: groups[status], count: groups[status].length }))
      .concat(groups["Other"].length > 0 ? [{ status: "Other", items: groups["Other"], count: groups["Other"].length }] : [])
  }, [individualReturns])

  // Clear tasks and notes when selecting a work item (don't auto-fetch to avoid 404 errors)
  const fetchWorkItemDetails = useCallback(async (_workKey: string) => {
    // Reset state - we no longer auto-fetch tasks/notes to reduce API calls
    // Many work items in Karbon don't have tasks/notes resources
    setSelectedTasks([])
    setSelectedNotes([])
    setIsLoadingDetails(false)
  }, [])

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

  // Helper function to format relative time
  const formatLastUpdated = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Helper function to sort by lastUpdated (most recent first)
  const sortByLastUpdated = (returns: TaxReturn[]) => {
    return [...returns].sort((a, b) => 
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
    )
  }

  // Helper function to filter by search query
  const filterBySearch = (returns: TaxReturn[]) => {
    if (!searchQuery.trim()) return returns
    const query = searchQuery.toLowerCase()
    return returns.filter((r) => 
      r.clientName.toLowerCase().includes(query) ||
      r.entityType.toLowerCase().includes(query) ||
      r.preparer?.toLowerCase().includes(query) ||
      r.assignedTo?.toLowerCase().includes(query) ||
      r.notes?.toLowerCase().includes(query)
    )
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

    // Filter by Karbon status if selected
    if (karbonStatusFilter !== "all") {
      filtered = filtered.filter((r) => r.karbonStatus === karbonStatusFilter)
    }

    // Apply search filter and sort by lastUpdated
    return sortByLastUpdated(filterBySearch(filtered))
  }

  const getFilteredIndividualReturns = () => {
    let filtered = individualReturns
    if (statusFilter !== "all") {
      filtered = filtered.filter((r) => r.primaryStatus === statusFilter)
    }
    // Filter by Karbon status if selected
    if (karbonStatusFilter !== "all") {
      filtered = filtered.filter((r) => r.karbonStatus === karbonStatusFilter)
    }
    // Apply search filter and sort by lastUpdated
    return sortByLastUpdated(filterBySearch(filtered))
  }

  const getFilteredQueueReturns = () => {
    let queueReturns = allReturns.filter((r) => r.inQueue)
    if (statusFilter !== "all") {
      queueReturns = queueReturns.filter((r) => r.primaryStatus === statusFilter)
    }
    // Filter by Karbon status if selected
    if (karbonStatusFilter !== "all") {
      queueReturns = queueReturns.filter((r) => r.karbonStatus === karbonStatusFilter)
    }
    // Apply search filter and sort by lastUpdated
    return sortByLastUpdated(filterBySearch(queueReturns))
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

  // Internal MottaHub statuses for filtering (based on what we assign internally)
  const INTERNAL_STATUSES = [
    "Unassigned",
    "Ready for Prep", 
    "Actively Preparing",
    "Waiting for Client",
    "In Review",
    "Finalizing",
    "Completed",
  ] as const
  type InternalStatus = typeof INTERNAL_STATUSES[number]

  // Get internal status based on assignment and internal primary_status
  const getInternalStatus = (r: TaxReturn): InternalStatus => {
    // If no internal assignment, it's unassigned
    if (!r.assignedTo || r.assignedTo === "Tax Prep Queue" || r.preparer === "Unassigned") {
      return "Unassigned"
    }
    // Check if completed
    if (r.primaryStatus === "E-filed/Manually Filed") {
      return "Completed"
    }
    // Map primaryStatus to internal status
    if (r.primaryStatus === "Waiting for Client") return "Waiting for Client"
    if (r.primaryStatus === "In Review") return "In Review"
    if (r.primaryStatus === "Finalizing") return "Finalizing"
    if (r.primaryStatus === "Ready for Prep") return "Ready for Prep"
    return "Actively Preparing"
  }

  // Calculate counts for internal status overview
  const internalStatusCounts = useMemo(() => {
    const counts: Record<InternalStatus, TaxReturn[]> = {
      "Unassigned": [],
      "Ready for Prep": [],
      "Actively Preparing": [],
      "Waiting for Client": [],
      "In Review": [],
      "Finalizing": [],
      "Completed": [],
    }
    allReturns.forEach(r => {
      const status = getInternalStatus(r)
      counts[status].push(r)
    })
    return counts
  }, [allReturns])

  const completedReturns = internalStatusCounts["Completed"]

  const handleRowClick = (taxReturn: TaxReturn) => {
    setSelectedReturn(taxReturn)
    setAssignmentForm({
      assignTo: taxReturn.assignedTo || "",
      status: taxReturn.primaryStatus,
      note: "",
      isPriority: taxReturn.isPriority || false,
    })
    setIsDetailOpen(true)
    
    // Fetch tasks and notes for this work item
    if (taxReturn.karbonWorkKey) {
      fetchWorkItemDetails(taxReturn.karbonWorkKey)
    }
  }

  const handleUpdateReturn = async (updatedReturn: TaxReturn) => {
    await updateWorkItem(updatedReturn.karbonWorkKey || updatedReturn.id, updatedReturn, updatedReturn)
    setIsDetailOpen(false)
  }

  const handleAssignment = async () => {
    if (!selectedReturn || !assignmentForm.assignTo || !assignmentForm.status) return

    const isQueueAssignment = assignmentForm.assignTo === "Tax Prep Queue"
    const currentUser = "Current User" // TODO: Replace with actual user from auth

    const updates: Partial<TaxReturn> = {
      assignedTo: isQueueAssignment ? undefined : assignmentForm.assignTo,
      inQueue: isQueueAssignment,
      primaryStatus: assignmentForm.status,
      isPriority: assignmentForm.isPriority,
      lastUpdatedBy: currentUser,
    }

    const success = await updateWorkItem(selectedReturn.karbonWorkKey || selectedReturn.id, updates, selectedReturn)
    
    if (success) {
      // Update local selected return for immediate UI feedback
      setSelectedReturn({
        ...selectedReturn,
        ...updates,
        lastUpdated: new Date().toISOString(),
        lastUpdatedByType: "internal" as const,
      })

      setAssignmentForm({
        assignTo: "",
        status: assignmentForm.status,
        note: "",
        isPriority: assignmentForm.isPriority,
      })
    }
  }

  const handleClaimReturn = async () => {
    if (!selectedReturn) return

    const currentUser = "Current User" // TODO: Replace with actual user from auth

    const updates: Partial<TaxReturn> = {
      assignedTo: currentUser,
      preparer: currentUser,
      inQueue: false,
      lastUpdatedBy: currentUser,
    }

    const success = await updateWorkItem(selectedReturn.karbonWorkKey || selectedReturn.id, updates, selectedReturn)
    
    if (success) {
      setSelectedReturn({
        ...selectedReturn,
        ...updates,
        lastUpdated: new Date().toISOString(),
        lastUpdatedByType: "internal" as const,
      })
    }
  }

  const handleStatusFilterClick = (status: PrimaryStatus | "all") => {
    setStatusFilter(status)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Busy Season {BUSY_SEASON_TAX_YEAR}</h1>
          <p className="text-muted-foreground">
            {isLoading ? "Loading work items..." : `${allReturns.length} tax returns for ${BUSY_SEASON_TAX_YEAR} tax year`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients, preparers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[280px]"
            />
          </div>
          <Button onClick={refreshWorkItems} variant="outline" size="sm" disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "Loading..." : "Refresh from Karbon"}
          </Button>
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
              internalStatusFilter === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-background hover:bg-muted"
            }`}
            onClick={() => setInternalStatusFilter("all")}
          >
            All ({allReturns.length})
          </Badge>
          {INTERNAL_STATUSES.map((status) => {
            const returns = internalStatusCounts[status]
            if (returns.length === 0) return null

            // Color coding for internal statuses
            const getInternalStatusColor = (s: InternalStatus) => {
              switch (s) {
                case "Unassigned": return "bg-gray-100 text-gray-700 border-gray-300"
                case "Ready for Prep": return "bg-blue-100 text-blue-700 border-blue-300"
                case "Actively Preparing": return "bg-yellow-100 text-yellow-700 border-yellow-300"
                case "Waiting for Client": return "bg-orange-100 text-orange-700 border-orange-300"
                case "In Review": return "bg-purple-100 text-purple-700 border-purple-300"
                case "Finalizing": return "bg-indigo-100 text-indigo-700 border-indigo-300"
                case "Completed": return "bg-green-100 text-green-700 border-green-300"
                default: return "bg-gray-100 text-gray-700 border-gray-300"
              }
            }

            return (
              <Badge
                key={status}
                variant="outline"
                className={`${getInternalStatusColor(status)} px-3 py-1.5 text-sm font-medium cursor-pointer transition-all ${
                  internalStatusFilter === status ? "shadow-md ring-2 ring-offset-2 ring-current" : "hover:shadow-sm"
                }`}
                onClick={() => setInternalStatusFilter(status)}
              >
                {status} ({returns.length})
              </Badge>
            )
          })}
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
            Individual ({individualReturns.length})
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

          {/* Expand/Collapse All Controls */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Grouped by Karbon Status ({businessKarbonStatusGroups.length} stages with work items)
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs">
                Expand All
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs">
                Collapse All
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-500" />
              <p className="text-red-500">{error}</p>
              <Button onClick={refreshWorkItems} variant="outline" className="mt-4 bg-transparent">
                Try Again
              </Button>
            </div>
          ) : businessKarbonStatusGroups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No business returns found</p>
              <p className="text-sm mt-2">
                {searchQuery ? `No results for "${searchQuery}"` : "Try adjusting your filters"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {businessKarbonStatusGroups.map(({ status, items }) => {
                // Apply filters to items in this status group and sort by last updated
                const filteredItems = items
                  .filter(r => {
                    const matchesSearch = searchQuery === "" || 
                      r.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      r.preparer?.toLowerCase().includes(searchQuery.toLowerCase())
                    const matchesEntityFilter = businessEntityFilter === "all" ||
                      (businessEntityFilter === "partnership" && r.entityType === "1065 - Partnership") ||
                      (businessEntityFilter === "s-corp" && r.entityType === "1120-S - S-Corp") ||
                      (businessEntityFilter === "c-corp" && r.entityType === "1120 - C-Corp")
                    // Apply internal status filter
                    const matchesInternalStatus = internalStatusFilter === "all" || 
                      getInternalStatus(r) === internalStatusFilter
                    return matchesSearch && matchesEntityFilter && matchesInternalStatus
                  })
                  // Sort by last updated (most recent first)
                  .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
                
                if (filteredItems.length === 0) return null
                
                return (
                  <Collapsible
                    key={status}
                    open={expandedSections.has(status)}
                    onOpenChange={() => toggleSection(status)}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          {expandedSections.has(status) ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-semibold">{status}</span>
                          <Badge variant="secondary" className="text-xs">
                            {filteredItems.length} {filteredItems.length === 1 ? "return" : "returns"}
                          </Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2 ml-4 border-l-2 border-muted pl-4">
                        {filteredItems.map((taxReturn) => {
                          const entityDisplay = getEntityTypeDisplay(taxReturn.entityType)
                          return (
                            <div
                              key={taxReturn.id}
                              className="p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                              onClick={() => handleRowClick(taxReturn)}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    {/* Entity type badge - prominent with color */}
                                    <Badge variant="outline" className={`text-xs font-bold shrink-0 ${entityDisplay.color}`}>
                                      {entityDisplay.label}
                                    </Badge>
                                    {taxReturn.isPriority && <Flag className="h-4 w-4 text-red-600 fill-red-600 shrink-0" />}
                                    <h3 className="font-semibold truncate">{taxReturn.clientName}</h3>
                                    {taxReturn.karbonUrl && (
                                      <a 
                                        href={taxReturn.karbonUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-muted-foreground hover:text-foreground"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      <span>Updated: {formatLastUpdated(taxReturn.lastUpdated)}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span>Due: {taxReturn.dueDate ? new Date(taxReturn.dueDate).toLocaleDateString() : "Not set"}</span>
                                    </div>
                                    {taxReturn.assignedTo && (
                                      <div className="flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        <span>{taxReturn.assignedTo}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  {taxReturn.inQueue && (
                                    <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 text-xs">
                                      In Queue
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="individual" className="space-y-6">
          {/* Expand/Collapse All Controls */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              Grouped by Karbon Status ({individualKarbonStatusGroups.length} stages with work items)
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={expandAll} className="h-7 text-xs">
                Expand All
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll} className="h-7 text-xs">
                Collapse All
              </Button>
            </div>
          </div>

          {individualKarbonStatusGroups.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No individual returns found</p>
              <p className="text-sm mt-2">
                {searchQuery ? `No results for "${searchQuery}"` : "Try adjusting your filters"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {individualKarbonStatusGroups.map(({ status, items }) => {
                // Apply search filter, internal status filter, and sort by last updated
                const filteredItems = items
                  .filter(r => {
                    const matchesSearch = searchQuery === "" || 
                      r.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      r.preparer?.toLowerCase().includes(searchQuery.toLowerCase())
                    const matchesInternalStatus = internalStatusFilter === "all" || 
                      getInternalStatus(r) === internalStatusFilter
                    return matchesSearch && matchesInternalStatus
                  })
                  .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
                
                if (filteredItems.length === 0) return null
                
                return (
                  <Collapsible
                    key={status}
                    open={expandedSections.has(status)}
                    onOpenChange={() => toggleSection(status)}
                  >
                    <CollapsibleTrigger className="w-full">
                      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/50 hover:bg-muted transition-colors cursor-pointer">
                        <div className="flex items-center gap-3">
                          {expandedSections.has(status) ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="font-semibold">{status}</span>
                          <Badge variant="secondary" className="text-xs">
                            {filteredItems.length} {filteredItems.length === 1 ? "return" : "returns"}
                          </Badge>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-2 mt-2 ml-4 border-l-2 border-muted pl-4">
                        {filteredItems.map((taxReturn) => {
                          const entityDisplay = getEntityTypeDisplay(taxReturn.entityType)
                          return (
                            <div
                              key={taxReturn.id}
                              className="p-3 rounded-lg border bg-card hover:shadow-md transition-shadow cursor-pointer"
                              onClick={() => handleRowClick(taxReturn)}
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    {/* Entity type badge - prominent with color */}
                                    <Badge variant="outline" className={`text-xs font-bold shrink-0 ${entityDisplay.color}`}>
                                      {entityDisplay.label}
                                    </Badge>
                                    {taxReturn.isPriority && <Flag className="h-4 w-4 text-red-600 fill-red-600 shrink-0" />}
                                    <h3 className="font-semibold truncate">{taxReturn.clientName}</h3>
                                    {taxReturn.karbonUrl && (
                                      <a 
                                        href={taxReturn.karbonUrl} 
                                        target="_blank" 
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-muted-foreground hover:text-foreground"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                      </a>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      <span>Updated: {formatLastUpdated(taxReturn.lastUpdated)}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-3 w-3" />
                                      <span>Due: {taxReturn.dueDate ? new Date(taxReturn.dueDate).toLocaleDateString() : "Not set"}</span>
                                    </div>
                                    {taxReturn.assignedTo && (
                                      <div className="flex items-center gap-1">
                                        <User className="h-3 w-3" />
                                        <span>{taxReturn.assignedTo}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex flex-col items-end gap-1 shrink-0">
                                  {taxReturn.inQueue && (
                                    <Badge variant="outline" className="bg-purple-100 text-purple-700 border-purple-300 text-xs">
                                      In Queue
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          )}
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
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>Due: {new Date(taxReturn.dueDate).toLocaleDateString()}</span>
                        </div>
                        {taxReturn.totalTasks !== undefined && taxReturn.totalTasks > 0 && (
                          <div className="flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Tasks: {taxReturn.completedTasks}/{taxReturn.totalTasks}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden min-w-[100px]">
                            <div
                              className="h-full bg-primary transition-all"
                              style={{ width: `${taxReturn.progress}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{taxReturn.progress}%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span className={taxReturn.lastUpdatedByType === "client" ? "text-amber-600" : ""}>
                            Updated {formatLastUpdated(taxReturn.lastUpdated)} by {taxReturn.lastUpdatedByType === "client" ? "Client" : taxReturn.lastUpdatedBy}
                          </span>
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
                      {taxReturn.karbonStatus && (
                        <Badge variant="secondary" className="text-xs">
                          Karbon: {taxReturn.karbonStatus}
                        </Badge>
                      )}
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
                <DialogDescription className="flex items-center gap-3">
                  <span>{selectedReturn.entityType} - Tax Year {selectedReturn.taxYear}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                    Last updated {formatLastUpdated(selectedReturn.lastUpdated)} by{" "}
                    <span className={selectedReturn.lastUpdatedByType === "client" ? "text-amber-600 font-medium" : ""}>
                      {selectedReturn.lastUpdatedByType === "client" ? "Client" : selectedReturn.lastUpdatedBy}
                    </span>
                  </span>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {selectedReturn.karbonUrl && (
                  <div className="flex justify-end">
                    <a 
                      href={selectedReturn.karbonUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Open in Karbon
                    </a>
                  </div>
                )}

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
                        <option value="Tax Prep Queue">Tax Prep Queue (Unassigned)</option>
                        {teamMembers
                          .filter(member => member.is_active)
                          .map(member => (
                            <option key={member.id} value={member.full_name || member.email}>
                              {member.full_name || `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email}
                              {member.title ? ` - ${member.title}` : ''}
                            </option>
                          ))
                        }
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

                {/* Tasks Section */}
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Tasks from Karbon
                    {selectedTasks.length > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">
                        ({selectedTasks.filter(t => t.IsComplete).length}/{selectedTasks.length} completed)
                      </span>
                    )}
                  </h3>
                  {isLoadingDetails ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading tasks...
                    </div>
                  ) : selectedTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks found for this work item</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {selectedTasks.map((task) => (
                        <div 
                          key={task.TaskKey} 
                          className={`p-3 rounded-lg text-sm border ${
                            task.IsComplete 
                              ? "bg-green-50 border-green-200" 
                              : "bg-muted/50 border-muted"
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div className={`mt-0.5 ${task.IsComplete ? "text-green-600" : "text-muted-foreground"}`}>
                              {task.IsComplete ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : (
                                <Clock className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1">
                              <div className={`font-medium ${task.IsComplete ? "line-through text-muted-foreground" : ""}`}>
                                {task.Title}
                              </div>
                              {task.AssignedTo && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  Assigned to: {task.AssignedTo.FullName}
                                </div>
                              )}
                              {task.CompletedDate && (
                                <div className="text-xs text-green-600 mt-1">
                                  Completed: {new Date(task.CompletedDate).toLocaleDateString()}
                                </div>
                              )}
                              {task.DueDate && !task.IsComplete && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  Due: {new Date(task.DueDate).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes/Comments Section */}
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Comments & Notes from Karbon
                    {selectedNotes.length > 0 && (
                      <span className="text-xs font-normal text-muted-foreground">
                        ({selectedNotes.length})
                      </span>
                    )}
                  </h3>
                  {isLoadingDetails ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading notes...
                    </div>
                  ) : selectedNotes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No notes or comments found</p>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {selectedNotes.map((note) => (
                        <div key={note.NoteKey} className="p-3 bg-muted/50 rounded-lg text-sm border">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <User className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">
                                {note.Author?.FullName || "Unknown"}
                              </span>
                              {note.NoteType && (
                                <Badge variant="outline" className="text-xs">
                                  {note.NoteType}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {new Date(note.CreatedDate).toLocaleString()}
                            </span>
                          </div>
                          {note.Subject && (
                            <div className="font-medium mb-1">{note.Subject}</div>
                          )}
                          <div className="text-muted-foreground whitespace-pre-wrap">
                            {note.Body}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
