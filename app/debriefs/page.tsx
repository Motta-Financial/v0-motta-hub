"use client"

import { useState, useEffect, Suspense } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DebriefForm } from "@/components/debrief-form"
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
} from "lucide-react"

interface Debrief {
  id: string
  debrief_date: string | null
  debrief_type: string | null
  team_member: string | null
  organization_name: string | null
  contact_id: string | null
  organization_id: string | null
  work_item_id: string | null
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
  } | null
  karbon_work_url: string | null
  created_at: string
  created_by_id: string | null
  client_manager_name: string | null
  client_owner_name: string | null
  recurring_revenue: number | null
  follow_up_date: string | null
}

function DebriefFormWrapper() {
  return <DebriefForm />
}

export default function DebriefsPage() {
  const [activeTab, setActiveTab] = useState("all")
  const [debriefs, setDebriefs] = useState<Debrief[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [selectedDebrief, setSelectedDebrief] = useState<Debrief | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

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

  useEffect(() => {
    fetchDebriefs()
  }, [])

  // Filter debriefs based on search and type
  const filteredDebriefs = debriefs.filter((debrief) => {
    const matchesSearch =
      !searchQuery ||
      debrief.organization_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debrief.team_member?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debrief.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      debrief.debrief_type?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesType = typeFilter === "all" || debrief.debrief_type === typeFilter

    return matchesSearch && matchesType
  })

  // Get unique debrief types for filter
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

  const getInitials = (name: string | null) => {
    if (!name) return "?"
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
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
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Debriefs</h1>
          <p className="text-muted-foreground">Manage client meeting debriefs and notes</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="all" className="gap-2">
            <FileText className="h-4 w-4" />
            All Debriefs
          </TabsTrigger>
          <TabsTrigger value="new" className="gap-2">
            <Plus className="h-4 w-4" />
            New Debrief
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-6">
          <Card>
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
                    <Button className="mt-4" onClick={() => setActiveTab("new")}>
                      <Plus className="mr-2 h-4 w-4" />
                      Create Debrief
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Team Member</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Tax Year</TableHead>
                        <TableHead>Action Items</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDebriefs.map((debrief) => (
                        <TableRow
                          key={debrief.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => openDetails(debrief)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {debrief.debrief_date ? format(new Date(debrief.debrief_date), "MMM d, yyyy") : "-"}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {debrief.organization_id ? (
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <User className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="font-medium">{debrief.organization_name || "-"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6">
                                <AvatarFallback className="text-xs">{getInitials(debrief.team_member)}</AvatarFallback>
                              </Avatar>
                              <span>{debrief.team_member || "-"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {debrief.debrief_type && (
                              <Badge variant="secondary" className={getTypeColor(debrief.debrief_type)}>
                                {debrief.debrief_type}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{debrief.tax_year || "-"}</TableCell>
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
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {debrief.karbon_work_url && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  window.open(debrief.karbon_work_url!, "_blank")
                                }}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" className="mt-6">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <DebriefFormWrapper />
          </Suspense>
        </TabsContent>
      </Tabs>

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
              {selectedDebrief?.organization_name && ` - ${selectedDebrief.organization_name}`}
            </DialogDescription>
          </DialogHeader>

          {selectedDebrief && (
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Team Member</p>
                  <p className="flex items-center gap-2">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-xs">{getInitials(selectedDebrief.team_member)}</AvatarFallback>
                    </Avatar>
                    {selectedDebrief.team_member || "-"}
                  </p>
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
              {(selectedDebrief.tax_year || selectedDebrief.filing_status || selectedDebrief.adjusted_gross_income) && (
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
                  <p className="whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">{selectedDebrief.notes}</p>
                </div>
              )}

              {/* Action Items */}
              {selectedDebrief.action_items?.items && selectedDebrief.action_items.items.length > 0 && (
                <div>
                  <h4 className="mb-3 font-semibold">Action Items ({selectedDebrief.action_items.items.length})</h4>
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

              {/* Karbon Link */}
              {selectedDebrief.karbon_work_url && (
                <div className="pt-4 border-t">
                  <Button variant="outline" onClick={() => window.open(selectedDebrief.karbon_work_url!, "_blank")}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open in Karbon
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
