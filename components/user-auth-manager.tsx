"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Loader2,
  Shield,
  ShieldCheck,
  ShieldX,
  UserPlus,
  Copy,
  Check,
  AlertTriangle,
  Search,
  UserCheck,
  RefreshCw,
  Link2,
  Plus,
} from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"

interface TeamMember {
  id: string
  name: string
  email: string
  isActive: boolean
  hasAuthAccount: boolean
  authUserId: string | null
}

interface AuthSetupResult {
  success: Array<{ name: string; email: string; tempPassword: string }>
  failed: Array<{ name: string; email: string; error: string }>
}

interface UnlinkedAuthUser {
  auth_id: string
  email: string
  full_name: string | null
  created_at: string
  last_sign_in_at: string | null
}

interface UnmatchedTeamMember {
  team_member_id: string
  full_name: string
  email: string
  matching_auth_id: string | null
  has_matching_auth: boolean
}

interface DiscoveryData {
  unlinked_auth_users: UnlinkedAuthUser[]
  unmatched_team_members: UnmatchedTeamMember[]
  summary: {
    total_auth_users: number
    total_team_members: number
    unlinked_auth_users_count: number
    unmatched_team_members_count: number
  }
}

interface SyncResult {
  added: Array<{ email: string; full_name: string; team_member_id: string }>
  linked: Array<{ email: string; full_name: string; team_member_id: string }>
  failed: Array<{ email: string; error: string }>
}

