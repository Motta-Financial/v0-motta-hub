"use client"

/**
 * Clients list — unified view of contacts + organizations.
 *
 * Karbon bifurcates Contact / Organization, but the platform consolidates
 * them into a single "Client" surface. Each row exposes a normalized
 * `clientType` (Individual 1040, Partnership 1065, S-Corp 1120-S, etc.)
 * derived via `lib/client-type.ts`, so analysts can filter and sort by IRS
 * filing posture without having to remember which Karbon table the row
 * came from.
 *
 * Layout: header → KPI cards → filter bar → status tabs (All / Active /
 * Prospects) → searchable, sortable client table.
 */

import { useState, useEffect, useMemo, useRef } from "react"
import Link from "next/link"
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ChevronDown,
  RefreshCw,
  Search,
  TrendingUp,
  User,
  Users,
  X,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"
import {
  CLIENT_TYPE_FILTER_OPTIONS,
  clientTypeBadgeClass,
  getClientType,
  type ClientType,
  type ClientTypeCode,
} from "@/lib/client-type"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────────────────
// API row shapes
// ─────────────────────────────────────────────────────────────────────────────

interface OrganizationRow {
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

interface ContactRow {
  id: string
  karbon_contact_key: string
  full_name: string | null
  first_name: string | null
  last_name: string | null
  preferred_name: string | null
  entity_type: string | null
  contact_type: string | null
  primary_email: string | null
  phone_primary: string | null
  city: string | null
  state: string | null
  is_prospect: boolean | null
  avatar_url: string | null
}

interface ClientGroupRow {
  id: string
  karbon_client_group_key: string | null
  name: string
  group_type: string | null
}

interface ServiceLineRow {
  id: string
  name: string
  code: string | null
  category: string | null
  is_active: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Client row — what the table renders
// ─────────────────────────────────────────────────────────────────────────────

interface Client {
  id: string
  clientKey: string
  name: string
  family: "individual" | "business"
  clientType: ClientType
  entityType: string | null
  contactType: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  industry: string | null
  isProspect: boolean
  workItemCount: number
  activeWorkItems: number
  avatarUrl: string | null
  source: "contact" | "organization"
}

type SortKey = "name" | "type" | "active" | "total" | "location"
type SortDir = "asc" | "desc"
type StatusTab = "all" | "active" | "prospects"

// ─────────────────────────────────────────────────────────────────────────────
// Multi-select dropdown — reused for service lines, client groups, types
// ─────────────────────────────────────────────────────────────────────────────

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
  placeholder,
}: {
  label: string
  options: Array<{ value: string; label: string }>
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

  const toggle = (value: string) =>
    selected.includes(value)
      ? onChange(selected.filter((s) => s !== value))
      : onChange([...selected, value])

  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label || selected[0]
        : `${selected.length} selected`

  return (
    <div className="space-y-2" ref={dropdownRef}>
      <Label className="text-sm font-medium">{label}</Label>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-full justify-between h-9 bg-transparent"
            onClick={() => setOpen(!open)}
          >
            <span className={cn("truncate", !summary && "text-muted-foreground")}>
              {summary || placeholder}
            </span>
            <div className="flex items-center gap-1 ml-2 shrink-0">
              {selected.length > 0 && (
                <X
                  className="h-4 w-4 text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange([])
                  }}
                />
              )}
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[280px] max-h-[320px] overflow-y-auto" align="start">
          <div className="p-1">
            {options.map((opt) => (
              <button
                type="button"
                key={opt.value}
                className="flex items-center gap-2 w-full p-2 rounded hover:bg-muted cursor-pointer text-left"
                onClick={() => toggle(opt.value)}
              >
                <Checkbox checked={selected.includes(opt.value)} />
                <span className="text-sm flex-1 truncate">{opt.label}</span>
              </button>
            ))}
            {options.length === 0 && (
              <p className="text-sm text-muted-foreground p-2">No options available</p>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sort header — clickable column header with direction indicator
// ─────────────────────────────────────────────────────────────────────────────

function SortHeader({
  active,
  direction,
  onClick,
  className,
  children,
}: {
  active: boolean
  direction: SortDir
  onClick: () => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors",
        active && "text-foreground",
        className,
      )}
    >
      {children}
      {!active ? (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      ) : direction === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function ClientsList() {
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([])
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [clientGroups, setClientGroups] = useState<ClientGroupRow[]>([])
  const [serviceLines, setServiceLines] = useState<ServiceLineRow[]>([])
  const [workItemCounts, setWorkItemCounts] = useState<
    Map<string, { total: number; active: number }>
  >(new Map())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedServiceLines, setSelectedServiceLines] = useState<string[]>([])
  const [selectedClientGroups, setSelectedClientGroups] = useState<string[]>([])
  const [statusTab, setStatusTab] = useState<StatusTab>("active")

  const [sortKey, setSortKey] = useState<SortKey>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    void fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [orgsRes, contactsRes, groupsRes, serviceLinesRes, workItemsRes] = await Promise.all([
        fetch("/api/supabase/organizations"),
        fetch("/api/supabase/contacts"),
        fetch("/api/supabase/client-groups"),
        fetch("/api/supabase/service-lines"),
        fetch("/api/supabase/work-items/counts"),
      ])

      const [orgsData, contactsData, groupsData, serviceLinesData, workItemsData] =
        await Promise.all([
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

      const countsMap = new Map<string, { total: number; active: number }>()
      ;(workItemsData.counts || []).forEach((c: any) => {
        countsMap.set(c.clientKey, { total: c.total, active: c.active })
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
      const res = await fetch("/api/karbon/sync-fullnames", { method: "POST" })
      const result = await res.json()
      if (result.success) {
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

  // ── Build unified Client list ────────────────────────────────────────────
  const allClients = useMemo<Client[]>(() => {
    const orgClients: Client[] = organizations.map((org) => {
      const clientType = getClientType("organization", org.entity_type)
      return {
        id: org.id,
        clientKey: org.karbon_organization_key,
        name: org.full_name?.trim() || org.name?.trim() || "Unknown Organization",
        family: "business",
        clientType,
        entityType: org.entity_type,
        contactType: org.contact_type,
        email: org.primary_email,
        phone: org.phone,
        city: org.city,
        state: org.state,
        industry: org.industry,
        isProspect: (org.contact_type || "").toLowerCase().includes("prospect"),
        workItemCount: workItemCounts.get(org.karbon_organization_key)?.total || 0,
        activeWorkItems: workItemCounts.get(org.karbon_organization_key)?.active || 0,
        avatarUrl: null,
        source: "organization",
      }
    })

    const contactClients: Client[] = contacts.map((c) => {
      const clientType = getClientType("contact", c.entity_type)
      const name =
        c.full_name?.trim() ||
        [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
        c.preferred_name ||
        c.primary_email ||
        c.phone_primary ||
        "Unnamed Contact"
      return {
        id: c.id,
        clientKey: c.karbon_contact_key,
        name,
        family: "individual",
        clientType,
        entityType: c.entity_type,
        contactType: c.contact_type,
        email: c.primary_email,
        phone: c.phone_primary,
        city: c.city,
        state: c.state,
        industry: null,
        isProspect: !!c.is_prospect || (c.contact_type || "").toLowerCase().includes("prospect"),
        workItemCount: workItemCounts.get(c.karbon_contact_key)?.total || 0,
        activeWorkItems: workItemCounts.get(c.karbon_contact_key)?.active || 0,
        avatarUrl: c.avatar_url,
        source: "contact",
      }
    })

    return [...orgClients, ...contactClients]
  }, [organizations, contacts, workItemCounts])

  // ── Apply filters ────────────────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()

    return allClients.filter((client) => {
      // Status tab
      if (statusTab === "active" && client.isProspect) return false
      if (statusTab === "prospects" && !client.isProspect) return false

      // Search
      if (q) {
        const haystack = [client.name, client.email, client.city, client.state, client.entityType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }

      // Client type
      if (selectedTypes.length > 0 && !selectedTypes.includes(client.clientType.code)) return false

      // Service line / Client group filtering would require joining work items,
      // which we don't load on this page — left in the UI for filter-view
      // round-trips but applied as a no-op until those fields hydrate.
      void selectedServiceLines
      void selectedClientGroups
      return true
    })
  }, [allClients, searchQuery, statusTab, selectedTypes, selectedServiceLines, selectedClientGroups])

  // ── Apply sort ───────────────────────────────────────────────────────────
  const sortedClients = useMemo(() => {
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true })
    const arr = [...filteredClients]
    arr.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1
      switch (sortKey) {
        case "name":
          return collator.compare(a.name, b.name) * dir
        case "type":
          return collator.compare(a.clientType.label, b.clientType.label) * dir
        case "active":
          return (a.activeWorkItems - b.activeWorkItems) * dir
        case "total":
          return (a.workItemCount - b.workItemCount) * dir
        case "location":
          return (
            collator.compare(
              [a.city, a.state].filter(Boolean).join(", "),
              [b.city, b.state].filter(Boolean).join(", "),
            ) * dir
          )
      }
    })
    return arr
  }, [filteredClients, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir(key === "active" || key === "total" ? "desc" : "asc")
    }
  }

  // ── KPI counts ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const all = allClients
    const active = all.filter((c) => !c.isProspect)
    const prospects = all.filter((c) => c.isProspect)
    const businesses = active.filter((c) => c.family === "business")
    const individuals = active.filter((c) => c.family === "individual")
    const totalActiveWork = active.reduce((sum, c) => sum + c.activeWorkItems, 0)
    return {
      totalClients: all.length,
      activeClients: active.length,
      individuals: individuals.length,
      businesses: businesses.length,
      prospects: prospects.length,
      totalActiveWork,
    }
  }, [allClients])

  // ── Filter options ───────────────────────────────────────────────────────
  const typeOptions = useMemo(
    () =>
      CLIENT_TYPE_FILTER_OPTIONS.filter((o) =>
        allClients.some((c) => c.clientType.code === o.code),
      ).map((o) => ({ value: o.code, label: o.label })),
    [allClients],
  )

  const serviceLineOptions = useMemo(
    () =>
      serviceLines
        .filter((sl) => sl.is_active)
        .map((sl) => ({ value: sl.name, label: sl.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [serviceLines],
  )

  const clientGroupOptions = useMemo(
    () =>
      clientGroups
        .map((cg) => ({ value: cg.name, label: cg.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [clientGroups],
  )

  // ── View manager wiring ──────────────────────────────────────────────────
  const handleLoadView = (view: FilterView) => {
    if (view.filters.searchQuery !== undefined) setSearchQuery(view.filters.searchQuery)
    if (view.filters.serviceLines) setSelectedServiceLines(view.filters.serviceLines)
    if (view.filters.clientType) {
      // Legacy: clientType used to be a tab name (individuals/businesses/prospects).
      // Map prospects to the prospect tab; otherwise keep the active tab.
      if (view.filters.clientType === "prospects") setStatusTab("prospects")
      else setStatusTab("active")
    }
    if (view.filters.clientGroup) setSelectedClientGroups(view.filters.clientGroup)
    if ((view.filters as any).clientTypes) setSelectedTypes((view.filters as any).clientTypes)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    serviceLines: selectedServiceLines,
    clientType: statusTab,
    clientGroup: selectedClientGroups,
    clientTypes: selectedTypes,
  })

  const clearAllFilters = () => {
    setSearchQuery("")
    setSelectedTypes([])
    setSelectedServiceLines([])
    setSelectedClientGroups([])
  }

  const hasActiveFilters =
    searchQuery !== "" ||
    selectedTypes.length > 0 ||
    selectedServiceLines.length > 0 ||
    selectedClientGroups.length > 0

  // ─────────────────────────────────────────────────────────────────────────

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
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <p className="text-destructive font-medium">Failed to load clients</p>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button onClick={fetchData}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ═════ Header ═════ */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Clients</h1>
          <p className="text-muted-foreground mt-1">
            Unified view of all contacts and organizations from Karbon
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ViewManager type="clients" currentFilters={getCurrentFilters()} onLoadView={handleLoadView} />
          <Button onClick={syncFromKarbon} variant="outline" disabled={syncing}>
            <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
            {syncing ? "Syncing..." : "Sync Names"}
          </Button>
          <Button onClick={fetchData} variant="outline">
            Refresh
          </Button>
        </div>
      </div>

      {/* ═════ KPIs ═════ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard icon={Users} label="Total" value={kpis.totalClients} />
        <KpiCard icon={CheckCircle2} label="Active" value={kpis.activeClients} accent="primary" />
        <KpiCard icon={Building2} label="Businesses" value={kpis.businesses} />
        <KpiCard icon={User} label="Individuals" value={kpis.individuals} />
        <KpiCard
          icon={TrendingUp}
          label="Active Work"
          value={kpis.totalActiveWork}
          sub={`across ${kpis.activeClients} clients`}
        />
      </div>

      {/* ═════ Filter bar ═════ */}
      <Card className="bg-card shadow-sm border">
        <CardContent className="p-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by name, email, city, or entity type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-9"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MultiSelectDropdown
              label="Client Type"
              options={typeOptions}
              selected={selectedTypes}
              onChange={setSelectedTypes}
              placeholder="All types"
            />
            <MultiSelectDropdown
              label="Service Lines"
              options={serviceLineOptions}
              selected={selectedServiceLines}
              onChange={setSelectedServiceLines}
              placeholder="All service lines"
            />
            <MultiSelectDropdown
              label="Client Groups"
              options={clientGroupOptions}
              selected={selectedClientGroups}
              onChange={setSelectedClientGroups}
              placeholder="All client groups"
            />
          </div>

          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                Showing {sortedClients.length} of {allClients.length} clients
              </p>
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-7 text-xs">
                <X className="h-3 w-3 mr-1" />
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═════ Status tabs ═════ */}
      <div className="flex gap-2 border-b border-border">
        <StatusTabButton
          label="Active"
          count={kpis.activeClients}
          active={statusTab === "active"}
          onClick={() => setStatusTab("active")}
        />
        <StatusTabButton
          label="Prospects"
          count={kpis.prospects}
          active={statusTab === "prospects"}
          onClick={() => setStatusTab("prospects")}
        />
        <StatusTabButton
          label="All"
          count={kpis.totalClients}
          active={statusTab === "all"}
          onClick={() => setStatusTab("all")}
        />
      </div>

      {/* ═════ Client table ═════ */}
      <Card className="bg-card shadow-sm border">
        <CardContent className="p-0">
          {sortedClients.length === 0 ? (
            <div className="text-center py-16 px-4">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {hasActiveFilters
                  ? "No clients match the current filters."
                  : "No clients found in this view."}
              </p>
              {hasActiveFilters && (
                <Button variant="link" size="sm" onClick={clearAllFilters} className="mt-2">
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_180px_140px_100px_100px_60px] items-center gap-3 px-4 py-2.5 border-b bg-muted/30">
                <SortHeader
                  active={sortKey === "name"}
                  direction={sortDir}
                  onClick={() => toggleSort("name")}
                >
                  Client
                </SortHeader>
                <SortHeader
                  active={sortKey === "type"}
                  direction={sortDir}
                  onClick={() => toggleSort("type")}
                >
                  Client Type
                </SortHeader>
                <SortHeader
                  active={sortKey === "location"}
                  direction={sortDir}
                  onClick={() => toggleSort("location")}
                  className="hidden md:flex"
                >
                  Location
                </SortHeader>
                <SortHeader
                  active={sortKey === "active"}
                  direction={sortDir}
                  onClick={() => toggleSort("active")}
                  className="justify-end"
                >
                  Active
                </SortHeader>
                <SortHeader
                  active={sortKey === "total"}
                  direction={sortDir}
                  onClick={() => toggleSort("total")}
                  className="justify-end hidden sm:flex"
                >
                  Total
                </SortHeader>
                <span />
              </div>

              {/* Data rows */}
              <div className="divide-y">
                {sortedClients.map((client) => (
                  <Link
                    key={`${client.source}-${client.id}`}
                    href={`/clients/${client.clientKey}`}
                    className="grid grid-cols-[1fr_180px_140px_100px_100px_60px] items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                  >
                    {/* Name + avatar + email */}
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="h-9 w-9 shrink-0">
                        {client.avatarUrl && (
                          <AvatarImage src={client.avatarUrl || "/placeholder.svg"} alt={client.name} />
                        )}
                        <AvatarFallback
                          className={cn(
                            "text-xs font-semibold",
                            client.family === "business"
                              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                          )}
                        >
                          {client.family === "business" ? (
                            <Building2 className="h-4 w-4" />
                          ) : (
                            client.name
                              .split(" ")
                              .map((n) => n[0])
                              .filter(Boolean)
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{client.name}</span>
                          {client.isProspect && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1 border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300"
                            >
                              Prospect
                            </Badge>
                          )}
                        </div>
                        {client.email && (
                          <span className="text-xs text-muted-foreground truncate block">
                            {client.email}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Client type */}
                    <div className="min-w-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-xs font-medium",
                          clientTypeBadgeClass(client.clientType.variant),
                        )}
                      >
                        {client.clientType.labelWithForm}
                      </Badge>
                    </div>

                    {/* Location */}
                    <div className="text-xs text-muted-foreground truncate hidden md:block">
                      {[client.city, client.state].filter(Boolean).join(", ") || "—"}
                    </div>

                    {/* Active count */}
                    <div className="text-sm tabular-nums text-right">
                      {client.activeWorkItems > 0 ? (
                        <span className="font-medium text-foreground">{client.activeWorkItems}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>

                    {/* Total count */}
                    <div className="text-sm tabular-nums text-right text-muted-foreground hidden sm:block">
                      {client.workItemCount > 0 ? client.workItemCount : "—"}
                    </div>

                    {/* Affordance */}
                    <div className="text-muted-foreground text-right">
                      <ChevronDown className="h-4 w-4 -rotate-90 inline" />
                    </div>
                  </Link>
                ))}
              </div>

              {/* Footer count */}
              <div className="px-4 py-2.5 border-t text-xs text-muted-foreground bg-muted/20">
                Showing {sortedClients.length}{" "}
                {sortedClients.length === 1 ? "client" : "clients"}
                {hasActiveFilters && ` (filtered from ${allClients.length})`}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number | string
  sub?: string
  accent?: "primary"
}) {
  return (
    <Card className="bg-card shadow-sm border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p
              className={cn(
                "text-2xl font-bold mt-1",
                accent === "primary" ? "text-primary" : "text-foreground",
              )}
            >
              {value}
            </p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
          </div>
          <Icon
            className={cn(
              "h-7 w-7 shrink-0",
              accent === "primary" ? "text-primary" : "text-muted-foreground",
            )}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function StatusTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
        {count}
      </Badge>
    </button>
  )
}

// Keep the Client type exported in case other components need it.
export type { Client, ClientTypeCode }
