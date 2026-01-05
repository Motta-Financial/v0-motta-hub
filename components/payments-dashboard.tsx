"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Calendar,
  ExternalLink,
  Search,
  RefreshCw,
  FileText,
  CheckCircle,
  Clock,
} from "lucide-react"
import { format } from "date-fns"

interface Disbursal {
  id: string
  disbursal_id: string
  state: string
  submitted_date: string
  arrival_date: string
  total_fees: number
  total_amount: number
  currency: string
  contact?: { id: string; full_name: string; primary_email: string } | null
  organization?: { id: string; name: string } | null
  work_item?: { id: string; title: string } | null
}

interface DisbursalStats {
  totalDisbursals: number
  totalRevenue: number
  totalFees: number
  netRevenue: number
}

interface Proposal {
  proposal_id: string
  title: string
  status: string
  client_name: string
  amount: number
  currency: string
  created_at: string
  payload: {
    client_email?: string
    services?: string
    client_partner?: string
    client_manager?: string
    effective_start_date?: string
  }
}

interface ProposalStats {
  total: number
  accepted: number
  pending: number
  draft: number
  lost: number
  totalValue: number
  acceptedValue: number
  pendingValue: number
}

export function PaymentsDashboard() {
  const [activeTab, setActiveTab] = useState("disbursals")
  const [disbursals, setDisbursals] = useState<Disbursal[]>([])
  const [disbursalStats, setDisbursalStats] = useState<DisbursalStats | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [proposalStats, setProposalStats] = useState<ProposalStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const fetchDisbursals = async () => {
    try {
      const res = await fetch("/api/ignition/disbursals")
      const data = await res.json()
      setDisbursals(data.disbursals || [])
      setDisbursalStats(data.stats || null)
    } catch (error) {
      console.error("Error fetching disbursals:", error)
    }
  }

  const fetchProposals = async () => {
    try {
      const res = await fetch("/api/ignition/proposals")
      const data = await res.json()
      setProposals(data.proposals || [])
      setProposalStats(data.stats || null)
    } catch (error) {
      console.error("Error fetching proposals:", error)
    }
  }

  const fetchAll = async () => {
    setLoading(true)
    await Promise.all([fetchDisbursals(), fetchProposals()])
    setLoading(false)
  }

  useEffect(() => {
    fetchAll()
  }, [])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount)
  }

  const filteredDisbursals = disbursals.filter(
    (d) =>
      d.disbursal_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.contact?.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.organization?.name?.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const filteredProposals = proposals.filter(
    (p) =>
      p.proposal_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.title.toLowerCase().includes(searchTerm.toLowerCase()),
  )

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Accepted":
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Accepted</Badge>
      case "Awaiting acceptance":
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">Pending</Badge>
      case "Draft":
        return <Badge variant="secondary">Draft</Badge>
      case "Lost":
        return <Badge variant="destructive">Lost</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments & Proposals</h1>
          <p className="text-muted-foreground">Ignition disbursals and engagement tracking</p>
        </div>
        <Button onClick={fetchAll} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="disbursals" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Disbursals
          </TabsTrigger>
          <TabsTrigger value="proposals" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Proposals
          </TabsTrigger>
        </TabsList>

        {/* Disbursals Tab */}
        <TabsContent value="disbursals" className="space-y-6">
          {/* Disbursal Stats Cards */}
          {disbursalStats && (
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{formatCurrency(disbursalStats.totalRevenue)}</div>
                  <p className="text-xs text-muted-foreground">{disbursalStats.totalDisbursals} disbursals</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Processing Fees</CardTitle>
                  <CreditCard className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-500">{formatCurrency(disbursalStats.totalFees)}</div>
                  <p className="text-xs text-muted-foreground">
                    {((disbursalStats.totalFees / disbursalStats.totalRevenue) * 100).toFixed(2)}% of revenue
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Net Revenue</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(disbursalStats.netRevenue)}</div>
                  <p className="text-xs text-muted-foreground">After fees</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg. Disbursal</CardTitle>
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {formatCurrency(disbursalStats.totalRevenue / disbursalStats.totalDisbursals)}
                  </div>
                  <p className="text-xs text-muted-foreground">Per payout</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Disbursals Table */}
          <Card>
            <CardHeader>
              <CardTitle>Disbursals</CardTitle>
              <CardDescription>Payment disbursals from Ignition via Stripe</CardDescription>
              <div className="flex items-center gap-2 pt-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, client, or organization..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Disbursal ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Arrival</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead>Linked To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDisbursals.map((disbursal) => (
                      <TableRow key={disbursal.id}>
                        <TableCell className="font-mono text-xs">
                          <a
                            href={`https://dashboard.stripe.com/payouts/${disbursal.disbursal_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            {disbursal.disbursal_id.slice(0, 20)}...
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>
                          <Badge variant={disbursal.state === "Completed" ? "default" : "secondary"}>
                            {disbursal.state}
                          </Badge>
                        </TableCell>
                        <TableCell>{format(new Date(disbursal.submitted_date), "MMM d, yyyy")}</TableCell>
                        <TableCell>{format(new Date(disbursal.arrival_date), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(disbursal.total_amount)}
                        </TableCell>
                        <TableCell className="text-right text-red-500">
                          -{formatCurrency(disbursal.total_fees)}
                        </TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {formatCurrency(disbursal.total_amount - disbursal.total_fees)}
                        </TableCell>
                        <TableCell>
                          {disbursal.organization ? (
                            <span className="text-sm">{disbursal.organization.name}</span>
                          ) : disbursal.contact ? (
                            <span className="text-sm">{disbursal.contact.full_name}</span>
                          ) : (
                            <span className="text-xs text-muted-foreground">Not linked</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proposals Tab */}
        <TabsContent value="proposals" className="space-y-6">
          {/* Proposal Stats Cards */}
          {proposalStats && (
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Pipeline</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(proposalStats.totalValue)}</div>
                  <p className="text-xs text-muted-foreground">{proposalStats.total} proposals</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Accepted</CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600">{formatCurrency(proposalStats.acceptedValue)}</div>
                  <p className="text-xs text-muted-foreground">{proposalStats.accepted} proposals</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Pending</CardTitle>
                  <Clock className="h-4 w-4 text-yellow-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-yellow-600">{formatCurrency(proposalStats.pendingValue)}</div>
                  <p className="text-xs text-muted-foreground">{proposalStats.pending} awaiting acceptance</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {proposalStats.total > 0 ? ((proposalStats.accepted / proposalStats.total) * 100).toFixed(0) : 0}%
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {proposalStats.accepted} of {proposalStats.total} accepted
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Proposals Table */}
          <Card>
            <CardHeader>
              <CardTitle>Proposals</CardTitle>
              <CardDescription>Ignition proposals and engagements</CardDescription>
              <div className="flex items-center gap-2 pt-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID, client, or title..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="max-w-sm"
                />
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proposal</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Services</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Partner</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProposals.map((proposal) => (
                      <TableRow key={proposal.proposal_id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{proposal.title}</div>
                            <div className="text-xs text-muted-foreground">{proposal.proposal_id}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{proposal.client_name}</div>
                            {proposal.payload?.client_email && (
                              <div className="text-xs text-muted-foreground">{proposal.payload.client_email}</div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(proposal.status)}</TableCell>
                        <TableCell>
                          <div className="max-w-[200px] truncate text-xs text-muted-foreground">
                            {proposal.payload?.services?.split(";").length || 0} services
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(proposal.amount)}</TableCell>
                        <TableCell className="text-sm">{proposal.payload?.client_partner || "-"}</TableCell>
                        <TableCell>{format(new Date(proposal.created_at), "MMM d, yyyy")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