export function UserAuthManager() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [results, setResults] = useState<AuthSetupResult | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  // Discovery state
  const [discoveryData, setDiscoveryData] = useState<DiscoveryData | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [syncingNewUsers, setSyncingNewUsers] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [showSyncResult, setShowSyncResult] = useState(false)
  const [selectedAuthUsers, setSelectedAuthUsers] = useState<Set<string>>(new Set())
  const [selectedTeamLinks, setSelectedTeamLinks] = useState<Set<string>>(new Set())
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [userDetails, setUserDetails] = useState<
    Record<string, { full_name: string; role: string; department: string }>
  >({})

  const fetchMembers = async () => {
    try {
      const response = await fetch("/api/team-members/setup-auth")
      const data = await response.json()
      setMembers(data.members || [])
    } catch (error) {
      console.error("Error fetching members:", error)
    } finally {
      setLoading(false)
    }
  }

  const discoverAuthUsers = useCallback(async () => {
    setDiscovering(true)
    try {
      const response = await fetch("/api/team-members/sync-auth-users")
      const data = await response.json()
      if (data.error) {
        console.error("Discovery error:", data.error)
        return
      }
      setDiscoveryData(data)

      // Pre-populate user details for editing
      const details: Record<string, { full_name: string; role: string; department: string }> = {}
      for (const user of data.unlinked_auth_users || []) {
        const nameParts = user.email.split("@")[0]?.split(".") || []
        const derivedName =
          user.full_name ||
          nameParts.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ")
        details[user.auth_id] = {
          full_name: derivedName,
          role: "Team Member",
          department: "Unassigned",
        }
      }
      setUserDetails(details)
    } catch (error) {
      console.error("Error discovering auth users:", error)
    } finally {
      setDiscovering(false)
    }
  }, [])

  const handleSyncSelectedUsers = async () => {
    setSyncingNewUsers(true)
    try {
      const authUsersToAdd = Array.from(selectedAuthUsers).map((authId) => {
        const user = discoveryData?.unlinked_auth_users.find((u) => u.auth_id === authId)
        const details = userDetails[authId]
        return {
          auth_id: authId,
          email: user?.email || "",
          full_name: details?.full_name || user?.full_name,
          role: details?.role || "Team Member",
          department: details?.department || "Unassigned",
        }
      })

      const teamMembersToLink = Array.from(selectedTeamLinks).map((tmId) => {
        const tm = discoveryData?.unmatched_team_members.find((t) => t.team_member_id === tmId)
        return {
          team_member_id: tmId,
          auth_id: tm?.matching_auth_id,
          email: tm?.email,
        }
      })

      const response = await fetch("/api/team-members/sync-auth-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_users_to_add: authUsersToAdd,
          team_members_to_link: teamMembersToLink,
        }),
      })
      const data = await response.json()
      setSyncResult(data)
      setShowSyncResult(true)
      setSelectedAuthUsers(new Set())
      setSelectedTeamLinks(new Set())

      // Refresh both data sets
      await Promise.all([fetchMembers(), discoverAuthUsers()])
    } catch (error) {
      console.error("Error syncing users:", error)
    } finally {
      setSyncingNewUsers(false)
    }
  }

  useEffect(() => {
    fetchMembers()
    discoverAuthUsers()
  }, [discoverAuthUsers])

  const handleSetupAuth = async () => {
    setSyncing(true)
    try {
      const response = await fetch("/api/team-members/setup-auth", {
        method: "POST",
      })
      const data = await response.json()

      if (data.success || data.failed) {
        setResults({
          success: data.success || [],
          failed: data.failed || [],
        })
        setShowResults(true)
        fetchMembers() // Refresh the list
      }
    } catch (error) {
      console.error("Error setting up auth:", error)
    } finally {
      setSyncing(false)
    }
  }

  const copyPassword = (password: string, index: number) => {
    navigator.clipboard.writeText(password)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const withAuth = members.filter((m) => m.hasAuthAccount)
  const withoutAuth = members.filter((m) => !m.hasAuthAccount && m.isActive)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const totalSelected = selectedAuthUsers.size + selectedTeamLinks.size

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Authentication</h1>
          <p className="text-muted-foreground">Manage Supabase Auth accounts and discover new users</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={discoverAuthUsers} disabled={discovering}>
            {discovering ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Scan for New Users
              </>
            )}
          </Button>
          <Button onClick={handleSetupAuth} disabled={syncing || withoutAuth.length === 0}>
            {syncing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Users...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Setup Auth ({withoutAuth.length})
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{members.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">With Auth Account</CardTitle>
            <ShieldCheck className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{withAuth.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Needs Auth Setup</CardTitle>
            <ShieldX className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{withoutAuth.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">New Auth Users Found</CardTitle>
            <UserCheck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {discoveryData?.summary.unlinked_auth_users_count ?? "..."}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="discover" className="space-y-4">
        <TabsList>
          <TabsTrigger value="discover" className="gap-2">
            <Search className="h-4 w-4" />
            Discover New Users
            {discoveryData && discoveryData.summary.unlinked_auth_users_count > 0 && (
              <Badge variant="secondary" className="ml-1">
                {discoveryData.summary.unlinked_auth_users_count}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-2">
            <Shield className="h-4 w-4" />
            All Team Members
          </TabsTrigger>
        </TabsList>

        {/* Discover New Users Tab */}
        <TabsContent value="discover" className="space-y-4">
          {/* Unlinked Auth Users Section */}
          {discoveryData && discoveryData.unlinked_auth_users.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <UserPlus className="h-5 w-5 text-blue-600" />
                      New Supabase Auth Users
                    </CardTitle>
                    <CardDescription>
                      These users have signed up via Supabase Auth but are not yet in the team directory. Select users
                      to add them as authorized team members.
                    </CardDescription>
                  </div>
                  {totalSelected > 0 && (
                    <Button onClick={handleSyncSelectedUsers} disabled={syncingNewUsers}>
                      {syncingNewUsers ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Syncing...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Add {totalSelected} Selected User{totalSelected !== 1 ? "s" : ""}
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            discoveryData.unlinked_auth_users.length > 0 &&
                            selectedAuthUsers.size === discoveryData.unlinked_auth_users.length
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedAuthUsers(new Set(discoveryData.unlinked_auth_users.map((u) => u.auth_id)))
                            } else {
                              setSelectedAuthUsers(new Set())
                            }
                          }}
                          aria-label="Select all new auth users"
                        />
                      </TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Display Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Auth Created</TableHead>
                      <TableHead>Last Sign In</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoveryData.unlinked_auth_users.map((user) => {
                      const isSelected = selectedAuthUsers.has(user.auth_id)
                      const isEditing = editingUser === user.auth_id
                      const details = userDetails[user.auth_id] || {
                        full_name: "",
                        role: "Team Member",
                        department: "Unassigned",
                      }
                      return (
                        <TableRow
                          key={user.auth_id}
                          className={isSelected ? "bg-blue-50 dark:bg-blue-950/20" : ""}
                        >
                          <TableCell>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                const next = new Set(selectedAuthUsers)
                                if (checked) {
                                  next.add(user.auth_id)
                                } else {
                                  next.delete(user.auth_id)
                                }
                                setSelectedAuthUsers(next)
                              }}
                              aria-label={`Select ${user.email}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{user.email}</TableCell>
                          <TableCell>
                            {isEditing ? (
                              <Input
                                value={details.full_name}
                                onChange={(e) =>
                                  setUserDetails((prev) => ({
                                    ...prev,
                                    [user.auth_id]: { ...details, full_name: e.target.value },
                                  }))
                                }
                                className="h-8 w-40"
                                onBlur={() => setEditingUser(null)}
                              />
                            ) : (
                              <button
                                onClick={() => setEditingUser(user.auth_id)}
                                className="text-left hover:underline cursor-pointer"
                              >
                                {details.full_name || "Click to set"}
                              </button>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={details.role}
                              onValueChange={(val) =>
                                setUserDetails((prev) => ({
                                  ...prev,
                                  [user.auth_id]: { ...details, role: val },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Team Member">Team Member</SelectItem>
                                <SelectItem value="Manager">Manager</SelectItem>
                                <SelectItem value="Director">Director</SelectItem>
                                <SelectItem value="Partner">Partner</SelectItem>
                                <SelectItem value="Consultant">Consultant</SelectItem>
                                <SelectItem value="Intern">Intern</SelectItem>
                                <SelectItem value="Admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={details.department}
                              onValueChange={(val) =>
                                setUserDetails((prev) => ({
                                  ...prev,
                                  [user.auth_id]: { ...details, department: val },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Unassigned">Unassigned</SelectItem>
                                <SelectItem value="Leadership">Leadership</SelectItem>
                                <SelectItem value="Accounting">Accounting</SelectItem>
                                <SelectItem value="Tax">Tax</SelectItem>
                                <SelectItem value="Wealth Management">Wealth Management</SelectItem>
                                <SelectItem value="Operations">Operations</SelectItem>
                                <SelectItem value="Special Teams">Special Teams</SelectItem>
                                <SelectItem value="Firm">Firm</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {user.last_sign_in_at
                              ? new Date(user.last_sign_in_at).toLocaleDateString()
                              : "Never"}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Unmatched Team Members Section */}
          {discoveryData && discoveryData.unmatched_team_members.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5 text-amber-600" />
                  Team Members with Matching Auth Accounts
                </CardTitle>
                <CardDescription>
                  These existing team members have matching Supabase Auth accounts that can be linked automatically.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={
                            discoveryData.unmatched_team_members.length > 0 &&
                            selectedTeamLinks.size === discoveryData.unmatched_team_members.length
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedTeamLinks(
                                new Set(discoveryData.unmatched_team_members.map((t) => t.team_member_id))
                              )
                            } else {
                              setSelectedTeamLinks(new Set())
                            }
                          }}
                          aria-label="Select all team members to link"
                        />
                      </TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {discoveryData.unmatched_team_members.map((tm) => (
                      <TableRow
                        key={tm.team_member_id}
                        className={selectedTeamLinks.has(tm.team_member_id) ? "bg-amber-50 dark:bg-amber-950/20" : ""}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedTeamLinks.has(tm.team_member_id)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedTeamLinks)
                              if (checked) {
                                next.add(tm.team_member_id)
                              } else {
                                next.delete(tm.team_member_id)
                              }
                              setSelectedTeamLinks(next)
                            }}
                            aria-label={`Select ${tm.full_name}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{tm.full_name}</TableCell>
                        <TableCell>{tm.email}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-amber-600 border-amber-600">
                            <Link2 className="mr-1 h-3 w-3" />
                            Ready to Link
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {discoveryData &&
            discoveryData.unlinked_auth_users.length === 0 &&
            discoveryData.unmatched_team_members.length === 0 && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <ShieldCheck className="h-12 w-12 text-green-600 mb-4" />
                  <h3 className="text-lg font-semibold">All Users Synced</h3>
                  <p className="text-muted-foreground text-center max-w-md mt-2">
                    All Supabase Auth users are linked to team member records. When new users sign up, click
                    &quot;Scan for New Users&quot; to discover them.
                  </p>
                  <Button variant="outline" className="mt-4" onClick={discoverAuthUsers} disabled={discovering}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${discovering ? "animate-spin" : ""}`} />
                    Scan Again
                  </Button>
                </CardContent>
              </Card>
            )}

          {/* Loading state for discovery */}
          {!discoveryData && discovering && (
            <Card>
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mr-3" />
                <span className="text-muted-foreground">Scanning Supabase Auth for new users...</span>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* All Team Members Tab */}
        <TabsContent value="members">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Authentication status for all team members</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Auth Account</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">{member.name}</TableCell>
                      <TableCell>{member.email}</TableCell>
                      <TableCell>
                        <Badge variant={member.isActive ? "default" : "secondary"}>
                          {member.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {member.hasAuthAccount ? (
                          <Badge variant="outline" className="text-green-600 border-green-600">
                            <ShieldCheck className="mr-1 h-3 w-3" />
                            Linked
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-orange-600 border-orange-600">
                            <ShieldX className="mr-1 h-3 w-3" />
                            Not Setup
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Auth Setup Results Dialog */}
      <Dialog open={showResults} onOpenChange={setShowResults}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Auth Setup Results</DialogTitle>
            <DialogDescription>Results of creating Supabase Auth accounts for team members</DialogDescription>
          </DialogHeader>

          {results && results.success.length > 0 && (
            <div className="space-y-4">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Important: Save These Passwords!</AlertTitle>
                <AlertDescription>
                  These temporary passwords will only be shown once. Share them securely with each user and ask them to
                  change their password on first login.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <h4 className="font-semibold text-green-600">Successfully Created ({results.success.length})</h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Temporary Password</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.success.map((user, index) => (
                      <TableRow key={index}>
                        <TableCell>{user.name}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <code className="bg-muted px-2 py-1 rounded text-sm">{user.tempPassword}</code>
                        </TableCell>
                        <TableCell>
                          {user.tempPassword !== "(existing user - no password change)" && (
                            <Button variant="ghost" size="sm" onClick={() => copyPassword(user.tempPassword, index)}>
                              {copiedIndex === index ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {results && results.failed.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-semibold text-red-600">Failed ({results.failed.length})</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.failed.map((user, index) => (
                    <TableRow key={index}>
                      <TableCell>{user.name}</TableCell>
                      <TableCell>{user.email}</TableCell>
                      <TableCell className="text-red-600">{user.error}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sync New Users Results Dialog */}
      <Dialog open={showSyncResult} onOpenChange={setShowSyncResult}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Sync Results</DialogTitle>
            <DialogDescription>
              Results of adding new auth users as authorized team members
            </DialogDescription>
          </DialogHeader>

          {syncResult && (
            <div className="space-y-4">
              {syncResult.added.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-green-600 flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Added as Team Members ({syncResult.added.length})
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncResult.added.map((user) => (
                        <TableRow key={user.team_member_id}>
                          <TableCell className="font-medium">{user.full_name}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-green-600 border-green-600">
                              <ShieldCheck className="mr-1 h-3 w-3" />
                              Added & Authorized
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {syncResult.linked.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-blue-600 flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    Linked to Existing Members ({syncResult.linked.length})
                  </h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncResult.linked.map((user) => (
                        <TableRow key={user.team_member_id}>
                          <TableCell className="font-medium">{user.full_name}</TableCell>
                          <TableCell>{user.email}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-blue-600 border-blue-600">
                              <Link2 className="mr-1 h-3 w-3" />
                              Linked
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {syncResult.failed.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-red-600">Failed ({syncResult.failed.length})</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncResult.failed.map((user, idx) => (
                        <TableRow key={idx}>
                          <TableCell>{user.email}</TableCell>
                          <TableCell className="text-red-600">{user.error}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {syncResult.added.length === 0 && syncResult.linked.length === 0 && syncResult.failed.length === 0 && (
                <p className="text-muted-foreground text-center py-4">No changes were made.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
