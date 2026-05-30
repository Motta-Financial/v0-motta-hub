"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ExternalLink,
  FileText,
  Building2,
  User,
  RefreshCw,
  LinkIcon,
  Unlink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface TaxReturn {
  id: string
  engagement_id: string
  tax_year: number
  return_type: string
  status: "linked" | "needs_review" | "no_match"
  work_item_id: string | null
  work_item_title: string | null
  work_item_karbon_url: string | null
  work_item_link_source: string | null
  proposal_service_id: string | null
  proposal_service_name: string | null
  proposal_amount: number | null
  proposal_link_source: string | null
}

interface TaxProjectDetail {
  project: {
    id: string
    name: string
    contact_id: string | null
    contact_name: string | null
    organization_id: string | null
    organization_name: string | null
  }
  returns: TaxReturn[]
  stats: {
    total: number
    linked: number
    needsReview: number
    noMatch: number
  }
}

const RETURN_TYPE_LABELS: Record<string, string> = {
  "1040": "Individual (1040)",
  "1120": "C-Corp (1120)",
  "1120S": "S-Corp (1120S)",
  "1065": "Partnership (1065)",
  "1041": "Trust/Estate (1041)",
  "990": "Non-profit (990)",
  "709": "Gift (709)",
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "linked":
      return (
        <Badge variant="outline" className="border-emerald-500 text-emerald-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Linked
        </Badge>
      )
    case "needs_review":
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-600">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Needs Review
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="border-stone-400 text-stone-500">
          <XCircle className="h-3 w-3 mr-1" />
          No Match
        </Badge>
      )
  }
}

function SourcePill({ source }: { source: string | null }) {
  if (!source || source === "none") return null
  const colors: Record<string, string> = {
    auto: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    manual: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  }
  return (
    <span className={`px-1.5 py-0.5 text-xs rounded ${colors[source] ?? "bg-stone-100 text-stone-600"}`}>
      {source}
    </span>
  )
}

export function TaxProjectDetailClient({ projectId }: { projectId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [relinking, setRelinking] = useState(false)

  const { data, error, isLoading, mutate } = useSWR<TaxProjectDetail>(
    `/api/tax/projects/${projectId}`,
    fetcher,
  )

  const handleRelink = async () => {
    setRelinking(true)
    try {
      const res = await fetch(`/api/tax/projects/${projectId}`, { method: "POST" })
      if (!res.ok) throw new Error("Relink failed")
      const result = await res.json()
      toast({
        title: "Relinking complete",
        description: `${result.linked} linked, ${result.needsReview} need review`,
      })
      mutate()
    } catch {
      toast({ title: "Error", description: "Failed to relink returns", variant: "destructive" })
    } finally {
      setRelinking(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-12">
        <p className="text-stone-500">Failed to load project details.</p>
        <Button variant="outline" onClick={() => router.back()} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go back
        </Button>
      </div>
    )
  }

  const { project, returns, stats } = data

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-800">
              {project.organization_id ? (
                <Building2 className="h-5 w-5 text-stone-600" />
              ) : (
                <User className="h-5 w-5 text-stone-600" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-100">
                {project.organization_name || project.contact_name || project.name}
              </h1>
              <p className="text-sm text-stone-500">Tax Project</p>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRelink}
          disabled={relinking}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${relinking ? "animate-spin" : ""}`} />
          Re-run Matcher
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">Total Returns</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600">Linked</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.linked}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-600">Needs Review</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.needsReview}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-stone-500">No Match</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.noMatch}</div>
          </CardContent>
        </Card>
      </div>

      {/* Returns table */}
      <Card>
        <CardHeader>
          <CardTitle>Tax Returns</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Work Item</TableHead>
                <TableHead>Proposal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-stone-500 py-8">
                    No tax returns found for this client.
                  </TableCell>
                </TableRow>
              ) : (
                returns.map((ret) => (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">{ret.tax_year}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {RETURN_TYPE_LABELS[ret.return_type] ?? ret.return_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={ret.status} />
                    </TableCell>
                    <TableCell>
                      {ret.work_item_id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm truncate max-w-[200px]">
                            {ret.work_item_title || "Work Item"}
                          </span>
                          <SourcePill source={ret.work_item_link_source} />
                          {ret.work_item_karbon_url && (
                            <a
                              href={ret.work_item_karbon_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-stone-400 hover:text-stone-600"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <span className="text-stone-400 text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {ret.proposal_service_id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm">
                            {ret.proposal_service_name || "Proposal"}
                            {ret.proposal_amount != null && (
                              <span className="text-stone-500 ml-1">
                                ${ret.proposal_amount.toLocaleString()}
                              </span>
                            )}
                          </span>
                          <SourcePill source={ret.proposal_link_source} />
                        </div>
                      ) : (
                        <span className="text-stone-400 text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
