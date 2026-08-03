"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Mail,
  Phone,
  MapPin,
  Calendar,
  Search,
  Users,
  Briefcase,
  Shield,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Building2,
  Network,
  Sparkles,
  FileText,
} from "lucide-react"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { OrgChart } from "@/components/org-chart"
import { Bot, Lock } from "lucide-react"
import { isAlfredServiceAccount } from "@/lib/alfred/service-account"
import { findHeroProfile, findHeroProfileBySlug, type HeroProfile } from "@/lib/motta-alliance/hero-profiles"

interface TeamMember {
  id: string
  first_name: string
  last_name: string
  full_name: string
  email: string
  title?: string
  role?: string
  department?: string
  phone_number?: string
  mobile_number?: string
  avatar_url?: string
  timezone?: string
  start_date?: string
  manager_id?: string
  is_active: boolean
  // Set TRUE on the single ALFRED row (lib/alfred/service-account.ts).
  // Database trigger trg_team_members_protect_service_account guarantees
  // this row cannot be deactivated or deleted.
  is_service_account?: boolean
  karbon_user_key?: string
  created_at?: string
  updated_at?: string
  // Slug linking to a hero profile in HERO_PROFILES array. When set,
  // we use findHeroProfileBySlug for direct lookup instead of the
  // fuzzy name-based matching.
  hero_profile_slug?: string
}

interface SyncResult {
  success: boolean
  synced: number
  updated: number
  created: number
  errors: number
  total: number
  errorDetails?: string[]
}

