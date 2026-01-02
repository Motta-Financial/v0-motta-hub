"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  RefreshCw,
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Plus,
  Trash2,
  Copy,
  AlertCircle,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

const KNOWN_TABLES = [{ id: "tblkseFbhbBYamZls", name: "Meeting Notes & Debriefs" }]

interface TableInfo {
  id: string
  name: string
}

interface TableData {
  tableId: string
  tableName: string
  records: any[]
  fieldNames: string[]
  status: "pending" | "fetching" | "migrating" | "success" | "error"
  error?: string
  insertedCount?: number
}

export function AirtableMigration() {
  const [tables, setTables] = useState<TableInfo[]>(KNOWN_TABLES)
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set())
  const [tableData, setTableData] = useState<Map<string, TableData>>(new Map())
  const [migrating, setMigrating] = useState(false)
  const [migrationProgress, setMigrationProgress] = useState(0)
  const [expandedTable, setExpandedTable] = useState<string | null>(null)
  const [previewDialog, setPreviewDialog] = useState<{ open: boolean; table: TableInfo | null }>({
    open: false,
    table: null,
  })

  const [newTableName, setNewTableName] = useState("")
  const [newTableId, setNewTableId] = useState("")
  const [sqlScript, setSqlScript] = useState<string | null>(null)

  const addTable = () => {
    if (!newTableName.trim()) return

    const tableId = newTableId.trim() || newTableName.replace(/\s+/g, "%20")
    setTables((prev) => [...prev, { id: tableId, name: newTableName.trim() }])
    setNewTableName("")
    setNewTableId("")
  }

  const removeTable = (tableId: string) => {
    setTables((prev) => prev.filter((t) => t.id !== tableId))
    setSelectedTables((prev) => {
      const newSet = new Set(prev)
      newSet.delete(tableId)
      return newSet
    })
    setTableData((prev) => {
      const newMap = new Map(prev)
      newMap.delete(tableId)
      return newMap
    })
  }

  const fetchTableData = async (table: TableInfo) => {
    setTableData((prev) => {
      const newMap = new Map(prev)
      newMap.set(table.id, {
        tableId: table.id,
        tableName: table.name,
        records: [],
        fieldNames: [],
        status: "fetching",
      })
      return newMap
    })

    try {
      const response = await fetch(`/api/airtable/${encodeURIComponent(table.id)}`)
      const data = await response.json()

      if (data.success) {
        setTableData((prev) => {
          const newMap = new Map(prev)
          newMap.set(table.id, {
            tableId: table.id,
            tableName: table.name,
            records: data.records,
            fieldNames: data.fieldNames,
            status: "pending",
          })
          return newMap
        })
        console.log(`[v0] Fetched ${data.totalRecords} records for ${table.name}`)
      } else {
        throw new Error(data.error || "Failed to fetch data")
      }
    } catch (error) {
      console.error(`[v0] Error fetching data for ${table.name}:`, error)
      setTableData((prev) => {
        const newMap = new Map(prev)
        newMap.set(table.id, {
          tableId: table.id,
          tableName: table.name,
          records: [],
          fieldNames: [],
          status: "error",
          error: String(error),
        })
        return newMap
      })
    }
  }

  const fetchAllTables = async () => {
    for (const table of tables) {
      await fetchTableData(table)
    }
  }

  // Toggle table selection
  const toggleTableSelection = (tableId: string) => {
    setSelectedTables((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(tableId)) {
        newSet.delete(tableId)
      } else {
        newSet.add(tableId)
      }
      return newSet
    })
  }

  // Select all tables
  const selectAllTables = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set())
    } else {
      setSelectedTables(new Set(tables.map((t) => t.id)))
    }
  }

  // Migrate selected tables to Supabase
  const migrateToSupabase = async () => {
    const tablesToMigrate = tables.filter((t) => selectedTables.has(t.id))
    if (tablesToMigrate.length === 0) return

    setMigrating(true)
    setMigrationProgress(0)
    setSqlScript(null)

    for (let i = 0; i < tablesToMigrate.length; i++) {
      const table = tablesToMigrate[i]

      // Update status to migrating
      setTableData((prev) => {
        const newMap = new Map(prev)
        const existing = newMap.get(table.id)
        if (existing) {
          newMap.set(table.id, { ...existing, status: "migrating" })
        }
        return newMap
      })

      try {
        // First fetch the data if not already fetched
        let data = tableData.get(table.id)
        if (!data || data.records.length === 0) {
          const response = await fetch(`/api/airtable/${encodeURIComponent(table.id)}`)
          const fetchedData = await response.json()
          if (fetchedData.success) {
            data = {
              tableId: table.id,
              tableName: table.name,
              records: fetchedData.records,
              fieldNames: fetchedData.fieldNames,
              status: "migrating",
            }
          }
        }

        if (!data || !data.records || data.records.length === 0) {
          throw new Error("No data to migrate")
        }

        // Migrate to Supabase
        const migrateResponse = await fetch("/api/migration/airtable-to-supabase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableName: table.name,
            records: data.records,
            fieldNames: data.fieldNames,
          }),
        })

        const result = await migrateResponse.json()

        if (result.createTableSQL && !result.success) {
          setSqlScript(result.createTableSQL)
        }

        // Update status based on result
        setTableData((prev) => {
          const newMap = new Map(prev)
          newMap.set(table.id, {
            ...data!,
            status: result.success ? "success" : "error",
            error: result.error || result.errors?.join(", "),
            insertedCount: result.insertedCount,
          })
          return newMap
        })
      } catch (error) {
        setTableData((prev) => {
          const newMap = new Map(prev)
          const existing = newMap.get(table.id)
          if (existing) {
            newMap.set(table.id, {
              ...existing,
              status: "error",
              error: String(error),
            })
          }
          return newMap
        })
      }

      setMigrationProgress(((i + 1) / tablesToMigrate.length) * 100)
    }

    setMigrating(false)
  }

  // Preview table data
  const openPreview = async (table: TableInfo) => {
    setPreviewDialog({ open: true, table })
    if (!tableData.has(table.id)) {
      await fetchTableData(table)
    }
  }

  const copySqlToClipboard = () => {
    if (sqlScript) {
      navigator.clipboard.writeText(sqlScript)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case "error":
        return <XCircle className="h-4 w-4 text-red-500" />
      case "migrating":
      case "fetching":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      default:
        return <div className="h-4 w-4 rounded-full border-2 border-muted" />
    }
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Airtable to Supabase Migration</h1>
          <p className="text-sm text-muted-foreground">
            Migrate your Airtable data to Supabase for better performance and integration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={fetchAllTables} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            Fetch All Data
          </Button>
          <Button onClick={migrateToSupabase} disabled={migrating || selectedTables.size === 0} size="sm">
            {migrating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            Migrate Selected ({selectedTables.size})
          </Button>
        </div>
      </div>

      {migrating && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <Progress value={migrationProgress} className="flex-1" />
              <span className="text-sm font-medium">{Math.round(migrationProgress)}%</span>
            </div>
          </CardContent>
        </Card>
      )}

      {sqlScript && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Table Creation Required</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-2">
              The target table doesn't exist in Supabase. Please run the following SQL in your Supabase SQL Editor:
            </p>
            <div className="relative">
              <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-48">{sqlScript}</pre>
              <Button
                size="sm"
                variant="outline"
                className="absolute top-2 right-2 bg-transparent"
                onClick={copySqlToClipboard}
              >
                <Copy className="h-3 w-3 mr-1" />
                Copy
              </Button>
            </div>
            <p className="mt-2 text-xs">After running the SQL, click "Migrate Selected" again.</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Add Airtable Table</CardTitle>
          <CardDescription className="text-xs">Enter the table name exactly as it appears in Airtable</CardDescription>
        </CardHeader>
        <CardContent className="py-2 pb-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label htmlFor="tableName" className="text-xs">
                Table Name (required)
              </Label>
              <Input
                id="tableName"
                placeholder="e.g., Meeting Notes & Debriefs"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="w-48">
              <Label htmlFor="tableId" className="text-xs">
                Table ID (optional)
              </Label>
              <Input
                id="tableId"
                placeholder="e.g., tblXXXXXXXX"
                value={newTableId}
                onChange={(e) => setNewTableId(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <Button onClick={addTable} size="sm" disabled={!newTableName.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {tables.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4" />
                Airtable Tables ({tables.length})
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={selectAllTables}>
                {selectedTables.size === tables.length ? "Deselect All" : "Select All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="py-0 pb-3">
            <ScrollArea className="h-[350px]">
              <div className="space-y-1">
                {tables.map((table) => {
                  const data = tableData.get(table.id)
                  const isExpanded = expandedTable === table.id

                  return (
                    <div key={table.id} className="border rounded-md">
                      <div
                        className="flex items-center gap-3 p-2 hover:bg-muted/50 cursor-pointer"
                        onClick={() => setExpandedTable(isExpanded ? null : table.id)}
                      >
                        <Checkbox
                          checked={selectedTables.has(table.id)}
                          onCheckedChange={() => toggleTableSelection(table.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{table.name}</span>
                            {data && data.status !== "fetching" && (
                              <Badge variant="secondary" className="text-xs">
                                {data.records.length} records
                              </Badge>
                            )}
                            {data?.status === "fetching" && (
                              <Badge variant="outline" className="text-xs">
                                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                                Fetching...
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {data && getStatusIcon(data.status)}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              openPreview(table)
                            }}
                          >
                            Preview
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeTable(table.id)
                            }}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t px-3 py-2 bg-muted/30">
                          <div className="text-xs text-muted-foreground mb-1">Table ID: {table.id}</div>
                          {data?.fieldNames && data.fieldNames.length > 0 && (
                            <>
                              <div className="text-xs text-muted-foreground mb-1">
                                Fields ({data.fieldNames.length}):
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {data.fieldNames.map((field) => (
                                  <Badge key={field} variant="outline" className="text-xs">
                                    {field}
                                  </Badge>
                                ))}
                              </div>
                            </>
                          )}
                          {data?.status === "success" && (
                            <div className="mt-2 text-xs text-green-600">
                              Successfully migrated {data.insertedCount} records
                            </div>
                          )}
                          {data?.status === "error" && <div className="mt-2 text-xs text-red-600">{data.error}</div>}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {tables.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <CardTitle className="mb-2">No Tables Added</CardTitle>
            <CardDescription>Add your Airtable table names above to begin migration</CardDescription>
          </CardContent>
        </Card>
      )}

      <Dialog open={previewDialog.open} onOpenChange={(open) => setPreviewDialog({ open, table: null })}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewDialog.table?.name} - Preview</DialogTitle>
            <DialogDescription>
              {tableData.get(previewDialog.table?.id || "")?.records.length || 0} records
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[500px]">
            {previewDialog.table &&
            tableData.has(previewDialog.table.id) &&
            tableData.get(previewDialog.table.id)?.status !== "fetching" ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    {tableData
                      .get(previewDialog.table.id)
                      ?.fieldNames.slice(0, 6)
                      .map((field) => (
                        <TableHead key={field} className="text-xs">
                          {field}
                        </TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData
                    .get(previewDialog.table.id)
                    ?.records.slice(0, 20)
                    .map((record: any) => (
                      <TableRow key={record.id}>
                        {tableData
                          .get(previewDialog.table!.id)
                          ?.fieldNames.slice(0, 6)
                          .map((field) => (
                            <TableCell key={field} className="text-xs max-w-[200px] truncate">
                              {typeof record.fields[field] === "object"
                                ? JSON.stringify(record.fields[field]).slice(0, 50)
                                : String(record.fields[field] || "")}
                            </TableCell>
                          ))}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            ) : (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  )
}
