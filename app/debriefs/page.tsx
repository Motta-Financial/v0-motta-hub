"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DashboardLayout } from "@/components/dashboard-layout"

import { format } from "date-fns"
import {
  Plus,
  Search,
  FileText,
  Calendar,
  User,
  Building2,
  Briefcase,
  AlertCircle,
  ExternalLink,
  Filter,
  RefreshCw,
  Eye,
  Loader2,
  Check,
  Pencil,
  X,
} from "lucide-react"
import { DebriefEditSheet } from "@/components/debriefs/debrief-edit-sheet"

interface TeamMemberRef {
  id: string
  full_name: string | null
  avatar_url?: string | null
  email?: string | null
}

interface Debrief {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  team_member_id: string | null
  team_member?: TeamMemberRef | null
  created_by_id: string | null
  created_by?: TeamMemberRef | null
  contact_id: string | null
  organization_id: string | null
  work_item_id: string | null
  client_manager_id: string | null
  client_owner_id: string | null
  // Display names — debriefs_full pre-joins these so we don't have to chase
  // FKs in the UI. organization_name is what was captured on the row at debrief
  // time; organization_display_name comes from the live organizations table.
  organization_name: string | null
  organization_display_name: string | null
  contact_full_name: string | null
  work_item_title: string | null
  work_item_client_name: string | null
  work_item_karbon_url: string | null
  status: string | null
  notes: string | null
  filing_status: string | null
  tax_year: number | null
  adjusted_gross_income: number | null
  taxable_income: number | null
  has_schedule_c: boolean | null
  has_schedule_e: boolean | null
  action_items: {
    items?: Array<{
      description: string
      assignee_name: string
      due_date: string | null
      priority: string
    }>
    team_member_name?: string
  } | null
  // karbon_work_url is the link the user manually pasted on the form (or that
  // we copied off the related work item at creation time).
  // work_item_karbon_url is the canonical URL on the joined work_items row.
  karbon_work_url: string | null
  created_at: string
  client_manager_name: string | null
  client_owner_name: string | null
  recurring_revenue: number | null
  follow_up_date: string | null
  contact?: { full_name: string } | null
  organization?: { name: string } | null
  work_item?: { title: string; karbon_work_item_key?: string } | null
}

interface TeamMember {
  id: string
  full_name: string
  email: string
  role?: string
  is_active: boolean
}

function getTeamMemberName(d: Debrief | null): string {
  if (!d) return "-"
  return d.team_member?.full_name || d.action_items?.team_member_name || d.created_by?.full_name || "-"
}