export function Teammates() {
  const [users, setUsers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [departmentFilter, setDepartmentFilter] = useState<string>("all")
  // Active hero profile to render in the modal. `null` when no card has
  // been clicked. We resolve the comic-book hero from the teammate row
  // by name + aliases (see lib/motta-alliance/hero-profiles.ts) so
  // adding a new profile is one entry in that registry — no changes
  // here.
  const [activeHero, setActiveHero] = useState<HeroProfile | null>(null)

  // Tax return counts keyed by team_member_id. Loaded in parallel with
  // the directory fetch from /api/team-members/tax-return-counts (which
  // joins proconnect_profiles → proconnect_engagements). Teammates with
  // no linked ProConnect profile simply won't appear here, so the card
  // hides the badge instead of rendering "0" — operators map preparers
  // at /tax/settings.
  const [taxCounts, setTaxCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchUsers()
    fetchTaxCounts()
  }, [])

  const fetchUsers = async () => {
    try {
      // The directory only renders ACTIVE team members. The default
      // /api/team-members response already filters is_active=true and
      // excludes system "Company" accounts (Motta Financial, Karbon HQ),
      // so a plain GET returns exactly what we want here.
      const response = await fetch("/api/team-members")
      if (!response.ok) throw new Error("Failed to fetch users")
      const data = await response.json()
      const usersArray = data.team_members || data.teamMembers || []
      setUsers(usersArray)
    } catch (error) {
      console.error("Error fetching users:", error)
      setUsers([])
    } finally {
      setLoading(false)
    }
  }

  // Pulls per-teammate ProConnect engagement counts. Failure is
  // non-fatal — the directory still renders, just without the badge.
  const fetchTaxCounts = async () => {
    try {
      const response = await fetch("/api/team-members/tax-return-counts")
      if (!response.ok) return
      const data = await response.json()
      const map: Record<string, number> = {}
      for (const row of data.counts || []) {
        if (row?.team_member_id) {
          map[row.team_member_id] = row.total ?? 0
        }
      }
      setTaxCounts(map)
    } catch (error) {
      console.error("Error fetching tax return counts:", error)
    }
  }

  const syncFromKarbon = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const response = await fetch("/api/karbon/users?import=true")
      if (!response.ok) throw new Error("Failed to sync users")
      const data = await response.json()
      if (data.importResult) {
        setSyncResult(data.importResult)
      }
      await fetchUsers()
    } catch (error) {
      console.error("Error syncing users:", error)
      setSyncResult({
        success: false,
        synced: 0,
        updated: 0,
        created: 0,
        errors: 1,
        total: 0,
        errorDetails: [error instanceof Error ? error.message : "Unknown error"],
      })
    } finally {
      setSyncing(false)
    }
  }

  const departments = Array.from(new Set(users.map((u) => u.department).filter(Boolean))) as string[]

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesDepartment = departmentFilter === "all" || user.department === departmentFilter

    return matchesSearch && matchesDepartment
  })

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
  }

  const handleLoadView = (view: FilterView) => {
    if (view.filters.searchQuery) setSearchQuery(view.filters.searchQuery)
    if (view.filters.department) setDepartmentFilter(view.filters.department)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    department: departmentFilter,
  })

  const totalCount = users.length
  const departmentCount = departments.length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading teammates...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Team Members</h1>
          <p className="text-gray-600 mt-2">Motta Financial team directory & org chart</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={syncFromKarbon} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Sync from Karbon"}
          </Button>
          <ViewManager type="teammates" currentFilters={getCurrentFilters()} onLoadView={handleLoadView} />
        </div>
      </div>

      {syncResult && (
        <Alert variant={syncResult.success ? "default" : "destructive"}>
          {syncResult.success ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          <AlertTitle>{syncResult.success ? "Sync Complete" : "Sync Had Errors"}</AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-1">
              <p>Total from Karbon: {syncResult.total} users</p>
              <p>
                Updated: {syncResult.updated} | Created: {syncResult.created} | Errors: {syncResult.errors}
              </p>
              {syncResult.errorDetails && syncResult.errorDetails.length > 0 && (
                <div className="mt-2 text-sm">
                  <p className="font-medium">Error details:</p>
                  <ul className="list-disc list-inside">
                    {syncResult.errorDetails.slice(0, 5).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Members</p>
                <p className="text-2xl font-bold">{totalCount}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Departments</p>
                <p className="text-2xl font-bold">{departmentCount}</p>
              </div>
              <Building2 className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="directory" className="space-y-4">
        <TabsList>
          <TabsTrigger value="directory" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Directory
          </TabsTrigger>
          <TabsTrigger value="org-chart" className="flex items-center gap-2">
            <Network className="h-4 w-4" />
            Org Chart
          </TabsTrigger>
        </TabsList>

        <TabsContent value="directory">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Team Directory
                  </CardTitle>
                  <CardDescription>
                    {filteredUsers.length} of {totalCount} team members
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="mb-6 space-y-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search by name, email, title, department, or role..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                {departments.length > 0 && (
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger>
                      <Briefcase className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Filter by department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Departments</SelectItem>
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept}>
                          {dept}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* User Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredUsers.map((user) => {
                  // Per-row guard. The database trigger is the source of
                  // truth, but we surface it in the UI so admins immediately
                  // see why deactivate-style controls (when they exist) are
                  // disabled on this row.
                  const isAlfred = isAlfredServiceAccount(user)
                  // Resolve the comic-book hero profile (if any) for this
                  // teammate. Returns null when the teammate hasn't been
                  // comic-ified yet — we just skip the action in that case
                  // so the card stays clean.
                  // Primary: lookup by hero_profile_slug (direct DB link)
                  // Fallback: name-based matching for backward compatibility
                  const heroProfile = user.hero_profile_slug
                    ? findHeroProfileBySlug(user.hero_profile_slug)
                    : findHeroProfile(user.full_name)
                  // Tax-return count from /api/team-members/tax-return-counts.
                  // `undefined` = teammate has no linked ProConnect profile
                  // (admin hasn't mapped them at /tax/settings yet) — we
                  // hide the row entirely rather than render a misleading
                  // "0". `0` = mapped, but no engagements assigned.
                  const taxReturnCount = taxCounts[user.id]
                  return (
                  <Card
                    key={user.id}
                    className={`hover:shadow-md transition-shadow ${
                      isAlfred
                        ? "border-primary/40 bg-primary/[0.03]"
                        : heroProfile
                          ? "border-[#A8C566]/40"
                          : ""
                    }`}
                  >
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <Avatar className="h-14 w-14">
                          <AvatarImage src={user.avatar_url || "/placeholder.svg"} alt={user.full_name} />
                          <AvatarFallback className={`text-lg ${
                            isAlfred
                              ? "bg-primary text-primary-foreground"
                              : "bg-gradient-to-br from-blue-500 to-purple-600 text-white"
                          }`}>
                            {isAlfred ? <Bot className="h-6 w-6" /> : getInitials(user.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 truncate">{user.full_name}</h3>
                            {isAlfred && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] uppercase tracking-wide gap-1"
                                title={
                                  "ALFRED is the AI assistant service account. " +
                                  "It cannot be deactivated, renamed, or deleted. " +
                                  "Enforced by trg_team_members_protect_service_account."
                                }
                              >
                                <Lock className="h-3 w-3" />
                                Service Account
                              </Badge>
                            )}
                          </div>
                          {user.title && <p className="text-sm text-gray-600 truncate mt-1">{user.title}</p>}
                          {user.department && (
                            <p className="text-xs text-gray-500 truncate mt-1 flex items-center gap-1">
                              <Briefcase className="h-3 w-3" />
                              {user.department}
                            </p>
                          )}
                          {user.role && (
                            <p className="text-xs text-gray-500 truncate mt-1 flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              {user.role}
                            </p>
                          )}
                          {taxReturnCount !== undefined && (
                            <p
                              className="text-xs text-gray-500 truncate mt-1 flex items-center gap-1"
                              title="Tax returns assigned to this preparer in ProConnect (all years)"
                            >
                              <FileText className="h-3 w-3" />
                              {taxReturnCount.toLocaleString()} tax return
                              {taxReturnCount === 1 ? "" : "s"}
                            </p>
                          )}
                          <div className="mt-3 space-y-2">
                            <a
                              href={`mailto:${user.email}`}
                              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                            >
                              <Mail className="h-4 w-4 flex-shrink-0" />
                              <span className="truncate">{user.email}</span>
                            </a>
                            {(user.phone_number || user.mobile_number) && (
                              <a
                                href={`tel:${user.phone_number || user.mobile_number}`}
                                className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                              >
                                <Phone className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate">{user.phone_number || user.mobile_number}</span>
                              </a>
                            )}
                            {user.timezone && (
                              <div className="flex items-center gap-2 text-sm text-gray-600">
                                <MapPin className="h-4 w-4 flex-shrink-0" />
                                <span className="truncate">{user.timezone}</span>
                              </div>
                            )}
                            {user.start_date && (
                              <div className="flex items-center gap-2 text-xs text-gray-500">
                                <Calendar className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">
                                  Started {new Date(user.start_date).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </div>
                          {/* "View Hero Profile" call-to-action — only
                              rendered when this teammate has been
                              comic-ified. Clicking sets `activeHero`,
                              which opens the full-page profile Dialog
                              below. We keep the button understated so
                              it reads as a fun easter egg rather than a
                              primary action on the directory card. */}
                          {heroProfile && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-4 w-full border-[#A8C566]/60 text-[#5b7028] hover:bg-[#A8C566]/10 hover:text-[#3f5018] bg-transparent"
                              onClick={() => setActiveHero(heroProfile)}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-2" />
                              View Hero Profile
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  )
                })}
              </div>

              {filteredUsers.length === 0 && (
                <div className="text-center py-12">
                  <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No team members found matching your filters.</p>
                  <Button
                    variant="outline"
                    className="mt-4 bg-transparent"
                    onClick={syncFromKarbon}
                    disabled={syncing}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                    Sync from Karbon
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="org-chart">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5" />
                Organizational Chart
              </CardTitle>
              <CardDescription>
                Reporting structure across {totalCount} active team members
              </CardDescription>
            </CardHeader>
            <CardContent>
              <OrgChart members={users} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Hero Profile Modal
          ──────────────────────────────────────────────────────────
          Renders the full comic-book profile PNG for the currently
          selected hero. Open state is derived from `activeHero` so
          there's a single source of truth — closing the dialog
          (Escape / outside-click / close button) clears it.

          Layout notes:
            • Max-width is generous (4xl) because these images are
              tall portraits with a lot of detail.
            • We use `next/image` semantics via plain <img> here
              because the asset lives on Vercel Blob with arbitrary
              dimensions — the parent container constrains size and
              `object-contain` keeps the aspect ratio intact.
            • `DialogTitle` is visually hidden but kept for a11y; the
              alias is rendered as a visible heading below the image
              meta strip. */}
      <Dialog
        open={!!activeHero}
        onOpenChange={(open) => {
          if (!open) setActiveHero(null)
        }}
      >
        <DialogContent className="max-w-4xl p-0 overflow-hidden bg-zinc-950 border-zinc-800">
          <DialogTitle className="sr-only">
            {activeHero ? `${activeHero.name} — ${activeHero.alias}` : "Hero Profile"}
          </DialogTitle>
          {activeHero && (
            <div className="flex flex-col">
              {/* Meta strip — alias + role + signature quote, sits
                  above the comic page so the user knows who they're
                  about to see before the image finishes loading. */}
              <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-[#A8C566]" />
                  <p className="text-xs uppercase tracking-[0.2em] text-[#A8C566] font-semibold">
                    Motta Alliance · Hero Profile
                  </p>
                </div>
                <h2 className="text-2xl font-bold text-zinc-50 text-balance">
                  {activeHero.name}
                </h2>
                <p className="text-lg text-zinc-300 mt-1">{activeHero.alias}</p>
                <p className="text-sm text-zinc-400 mt-2">{activeHero.role}</p>
                <p className="text-sm italic text-zinc-500 mt-3 text-pretty">
                  &ldquo;{activeHero.quote}&rdquo;
                </p>
              </div>
              {/* The profile page itself. Constrained to ~80vh so it
                  remains scrollable on shorter viewports without
                  forcing the modal off-screen. */}
              <div className="bg-zinc-900 max-h-[80vh] overflow-y-auto">
                <img
                  src={activeHero.imageUrl || "/placeholder.svg"}
                  alt={`${activeHero.name} — ${activeHero.alias} hero profile page`}
                  className="w-full h-auto object-contain"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
