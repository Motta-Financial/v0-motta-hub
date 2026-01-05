"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DollarSign, TrendingUp, CreditCard, Calendar, ExternalLink, Search, RefreshCw } from "lucide-react"
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
  contact?: { id: string; full_name: string; email: string } | null
  organization?: { id: string; name: string } | null
  work_item?: { id: string; title: string; work_key: string } | null
}

interface Stats {
  totalDisbursals: number
  totalRevenue: number
  totalFees: number
  netRevenue: number
}

export function PaymentsDashboard() {
  const [disbursals, setDisbursals] = useState<Disbursal[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState("")

  const fetchDisbursals = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/ignition/disbursals")
      const data = await res.json()
      setDisbursals(data.disbursals || [])
      setStats(data.stats || null)
    } catch (error) {
      console.error("Error fetching disbursals:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDisbursals()
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground">Ignition disbursals and payment tracking</p>
        </div>
        <Button onClick={fetchDisbursals} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalRevenue)}</div>
              <p className="text-xs text-muted-foreground">{stats.totalDisbursals} disbursals</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processing Fees</CardTitle>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{formatCurrency(stats.totalFees)}</div>
              <p className="text-xs text-muted-foreground">
                {((stats.totalFees / stats.totalRevenue) * 100).toFixed(2)}% of revenue
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Revenue</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.netRevenue)}</div>
              <p className="text-xs text-muted-foreground">After fees</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg. Disbursal</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalRevenue / stats.totalDisbursals)}</div>
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
                    <TableCell className="text-right font-medium">{formatCurrency(disbursal.total_amount)}</TableCell>
                    <TableCell className="text-right text-red-500">-{formatCurrency(disbursal.total_fees)}</TableCell>
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
    </div>
  )
}
