"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Shield, ShieldCheck, ShieldX, UserPlus, Copy, Check, AlertTriangle } from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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

export function UserAuthManager() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const [results, setResults] = useState<AuthSetupResult | null>(null)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

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

  useEffect(() => {
    fetchMembers()
  }, [])

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Authentication</h1>
          <p className="text-muted-foreground">Manage Supabase Auth accounts for team members</p>
        </div>
        <Button onClick={handleSetupAuth} disabled={syncing || withoutAuth.length === 0}>
          {syncing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating Users...
            </>
          ) : (
            <>
              <UserPlus className="mr-2 h-4 w-4" />
              Setup Auth for {withoutAuth.length} Users
            </>
          )}
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3">
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
      </div>

      {/* Members Table */}
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

      {/* Results Dialog */}
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
    </div>
  )
}
