"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import useSWR from "swr"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Building2,
  User,
  ExternalLink,
  RefreshCw,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface TaxProject {
  id: string
  name: string
  client_name: string
  organization_id: string | null
  contact_id: string | null
  total_returns: number
  linked_returns: number
  needs_review_returns: number
  no_match_returns: number
  created_at: string
}

interface ApiResponse {
  projects: TaxProject[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export function TaxProjectsClient() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get("q") ?? "")
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [status, setStatus] = useState(searchParams.get("status") ?? "all")
  const [page, setPage] = useState(Number(searchParams.get("page") ?? 1))

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // Build API URL
  const apiUrl = `/api/tax/projects?page=${page}&status=${status}${
    debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""
  }`

  const { data, error, isLoading, mutate } = useSWR<ApiResponse>(apiUrl, fetcher)

  // Update URL on filter change
  useEffect(() => {
    const params = new URLSearchParams()
    if (debouncedSearch) params.set("q", debouncedSearch)
    if (status !== "all") params.set("status", status)
    if (page > 1) params.set("page", String(page))
    const qs = params.toString()
    router.replace(`/tax/projects${qs ? `?${qs}` : ""}`, { scroll: false })
  }, [debouncedSearch, status, page, router])

  const handleStatusChange = useCallback((val: string) => {
    setStatus(val)
    setPage(1)
  }, [])

  const getHealthBadge = (project: TaxProject) => {
    if (project.needs_review_returns > 0) {
      return (
        <Badge variant="outline" className="border-amber-500 text-amber-600">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {project.needs_review_returns} needs review
        </Badge>
      )
    }
    if (project.no_match_returns > 0 && project.linked_returns === 0) {
      return (
        <Badge variant="outline" className="border-stone-400 text-stone-500">
          <XCircle className="h-3 w-3 mr-1" />
          No links
        </Badge>
      )
    }
    if (project.linked_returns === project.total_returns) {
      return (
        <Badge variant="outline" className="border-emerald-500 text-emerald-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          All linked
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="border-stone-400 text-stone-500">
        {project.linked_returns}/{project.total_returns} linked
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Tax Projects
          </h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
            Link tax returns to Karbon work items and proposals
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => mutate()}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            <SelectItem value="linked">Fully linked</SelectItem>
            <SelectItem value="needs_review">Needs review</SelectItem>
            <SelectItem value="no_match">No matches</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats summary */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500">
                Total Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-stone-500">
                Total Returns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.projects.reduce((s, p) => s + p.total_returns, 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-emerald-600">
                Linked
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {data.projects.reduce((s, p) => s + p.linked_returns, 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-amber-600">
                Needs Review
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {data.projects.reduce((s, p) => s + p.needs_review_returns, 0)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Projects list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-12 text-stone-500">
          Failed to load projects. Please try again.
        </div>
      ) : !data?.projects.length ? (
        <div className="text-center py-12 text-stone-500">
          No tax projects found.
        </div>
      ) : (
        <div className="space-y-3">
          {data.projects.map((project) => (
            <Link key={project.id} href={`/tax/projects/${project.id}`}>
              <Card className="hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors cursor-pointer">
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-stone-100 dark:bg-stone-800">
                      {project.organization_id ? (
                        <Building2 className="h-5 w-5 text-stone-600 dark:text-stone-400" />
                      ) : (
                        <User className="h-5 w-5 text-stone-600 dark:text-stone-400" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium text-stone-900 dark:text-stone-100">
                        {project.client_name || project.name}
                      </div>
                      <div className="text-sm text-stone-500 dark:text-stone-400">
                        {project.total_returns} return
                        {project.total_returns !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getHealthBadge(project)}
                    <ExternalLink className="h-4 w-4 text-stone-400" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <div className="text-sm text-stone-500">
            Page {data.page} of {data.totalPages}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
