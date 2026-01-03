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
  Filter,
  Briefcase,
  Shield,
  RefreshCw,
  CheckCircle,
  AlertCircle,
} from "lucide-react"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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
  karbon_user_key?: string
  created_at?: string
  updated_at?: string
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
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [departmentFilter, setDepartmentFilter] = useState<string>("all")

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
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
      await fetchUsers() // Refresh the list after sync
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

  // Get unique departments for filters
  const departments = Array.from(new Set(users.map((u) => u.department).filter(Boolean))) as string[]

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.role?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? user.is_active : !user.is_active)

    const matchesDepartment = departmentFilter === "all" || user.department === departmentFilter

    return matchesSearch && matchesStatus && matchesDepartment
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
    if (view.filters.userStatus) setStatusFilter(view.filters.userStatus)
    if (view.filters.department) setDepartmentFilter(view.filters.department)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    userStatus: statusFilter,
    department: departmentFilter,
  })

  // Count linked vs unlinked
  const linkedCount = users.filter((u) => u.karbon_user_key).length
  const unlinkedCount = users.filter((u) => !u.karbon_user_key).length

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
          <p className="text-gray-600 mt-2">Motta Financial team directory</p>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Members</p>
                <p className="text-2xl font-bold">{users.length}</p>
              </div>
              <Users className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Karbon Linked</p>
                <p className="text-2xl font-bold text-green-600">{linkedCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Not Linked</p>
                <p className="text-2xl font-bold text-amber-600">{unlinkedCount}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Team Directory
              </CardTitle>
              <CardDescription>
                {filteredUsers.length} of {users.length} team members
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select value={statusFilter} onValueChange={(value: any) => setStatusFilter(value)}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="active">Active Only</SelectItem>
                  <SelectItem value="inactive">Inactive Only</SelectItem>
                </SelectContent>
              </Select>

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
          </div>

          {/* User Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUsers.map((user) => (
              <Card key={user.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={user.avatar_url || "/placeholder.svg"} alt={user.full_name} />
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-lg">
                        {getInitials(user.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">{user.full_name}</h3>
                        <Badge variant={user.is_active ? "default" : "secondary"} className="flex-shrink-0">
                          {user.is_active ? "Active" : "Inactive"}
                        </Badge>
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
                            <span className="truncate">Started {new Date(user.start_date).toLocaleDateString()}</span>
                          </div>
                        )}
                        {user.karbon_user_key && (
                          <div className="mt-2 pt-2 border-t">
                            <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                              Karbon Linked
                            </Badge>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredUsers.length === 0 && (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No team members found matching your filters.</p>
              <Button variant="outline" className="mt-4 bg-transparent" onClick={syncFromKarbon} disabled={syncing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                Sync from Karbon
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
