"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail, Phone, MapPin, Calendar, Search, Users, Filter, Briefcase, Shield, Clock } from "lucide-react"
import type { KarbonUser } from "@/lib/karbon-types"
import { ViewManager } from "@/components/view-manager"
import type { FilterView } from "@/lib/view-types"

export function Teammates() {
  const [users, setUsers] = useState<KarbonUser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all")
  const [departmentFilter, setDepartmentFilter] = useState<string>("all")
  const [officeFilter, setOfficeFilter] = useState<string>("all")

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/karbon/users")
      if (!response.ok) throw new Error("Failed to fetch users")
      const data = await response.json()
      setUsers(data)
    } catch (error) {
      console.error("Error fetching users:", error)
    } finally {
      setLoading(false)
    }
  }

  // Get unique departments and offices for filters
  const departments = Array.from(new Set(users.map((u) => u.department).filter(Boolean))) as string[]
  const offices = Array.from(new Set(users.map((u) => u.officeLocation).filter(Boolean))) as string[]

  const filteredUsers = users.filter((user) => {
    const matchesSearch =
      user.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.department?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.officeLocation?.toLowerCase().includes(searchQuery.toLowerCase())

    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? user.isActive : !user.isActive)

    const matchesDepartment = departmentFilter === "all" || user.department === departmentFilter

    const matchesOffice = officeFilter === "all" || user.officeLocation === officeFilter

    return matchesSearch && matchesStatus && matchesDepartment && matchesOffice
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
    if (view.filters.officeLocation) setOfficeFilter(view.filters.officeLocation)
  }

  const getCurrentFilters = () => ({
    searchQuery,
    userStatus: statusFilter,
    department: departmentFilter,
    officeLocation: officeFilter,
  })

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
          <p className="text-gray-600 mt-2">All Karbon users in your organization</p>
        </div>
        <ViewManager type="teammates" currentFilters={getCurrentFilters()} onLoadView={handleLoadView} />
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
                placeholder="Search by name, email, title, department, or location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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

              {offices.length > 0 && (
                <Select value={officeFilter} onValueChange={setOfficeFilter}>
                  <SelectTrigger>
                    <MapPin className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter by office" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Offices</SelectItem>
                    {offices.map((office) => (
                      <SelectItem key={office} value={office}>
                        {office}
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
              <Card key={user.userKey} className="hover:shadow-md transition-shadow">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={user.avatarUrl || "/placeholder.svg"} alt={user.fullName} />
                      <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-600 text-white text-lg">
                        {getInitials(user.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">{user.fullName}</h3>
                        <Badge variant={user.isActive ? "default" : "secondary"} className="flex-shrink-0">
                          {user.isActive ? "Active" : "Inactive"}
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
                        {(user.phoneNumber || user.mobileNumber) && (
                          <a
                            href={`tel:${user.phoneNumber || user.mobileNumber}`}
                            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
                          >
                            <Phone className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{user.phoneNumber || user.mobileNumber}</span>
                          </a>
                        )}
                        {user.officeLocation && (
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <MapPin className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{user.officeLocation}</span>
                          </div>
                        )}
                        {user.startDate && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Calendar className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">Started {new Date(user.startDate).toLocaleDateString()}</span>
                          </div>
                        )}
                        {user.teams && user.teams.length > 0 && (
                          <div className="mt-2 pt-2 border-t">
                            <p className="text-xs font-semibold text-gray-700 mb-1">Teams:</p>
                            <div className="flex flex-wrap gap-1">
                              {user.teams.map((team) => (
                                <Badge key={team.teamKey} variant="outline" className="text-xs">
                                  {team.teamName}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        {user.lastLoginDate && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Clock className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">
                              Last login: {new Date(user.lastLoginDate).toLocaleDateString()}
                            </span>
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
