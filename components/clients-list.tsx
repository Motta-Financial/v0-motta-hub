"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Search,
  Users,
  TrendingUp,
  CheckCircle,
  ArrowRight,
  AlertCircle,
  Building2,
  User,
  ChevronDown,
  X,
  RefreshCw,
} from "lucide-react"
import Link from "next/link"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"
import { Label } from "@/components/ui/label"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

interface Organization {
  id: string
  karbon_organization_key: string
  name: string
  full_name: string | null
  entity_type: string | null
  contact_type: string | null
  industry: string | null
  primary_email: string | null
  phone: string | null
  city: string | null
  state: string | null
}

interface Contact {
  id: string
  karbon_contact_key: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  entity_type: string | null
  contact_type: string | null
  primary_email: string | null
  phone_primary: string | null
  city: string | null
  state: string | null
  is_prospect: boolean | null
  avatar_url: string | null // Added avatar_url to Contact interface
}

interface ClientGroup {
  id: string
  karbon_client_group_key: string | null
  name: string
  group_type: string | null
}

interface ServiceLine {
  id: string
  name: string
  code: string | null
  category: string | null
  is_active: boolean
}

// Combined client type for display
interface Client {
  id: string
  clientKey: string
  clientName: string
  clientType: "individual" | "business"
  clientGroup: string | null
  entityType: string | null
  contactType: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  isProspect: boolean
  workItemCount: number
  activeWorkItems: number
  lastActivity: string | null
  serviceLinesUsed: string[]
  avatarUrl: string | null
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const toggleOption = (option: string) => {
    if (selected.includes(option)) {
      onChange(selected.filter((s) => s !== option))
    } else {
      onChange([...selected, option])
    }
  }

  const clearAll = () => {
    onChange([])
  }