function getInitials(name: string | null) {
  if (!name) return "?"
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

export default function DebriefsPage() {
  const [debriefs, setDebriefs] = useState<Debrief[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [selectedDebrief, setSelectedDebrief] = useState<Debrief | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [editingTeamMember, setEditingTeamMember] = useState(false)
  const [pendingTeamMemberId, setPendingTeamMemberId] = useState<string>("")
  const [savingTeamMember, setSavingTeamMember] = useState(false)
  const [editingDebrief, setEditingDebrief] = useState<Debrief | null>(null)

  const fetchDebriefs = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/supabase/debriefs?limit=100")
      if (!response.ok) {
        throw new Error("Failed to fetch debriefs")
      }
      const data = await response.json()
      setDebriefs(data.debriefs || [])
    } catch (err) {
      console.error("Error fetching debriefs:", err)
      setError("Failed to load debriefs. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const fetchTeamMembers = async () => {
    try {
      const response = await fetch("/api/team-members")
      if (!response.ok) return
      const data = await response.json()
      setTeamMembers((data.team_members || []).filter((m: TeamMember) => m.is_active))
    } catch (err) {
      console.error("Error fetching team members:", err)
    }
  }

  useEffect(() => {
    fetchDebriefs()
    fetchTeamMembers()
  }, [])

  // Resolve the best display name for the client tied to this debrief.
  const resolveClientName = (d: Debrief) =>
    d.organization_display_name ||
    d.organization_name ||
    d.contact_full_name ||
    d.work_item_client_name ||
    null

  const resolveClientType = (d: Debrief): "organization" | "contact" | "unknown" => {
    if (d.organization_id || d.organization_display_name || d.organization_name) return "organization"
    if (d.contact_id || d.contact_full_name) return "contact"
    return "unknown"
  }

  // Prefer the canonical work_items.karbon_url over the user-pasted
  // karbon_work_url, falling back when older debriefs pre-date the join.
  const resolveKarbonWorkUrl = (d: Debrief) => d.work_item_karbon_url || d.karbon_work_url || null

  const filteredDebriefs = debriefs.filter((debrief) => {
    const memberName = getTeamMemberName(debrief).toLowerCase()
    const clientName = (resolveClientName(debrief) || "").toLowerCase()
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      !searchQuery ||
      clientName.includes(q) ||
      memberName.includes(q) ||
      debrief.organization_name?.toLowerCase().includes(q) ||
      debrief.notes?.toLowerCase().includes(q) ||
      debrief.debrief_type?.toLowerCase().includes(q) ||
      debrief.work_item_title?.toLowerCase().includes(q)

    const matchesType = typeFilter === "all" || debrief.debrief_type === typeFilter

    return matchesSearch && matchesType
  })

  const debriefTypes = Array.from(new Set(debriefs.map((d) => d.debrief_type).filter(Boolean))) as string[]

  const getTypeColor = (type: string | null) => {
    switch (type?.toLowerCase()) {
      case "tax planning":
        return "bg-blue-100 text-blue-800"
      case "onboarding":
        return "bg-green-100 text-green-800"
      case "meeting":
        return "bg-purple-100 text-purple-800"
      case "review":
        return "bg-orange-100 text-orange-800"
      default:
        return "bg-muted text-muted-foreground"
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return "-"
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  }

  const openDetails = (debrief: Debrief) => {
    setSelectedDebrief(debrief)
    setDetailsOpen(true)
    setEditingTeamMember(false)
    setPendingTeamMemberId(debrief.team_member_id || debrief.created_by_id || "")
  }

  const handleSaveTeamMember = async () => {
    if (!selectedDebrief || !pendingTeamMemberId) return
    setSavingTeamMember(true)
    try {
      const response = await fetch(`/api/debriefs/${selectedDebrief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_member_id: pendingTeamMemberId }),
      })
      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.error || "Failed to update team member")
      }
      const { debrief: updated } = await response.json()
      setSelectedDebrief(updated)
      setDebriefs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      setEditingTeamMember(false)
    } catch (err) {
      console.error("Error updating team member:", err)
      alert(err instanceof Error ? err.message : "Failed to update team member")
    } finally {
      setSavingTeamMember(false)
    }
  }

  return (
    <DashboardLayout>
      <div className="flex w-full flex-col gap-6">
        {/*
          Header: title + the "New Debrief" launcher. The new-debrief view
          opens in a separate browser tab so that submitting it never
          unmounts the search input on this page.
        */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Debriefs</h1>
            <p className="text-muted-foreground">Manage client meeting debriefs and notes</p>
          </div>
          <Button onClick={() => window.open("/debriefs/new", "_blank")} className="gap-2">
            <Plus className="h-4 w-4" />
            New Debrief
            <ExternalLink className="h-3 w-3 opacity-70" />
          </Button>
        </div>

        <Card className="w-full">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>All Debriefs</CardTitle>
                <CardDescription>
                  {filteredDebriefs.length} debrief{filteredDebriefs.length !== 1 ? "s" : ""} found
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={fetchDebriefs} disabled={loading}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col gap-4 pt-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by client, team member, or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <Filter className="mr-2 h-4 w-4" />
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {debriefTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between">
                  {error}
                  <Button variant="outline" size="sm" onClick={fetchDebriefs}>
                    Try Again
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {loading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-6 w-20" />
                  </div>
                ))}
              </div>
            ) : filteredDebriefs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No debriefs found</h3>
                <p className="text-sm text-muted-foreground">
                  {searchQuery || typeFilter !== "all"
                    ? "Try adjusting your filters"
                    : "Create a new debrief to get started"}
                </p>
                {!searchQuery && typeFilter === "all" && (
                  <Button
                    className="mt-4"
                    onClick={() => window.open("/debriefs/new", "_blank")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create Debrief
                    <ExternalLink className="h-3 w-3 ml-1 opacity-50" />
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Client / Organization</TableHead>
                      <TableHead>Karbon Work Item</TableHead>
                      <TableHead>Team Member</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="min-w-[18rem]">Notes</TableHead>
                      <TableHead>Action Items</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDebriefs.map((debrief) => {
                      const clientName = resolveClientName(debrief)
                      const clientType = resolveClientType(debrief)
                      const karbonWorkUrl = resolveKarbonWorkUrl(debrief)
                      const memberName = getTeamMemberName(debrief)
                      return (
                        <TableRow
                          key={debrief.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDetails(debrief)}
                        >
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {debrief.debrief_date
                                ? format(new Date(debrief.debrief_date), "MMM d, yyyy")
                                : "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {clientType === "organization" ? (
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                              ) : clientType === "contact" ? (
                                <User className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <User className="h-4 w-4 text-muted-foreground/60" />
                              )}
                              <span className="font-medium">{clientName || "Unmapped"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {debrief.work_item_title || karbonWorkUrl ? (
                              <div className="flex items-center gap-1">
                                <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
                                {karbonWorkUrl ? (
                                  <a
                                    href={karbonWorkUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="line-clamp-1 max-w-[16rem] text-sm text-primary underline-offset-2 hover:underline"
                                    title={debrief.work_item_title || karbonWorkUrl}
                                  >
                                    {debrief.work_item_title || "Open in Karbon"}
                                  </a>
                                ) : (
                                  <span className="line-clamp-1 max-w-[16rem] text-sm">
                                    {debrief.work_item_title}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                {debrief.team_member?.avatar_url && (
                                  <AvatarImage src={debrief.team_member.avatar_url} alt={memberName} />
                                )}
                                <AvatarFallback className="text-xs">
                                  {getInitials(memberName)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="whitespace-nowrap">{memberName}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {debrief.debrief_type && (
                              <Badge variant="secondary" className={getTypeColor(debrief.debrief_type)}>
                                {debrief.debrief_type}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-md">
                            {debrief.notes ? (
                              <p className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                                {debrief.notes}
                              </p>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {debrief.action_items?.items?.length ? (
                              <Badge variant="outline">
                                {debrief.action_items.items.length} item
                                {debrief.action_items.items.length !== 1 ? "s" : ""}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                openDetails(debrief)
                              }}
                              title="View details"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingDebrief(debrief)
                              }}
                              title="Edit debrief"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {karbonWorkUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  window.open(karbonWorkUrl, "_blank")
                                }}
                                title="Open in Karbon"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Debrief Details Dialog */}
        <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Debrief Details
              </DialogTitle>
              <DialogDescription>
                {selectedDebrief?.debrief_date
                  ? format(new Date(selectedDebrief.debrief_date), "MMMM d, yyyy")
                  : "No date"}
                {selectedDebrief && resolveClientName(selectedDebrief)
                  ? ` - ${resolveClientName(selectedDebrief)}`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            {selectedDebrief && (
              <div className="space-y-6">
                {/* Basic Info */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-muted-foreground">Team Member</p>
                      {!editingTeamMember && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => {
                            setEditingTeamMember(true)
                            setPendingTeamMemberId(
                              selectedDebrief.team_member_id || selectedDebrief.created_by_id || "",
                            )
                          }}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                      )}
                    </div>
                    {editingTeamMember ? (
                      <div className="flex items-center gap-2">
                        <Select value={pendingTeamMemberId} onValueChange={setPendingTeamMemberId}>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder="Select team member" />
                          </SelectTrigger>
                          <SelectContent>
                            {teamMembers.map((tm) => (
                              <SelectItem key={tm.id} value={tm.id}>
                                {tm.full_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          onClick={handleSaveTeamMember}
                          disabled={savingTeamMember || !pendingTeamMemberId}
                        >
                          {savingTeamMember ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingTeamMember(false)}
                          disabled={savingTeamMember}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <p className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          {selectedDebrief.team_member?.avatar_url && (
                            <AvatarImage
                              src={selectedDebrief.team_member.avatar_url}
                              alt={getTeamMemberName(selectedDebrief)}
                            />
                          )}
                          <AvatarFallback className="text-xs">
                            {getInitials(getTeamMemberName(selectedDebrief))}
                          </AvatarFallback>
                        </Avatar>
                        {getTeamMemberName(selectedDebrief)}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Debrief Type</p>
                    <p>
                      {selectedDebrief.debrief_type && (
                        <Badge variant="secondary" className={getTypeColor(selectedDebrief.debrief_type)}>
                          {selectedDebrief.debrief_type}
                        </Badge>
                      )}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Client Manager</p>
                    <p>{selectedDebrief.client_manager_name || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">Client Owner</p>
                    <p>{selectedDebrief.client_owner_name || "-"}</p>
                  </div>
                </div>

                {/* Tax Info */}
                {(selectedDebrief.tax_year ||
                  selectedDebrief.filing_status ||
                  selectedDebrief.adjusted_gross_income) && (
                  <div>
                    <h4 className="mb-3 font-semibold">Tax Information</h4>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Tax Year</p>
                        <p>{selectedDebrief.tax_year || "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Filing Status</p>
                        <p>{selectedDebrief.filing_status || "-"}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">AGI</p>
                        <p>{formatCurrency(selectedDebrief.adjusted_gross_income)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Taxable Income</p>
                        <p>{formatCurrency(selectedDebrief.taxable_income)}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Schedule C</p>
                        <p>{selectedDebrief.has_schedule_c ? "Yes" : "No"}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Schedule E</p>
                        <p>{selectedDebrief.has_schedule_e ? "Yes" : "No"}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedDebrief.notes && (
                  <div>
                    <h4 className="mb-3 font-semibold">Notes</h4>
                    <p className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
                      {selectedDebrief.notes}
                    </p>
                  </div>
                )}

                {/* Action Items */}
                {selectedDebrief.action_items?.items && selectedDebrief.action_items.items.length > 0 && (
                  <div>
                    <h4 className="mb-3 font-semibold">
                      Action Items ({selectedDebrief.action_items.items.length})
                    </h4>
                    <div className="space-y-2">
                      {selectedDebrief.action_items.items.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 rounded-lg border p-3">
                          <Briefcase className="mt-0.5 h-4 w-4 text-muted-foreground" />
                          <div className="flex-1">
                            <p className="font-medium">{item.description}</p>
                            <div className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                              {item.assignee_name && (
                                <span className="flex items-center gap-1">
                                  <User className="h-3 w-3" />
                                  {item.assignee_name}
                                </span>
                              )}
                              {item.due_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {format(new Date(item.due_date), "MMM d, yyyy")}
                                </span>
                              )}
                              {item.priority && (
                                <Badge
                                  variant="outline"
                                  className={
                                    item.priority === "high"
                                      ? "border-red-200 text-red-700"
                                      : item.priority === "medium"
                                        ? "border-yellow-200 text-yellow-700"
                                        : "border-green-200 text-green-700"
                                  }
                                >
                                  {item.priority}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Follow-up */}
                {selectedDebrief.follow_up_date && (
                  <div>
                    <h4 className="mb-3 font-semibold">Follow-up Date</h4>
                    <p className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {format(new Date(selectedDebrief.follow_up_date), "MMMM d, yyyy")}
                    </p>
                  </div>
                )}

                {/* Karbon Work Item */}
                {(selectedDebrief.work_item_title || resolveKarbonWorkUrl(selectedDebrief)) && (
                  <div className="border-t pt-4">
                    <h4 className="mb-2 font-semibold">Karbon Work Item</h4>
                    <div className="flex flex-wrap items-center gap-3">
                      {selectedDebrief.work_item_title && (
                        <span className="flex items-center gap-2 text-sm">
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                          {selectedDebrief.work_item_title}
                        </span>
                      )}
                      {resolveKarbonWorkUrl(selectedDebrief) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(resolveKarbonWorkUrl(selectedDebrief)!, "_blank")
                          }
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open in Karbon
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {/* Edit shortcut */}
                <div className="flex justify-end border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingDebrief(selectedDebrief)
                      setDetailsOpen(false)
                    }}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit Debrief
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <DebriefEditSheet
          debrief={editingDebrief as any}
          open={!!editingDebrief}
          onOpenChange={(o) => {
            if (!o) setEditingDebrief(null)
          }}
          onSaved={() => {
            // Re-fetch the list so the table reflects the new mapping/notes/etc.
            fetchDebriefs()
          }}
        />
      </div>
    </DashboardLayout>
  )
}