  return (
    <div className="space-y-2" ref={dropdownRef}>
      <Label className="text-sm font-medium">{label}</Label>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-auto min-h-9 py-2 bg-transparent"
            onClick={() => setOpen(!open)}
          >
            <div className="flex flex-wrap gap-1 flex-1 text-left">
              {selected.length === 0 ? (
                <span className="text-muted-foreground">{placeholder}</span>
              ) : selected.length <= 2 ? (
                selected.map((s) => (
                  <Badge key={s} variant="secondary" className="text-xs">
                    {s}
                  </Badge>
                ))
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {selected.length} selected
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 ml-2">
              {selected.length > 0 && (
                <X
                  className="h-4 w-4 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    clearAll()
                  }}
                />
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[300px] max-h-[300px] overflow-y-auto" align="start">
          <div className="p-2 space-y-1">
            {options.map((option) => (
              <div
                key={option}
                className="flex items-center space-x-2 p-2 rounded hover:bg-muted cursor-pointer"
                onClick={() => toggleOption(option)}
              >
                <Checkbox checked={selected.includes(option)} />
                <span className="text-sm">{option}</span>
              </div>
            ))}
            {options.length === 0 && <p className="text-sm text-muted-foreground p-2">No options available</p>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function ClientsList() {
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [clientGroups, setClientGroups] = useState<ClientGroup[]>([])
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>([])
  const [workItemCounts, setWorkItemCounts] = useState<Map<string, { total: number; active: number }>>(new Map())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedServiceLines, setSelectedServiceLines] = useState<string[]>([])
  const [selectedClientGroups, setSelectedClientGroups] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<"individuals" | "businesses" | "prospects">("businesses")
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({})
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)

      // Fetch from multiple Supabase tables in parallel
      const [orgsRes, contactsRes, groupsRes, serviceLinesRes, workItemsRes] = await Promise.all([
        fetch("/api/supabase/organizations"),
        fetch("/api/supabase/contacts"),
        fetch("/api/supabase/client-groups"),
        fetch("/api/supabase/service-lines"),
        fetch("/api/supabase/work-items/counts"),
      ])

      const [orgsData, contactsData, groupsData, serviceLinesData, workItemsData] = await Promise.all([
        orgsRes.ok ? orgsRes.json() : { organizations: [] },
        contactsRes.ok ? contactsRes.json() : { contacts: [] },
        groupsRes.ok ? groupsRes.json() : { clientGroups: [] },
        serviceLinesRes.ok ? serviceLinesRes.json() : { serviceLines: [] },
        workItemsRes.ok ? workItemsRes.json() : { counts: [] },
      ])

      setOrganizations(orgsData.organizations || [])
      setContacts(contactsData.contacts || [])
      setClientGroups(groupsData.clientGroups || [])
      setServiceLines(serviceLinesData.serviceLines || [])

      // Build work item counts map
      const countsMap = new Map<string, { total: number; active: number }>()
      ;(workItemsData.counts || []).forEach((count: any) => {
        countsMap.set(count.clientKey, { total: count.total, active: count.active })
      })
      setWorkItemCounts(countsMap)

      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data")
    } finally {
      setLoading(false)
    }
  }

  const syncFromKarbon = async () => {
    try {
      setSyncing(true)
      const response = await fetch("/api/karbon/sync-fullnames", {
        method: "POST",
      })
      const result = await response.json()

      if (result.success) {
        // Refresh data after sync
        await fetchData()
        alert(
          `Sync complete! Updated ${result.summary.contactsUpdated} contacts and ${result.summary.organizationsUpdated} organizations.`,
        )
      } else {
        alert(`Sync failed: ${result.error || "Unknown error"}`)
      }
    } catch (err) {
      alert(`Sync error: ${err instanceof Error ? err.message : "Unknown error"}`)
    } finally {
      setSyncing(false)
    }
  }

  const allClients: Client[] = [
    // Map organizations to clients (businesses)
    ...organizations.map((org) => ({
      id: org.id,
      clientKey: org.karbon_organization_key,
      clientName: org.full_name || org.name || "Unknown Organization",
      clientType: "business" as const,
      clientGroup: null,
      entityType: org.entity_type,
      contactType: org.contact_type,
      email: org.primary_email,
      phone: org.phone,
      city: org.city,
      state: org.state,
      isProspect: org.contact_type?.toLowerCase() === "prospect",
      workItemCount: workItemCounts.get(org.karbon_organization_key)?.total || 0,
      activeWorkItems: workItemCounts.get(org.karbon_organization_key)?.active || 0,
      lastActivity: null,
      serviceLinesUsed: [],
      avatarUrl: null,
    })),
    // Map contacts to clients (individuals)
    ...contacts.map((contact) => ({
      id: contact.id,
      clientKey: contact.karbon_contact_key,
      clientName:
        contact.full_name || `${contact.first_name || ""} ${contact.last_name || ""}`.trim() || "Unknown Contact",
      clientType: "individual" as const,
      clientGroup: null,
      entityType: contact.entity_type,
      contactType: contact.contact_type,
      email: contact.primary_email,
      phone: contact.phone_primary,
      city: contact.city,
      state: contact.state,
      isProspect: contact.is_prospect || contact.contact_type?.toLowerCase() === "prospect",
      workItemCount: workItemCounts.get(contact.karbon_contact_key)?.total || 0,
      activeWorkItems: workItemCounts.get(contact.karbon_contact_key)?.active || 0,
      lastActivity: null,
      serviceLinesUsed: [],
      avatarUrl: contact.avatar_url,
    })),
  ]

  // Filter clients
  const filteredClients = allClients.filter((client) => {
    const matchesSearch =
      searchQuery === "" ||
      client.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.email?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesServiceLine =
      selectedServiceLines.length === 0 || client.serviceLinesUsed.some((sl) => selectedServiceLines.includes(sl))

    const matchesClientGroup =
      selectedClientGroups.length === 0 || (client.clientGroup && selectedClientGroups.includes(client.clientGroup))

    return matchesSearch && matchesServiceLine && matchesClientGroup
  })

  const individualClients = filteredClients.filter((c) => c.clientType === "individual" && !c.isProspect)
  const businessClients = filteredClients.filter((c) => c.clientType === "business" && !c.isProspect)
  const prospectClients = filteredClients.filter((c) => c.isProspect)

  const displayedClients =
    activeTab === "individuals" ? individualClients : activeTab === "businesses" ? businessClients : prospectClients

  // Get unique values for filters
  const allServiceLineNames = serviceLines
    .filter((sl) => sl.is_active)
    .map((sl) => sl.name)
    .sort()
  const allClientGroupNames = clientGroups.map((cg) => cg.name).sort()

  const totalClients = allClients.length
  const activeIndividuals = individualClients.length
  const activeBusinesses = businessClients.length

  const handleLoadView = (view: FilterView) => {
    if (view.filters.searchQuery !== undefined) setSearchQuery(view.filters.searchQuery)
    if (view.filters.serviceLines) setSelectedServiceLines(view.filters.serviceLines)
    if (view.filters.clientType) {
      if (view.filters.clientType === "prospects") setActiveTab("prospects")
      else if (view.filters.clientType === "individuals") setActiveTab("individuals")
      else setActiveTab("businesses")
    }
    if (view.filters.clientGroup) setSelectedClientGroups(view.filters.clientGroup)
    if (view.filters.dateRange) setDateRange(view.filters.dateRange)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    serviceLines: selectedServiceLines,
    clientType: activeTab,
    clientGroup: selectedClientGroups,
    dateRange,
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
        </div>
        <div className="text-center py-12">
          <p className="text-muted-foreground">Loading clients...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
        </div>
        <Card className="bg-destructive/10 border-destructive/20">
          <CardContent className="p-6">
            <p className="text-destructive">{error}</p>
            <Button onClick={fetchData} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
          <p className="text-muted-foreground mt-1">Manage and view all client information</p>
        </div>
        <div className="flex gap-2">
          <ViewManager type="clients" currentFilters={getCurrentFilters()} onLoadView={handleLoadView} />
          <Button onClick={syncFromKarbon} variant="outline" disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync Names"}
          </Button>
          <Button onClick={fetchData} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="bg-card shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Clients</p>
                <p className="text-3xl font-bold text-foreground">{totalClients}</p>
              </div>
              <Users className="h-10 w-10 text-primary" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Individuals</p>
                <p className="text-3xl font-bold text-foreground">{activeIndividuals}</p>
              </div>
              <User className="h-10 w-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-sm border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Businesses</p>
                <p className="text-3xl font-bold text-foreground">{activeBusinesses}</p>
              </div>
              <Building2 className="h-10 w-10 text-green-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card shadow-sm border">
        <CardContent className="p-4">
          <div className="space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search clients by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-9"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MultiSelectDropdown
                label="Service Lines"
                options={allServiceLineNames}
                selected={selectedServiceLines}
                onChange={setSelectedServiceLines}
                placeholder="All Service Lines"
              />

              <MultiSelectDropdown
                label="Client Groups"
                options={allClientGroupNames}
                selected={selectedClientGroups}
                onChange={setSelectedClientGroups}
                placeholder="All Client Groups"
              />
            </div>

            {/* Date Range Filter */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Last Activity Date Range</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="date"
                  value={dateRange.start || ""}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="h-9 text-sm"
                  placeholder="Start date"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={dateRange.end || ""}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="h-9 text-sm"
                  placeholder="End date"
                />
                {(dateRange.start || dateRange.end) && (
                  <Button variant="ghost" size="sm" onClick={() => setDateRange({})} className="h-9">
                    Clear
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab("businesses")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "businesses"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Building2 className="h-4 w-4" />
          Businesses ({businessClients.length})
        </button>
        <button
          onClick={() => setActiveTab("individuals")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "individuals"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <User className="h-4 w-4" />
          Individuals ({individualClients.length})
        </button>
        <button
          onClick={() => setActiveTab("prospects")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === "prospects"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <TrendingUp className="h-4 w-4" />
          Prospects ({prospectClients.length})
        </button>
      </div>

      {/* Clients List */}
      <Card className="bg-card shadow-sm border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold text-foreground">
            {activeTab === "businesses"
              ? "Business Clients"
              : activeTab === "individuals"
                ? "Individual Clients"
                : "Prospect Clients"}{" "}
            ({displayedClients.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayedClients.length === 0 ? (
            <div className="text-center py-12">
              {activeTab === "businesses" ? (
                <>
                  <Building2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No business clients found matching your filters</p>
                </>
              ) : activeTab === "individuals" ? (
                <>
                  <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No individual clients found matching your filters</p>
                </>
              ) : (
                <>
                  <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">No prospect clients found matching your filters</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {displayedClients.map((client) => (
                <Link key={client.id} href={`/clients/${client.clientKey}`} className="block">
                  <div className="border rounded-lg p-4 hover:border-primary/50 hover:shadow-sm transition-all">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3 flex-1">
                        <Avatar className="h-10 w-10">
                          {client.avatarUrl && (
                            <AvatarImage src={client.avatarUrl || "/placeholder.svg"} alt={client.clientName} />
                          )}
                          <AvatarFallback
                            className={`${
                              client.clientType === "business"
                                ? "bg-green-100 text-green-700"
                                : "bg-blue-100 text-blue-700"
                            } text-sm font-semibold`}
                          >
                            {client.clientType === "business" ? (
                              <Building2 className="h-5 w-5" />
                            ) : (
                              client.clientName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()
                            )}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-foreground truncate">{client.clientName}</h3>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                client.clientType === "business"
                                  ? "border-green-200 text-green-700 bg-green-50"
                                  : "border-blue-200 text-blue-700 bg-blue-50"
                              }`}
                            >
                              {client.clientType === "business" ? "Business" : "Individual"}
                            </Badge>
                            {client.isProspect && (
                              <Badge variant="default" className="bg-yellow-100 text-yellow-700 text-xs">
                                Prospect
                              </Badge>
                            )}
                          </div>
                          {client.entityType && (
                            <p className="text-sm text-muted-foreground mb-1">{client.entityType}</p>
                          )}
                          {(client.city || client.state) && (
                            <p className="text-sm text-muted-foreground mb-2">
                              {[client.city, client.state].filter(Boolean).join(", ")}
                            </p>
                          )}
                          <div className="flex flex-wrap gap-2 mb-2">
                            {client.serviceLinesUsed.map((serviceLine) => (
                              <Badge key={serviceLine} variant="secondary" className="text-xs">
                                {serviceLine}
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <CheckCircle className="h-4 w-4" />
                              {client.workItemCount} work items
                            </span>
                            {client.activeWorkItems > 0 && (
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-4 w-4" />
                                {client.activeWorkItems} active
                              </span>
                            )}
                            {client.email && (
                              <span className="flex items-center gap-1 truncate max-w-[200px]">{client.email}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <ArrowRight className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-4" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
