"use client"

import { useState, useCallback, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Upload,
  FileText,
  Download,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  FileSpreadsheet,
  Edit2,
  Save,
  X,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Brain,
  Target,
  Sparkles,
} from "lucide-react"
import type {
  ParsedBankStatement,
  BankTransaction,
  SupportedBank,
} from "@/lib/bank-statements/types"
import { SUPPORTED_BANKS } from "@/lib/bank-statements/types"

interface UploadedFile {
  file: File
  status: "pending" | "processing" | "success" | "error"
  progress: number
  result?: ParsedBankStatement
  confidence?: number
  error?: string
  transactionConfidences?: Record<string, number>
}

interface TransactionEdit {
  transactionId: string
  field: "date" | "description" | "debit" | "credit" | "balance" | "category"
  originalValue: string | number | null
  newValue: string | number | null
}

interface SystemMetrics {
  overall: {
    totalTransactionsParsed: number
    totalCorrections: number
    overallAccuracy: number
    averageConfidence: number
    banksProcessed: number
    improvementTrend: number
  }
  byBank: Array<{
    bankId: SupportedBank
    bankName: string
    transactionsParsed: number
    corrections: number
    accuracy: number
    confidence: number
    improvementTrend: number
    lastUpdated: string
  }>
  recentActivity: {
    last24Hours: { parses: number; corrections: number; patternsLearned: number }
    last7Days: { parses: number; corrections: number; patternsLearned: number }
    last30Days: { parses: number; corrections: number; patternsLearned: number }
  }
}

export function BankStatementConverter() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [selectedBank, setSelectedBank] = useState<SupportedBank>("other")
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFileIndex, setSelectedFileIndex] = useState<number | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Feedback mode state
  const [feedbackMode, setFeedbackMode] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<string | null>(null)
  const [pendingEdits, setPendingEdits] = useState<TransactionEdit[]>([])
  const [editValues, setEditValues] = useState<Record<string, any>>({})
  const [isSavingFeedback, setIsSavingFeedback] = useState(false)

  // System metrics state
  const [showStats, setShowStats] = useState(false)
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null)
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false)

  // Load metrics on mount and when stats panel is opened
  useEffect(() => {
    if (showStats) {
      loadMetrics()
    }
  }, [showStats])

  const loadMetrics = async () => {
    setIsLoadingMetrics(true)
    try {
      const response = await fetch("/api/bank-statements/metrics")
      const result = await response.json()
      if (result.success && result.data) {
        setMetrics(result.data)
      }
    } catch (error) {
      console.error("Failed to load metrics:", error)
    } finally {
      setIsLoadingMetrics(false)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = Array.from(e.dataTransfer.files).filter(
      (file) => file.type === "application/pdf"
    )
    addFiles(droppedFiles)
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files).filter(
        (file) => file.type === "application/pdf"
      )
      addFiles(selectedFiles)
    }
  }, [])

  const addFiles = (newFiles: File[]) => {
    const uploadedFiles: UploadedFile[] = newFiles.map((file) => ({
      file,
      status: "pending",
      progress: 0,
    }))
    setFiles((prev) => [...prev, ...uploadedFiles])
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    if (selectedFileIndex === index) {
      setSelectedFileIndex(null)
    } else if (selectedFileIndex !== null && selectedFileIndex > index) {
      setSelectedFileIndex(selectedFileIndex - 1)
    }
  }

  const processFile = async (index: number) => {
    const uploadedFile = files[index]
    if (!uploadedFile || uploadedFile.status === "processing") return

    setFiles((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, status: "processing", progress: 10 } : f
      )
    )

    try {
      const base64 = await fileToBase64(uploadedFile.file)

      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, progress: 30 } : f))
      )

      const response = await fetch("/api/bank-statements/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileContent: base64,
          fileName: uploadedFile.file.name,
          bankHint: selectedBank,
        }),
      })

      setFiles((prev) =>
        prev.map((f, i) => (i === index ? { ...f, progress: 80 } : f))
      )

      const result = await response.json()

      if (result.success && result.data) {
        // Calculate per-transaction confidence scores
        const transactionConfidences: Record<string, number> = {}
        for (const txn of result.data.transactions) {
          transactionConfidences[txn.id] = calculateTransactionConfidence(txn)
        }

        setFiles((prev) =>
          prev.map((f, i) =>
            i === index
              ? {
                  ...f,
                  status: "success",
                  progress: 100,
                  result: result.data,
                  confidence: result.confidence,
                  transactionConfidences,
                }
              : f
          )
        )
        setSelectedFileIndex(index)

        // Update metrics
        await fetch("/api/bank-statements/metrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bankId: selectedBank,
            transactionsParsed: result.data.transactions.length,
            confidence: result.confidence / 100,
          }),
        })
      } else {
        throw new Error(result.error || "Failed to parse bank statement")
      }
    } catch (error) {
      setFiles((prev) =>
        prev.map((f, i) =>
          i === index
            ? {
                ...f,
                status: "error",
                progress: 0,
                error: error instanceof Error ? error.message : "Unknown error",
              }
            : f
        )
      )
    }
  }

  const processAllFiles = async () => {
    const pendingIndices = files
      .map((f, i) => (f.status === "pending" ? i : -1))
      .filter((i) => i !== -1)

    for (const index of pendingIndices) {
      await processFile(index)
    }
  }

  const exportTransactions = async (format: "csv" | "excel") => {
    if (selectedFileIndex === null) return
    const selectedFile = files[selectedFileIndex]
    if (!selectedFile?.result) return

    setIsExporting(true)
    try {
      const response = await fetch("/api/bank-statements/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: selectedFile.result.transactions,
          format,
          bankName: selectedFile.result.bankName,
          statementPeriod: selectedFile.result.statementPeriod,
        }),
      })

      const result = await response.json()

      if (result.success && result.data) {
        const byteCharacters = atob(result.data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: result.mimeType })

        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = result.filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } else {
        throw new Error(result.error || "Export failed")
      }
    } catch (error) {
      console.error("Export error:", error)
      alert("Failed to export: " + (error instanceof Error ? error.message : "Unknown error"))
    } finally {
      setIsExporting(false)
    }
  }

  // Feedback mode functions
  const startEditing = (transactionId: string, transaction: BankTransaction) => {
    setEditingTransaction(transactionId)
    setEditValues({
      date: transaction.date,
      description: transaction.description,
      debit: transaction.debit,
      credit: transaction.credit,
      balance: transaction.balance,
      category: transaction.category || "",
    })
  }

  const cancelEditing = () => {
    setEditingTransaction(null)
    setEditValues({})
  }

  const saveEdit = (transactionId: string, transaction: BankTransaction) => {
    const newEdits: TransactionEdit[] = []

    if (editValues.date !== transaction.date) {
      newEdits.push({
        transactionId,
        field: "date",
        originalValue: transaction.date,
        newValue: editValues.date,
      })
    }
    if (editValues.description !== transaction.description) {
      newEdits.push({
        transactionId,
        field: "description",
        originalValue: transaction.description,
        newValue: editValues.description,
      })
    }
    if (editValues.debit !== transaction.debit) {
      newEdits.push({
        transactionId,
        field: "debit",
        originalValue: transaction.debit,
        newValue: editValues.debit ? parseFloat(editValues.debit) : null,
      })
    }
    if (editValues.credit !== transaction.credit) {
      newEdits.push({
        transactionId,
        field: "credit",
        originalValue: transaction.credit,
        newValue: editValues.credit ? parseFloat(editValues.credit) : null,
      })
    }
    if (editValues.balance !== transaction.balance) {
      newEdits.push({
        transactionId,
        field: "balance",
        originalValue: transaction.balance,
        newValue: editValues.balance ? parseFloat(editValues.balance) : null,
      })
    }
    if (editValues.category !== (transaction.category || "")) {
      newEdits.push({
        transactionId,
        field: "category",
        originalValue: transaction.category || null,
        newValue: editValues.category || null,
      })
    }

    if (newEdits.length > 0) {
      setPendingEdits((prev) => [...prev, ...newEdits])

      // Update the local transaction data
      if (selectedFileIndex !== null) {
        setFiles((prev) =>
          prev.map((f, i) => {
            if (i !== selectedFileIndex || !f.result) return f
            return {
              ...f,
              result: {
                ...f.result,
                transactions: f.result.transactions.map((t) =>
                  t.id === transactionId
                    ? {
                        ...t,
                        date: editValues.date,
                        description: editValues.description,
                        debit: editValues.debit ? parseFloat(editValues.debit) : null,
                        credit: editValues.credit ? parseFloat(editValues.credit) : null,
                        balance: editValues.balance ? parseFloat(editValues.balance) : null,
                        category: editValues.category || undefined,
                      }
                    : t
                ),
              },
            }
          })
        )
      }
    }

    setEditingTransaction(null)
    setEditValues({})
  }

  const submitFeedback = async () => {
    if (pendingEdits.length === 0) return

    setIsSavingFeedback(true)
    try {
      // Group edits by transaction
      const transactionEdits = new Map<string, TransactionEdit[]>()
      for (const edit of pendingEdits) {
        const existing = transactionEdits.get(edit.transactionId) || []
        existing.push(edit)
        transactionEdits.set(edit.transactionId, existing)
      }

      const transactions = Array.from(transactionEdits.entries()).map(([transactionId, edits]) => ({
        transactionId,
        corrections: edits.map((e) => ({
          field: e.field,
          originalValue: e.originalValue,
          correctedValue: e.newValue,
        })),
      }))

      const response = await fetch("/api/bank-statements/feedback", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankId: selectedBank,
          transactions,
        }),
      })

      const result = await response.json()

      if (result.success) {
        setPendingEdits([])
        setFeedbackMode(false)
        alert(`Saved ${pendingEdits.length} corrections. ${result.patternsLearned || 0} new patterns learned.`)
        // Refresh metrics
        loadMetrics()
      } else {
        throw new Error(result.error || "Failed to save feedback")
      }
    } catch (error) {
      console.error("Feedback error:", error)
      alert("Failed to save feedback: " + (error instanceof Error ? error.message : "Unknown error"))
    } finally {
      setIsSavingFeedback(false)
    }
  }

  const selectedResult = selectedFileIndex !== null ? files[selectedFileIndex]?.result : null
  const selectedConfidence = selectedFileIndex !== null ? files[selectedFileIndex]?.confidence : null
  const transactionConfidences = selectedFileIndex !== null ? files[selectedFileIndex]?.transactionConfidences : null

  return (
    <div className="space-y-6">
      {/* System Stats Button */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowStats(true)}>
          <BarChart3 className="h-4 w-4 mr-2" />
          System Stats
        </Button>
      </div>

      {/* System Stats Dialog */}
      <Dialog open={showStats} onOpenChange={setShowStats}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              AI Learning Statistics
            </DialogTitle>
            <DialogDescription>
              System accuracy and improvement over time
            </DialogDescription>
          </DialogHeader>

          {isLoadingMetrics ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : metrics ? (
            <div className="space-y-6">
              {/* Overall Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Target className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Overall Accuracy</p>
                  </div>
                  <p className="text-2xl font-bold">{metrics.overall.overallAccuracy}%</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Avg Confidence</p>
                  </div>
                  <p className="text-2xl font-bold">{metrics.overall.averageConfidence}%</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Transactions Parsed</p>
                  </div>
                  <p className="text-2xl font-bold">{metrics.overall.totalTransactionsParsed.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 mb-1">
                    {metrics.overall.improvementTrend >= 0 ? (
                      <TrendingUp className="h-4 w-4 text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-500" />
                    )}
                    <p className="text-xs text-muted-foreground">30-Day Trend</p>
                  </div>
                  <p className={`text-2xl font-bold ${metrics.overall.improvementTrend >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {metrics.overall.improvementTrend >= 0 ? "+" : ""}{metrics.overall.improvementTrend}%
                  </p>
                </div>
              </div>

              {/* Recent Activity */}
              <div>
                <h4 className="text-sm font-medium mb-3">Recent Activity</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-2">Last 24 Hours</p>
                    <div className="space-y-1 text-sm">
                      <p>{metrics.recentActivity.last24Hours.parses} parses</p>
                      <p>{metrics.recentActivity.last24Hours.corrections} corrections</p>
                      <p className="text-green-600">{metrics.recentActivity.last24Hours.patternsLearned} patterns learned</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-2">Last 7 Days</p>
                    <div className="space-y-1 text-sm">
                      <p>{metrics.recentActivity.last7Days.parses} parses</p>
                      <p>{metrics.recentActivity.last7Days.corrections} corrections</p>
                      <p className="text-green-600">{metrics.recentActivity.last7Days.patternsLearned} patterns learned</p>
                    </div>
                  </div>
                  <div className="p-3 rounded-lg border">
                    <p className="text-xs text-muted-foreground mb-2">Last 30 Days</p>
                    <div className="space-y-1 text-sm">
                      <p>{metrics.recentActivity.last30Days.parses} parses</p>
                      <p>{metrics.recentActivity.last30Days.corrections} corrections</p>
                      <p className="text-green-600">{metrics.recentActivity.last30Days.patternsLearned} patterns learned</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-Bank Stats */}
              {metrics.byBank.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-3">Accuracy by Bank</h4>
                  <div className="space-y-2">
                    {metrics.byBank.map((bank) => (
                      <div key={bank.bankId} className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50">
                        <div className="w-32 font-medium text-sm">{bank.bankName}</div>
                        <div className="flex-1">
                          <Progress value={bank.accuracy} className="h-2" />
                        </div>
                        <div className="w-16 text-right text-sm font-medium">{bank.accuracy}%</div>
                        <div className="w-20 text-right">
                          {bank.improvementTrend >= 0 ? (
                            <Badge variant="default" className="bg-green-500">
                              <TrendingUp className="h-3 w-3 mr-1" />
                              {bank.improvementTrend}%
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <TrendingDown className="h-3 w-3 mr-1" />
                              {Math.abs(bank.improvementTrend)}%
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">No statistics available yet</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Bank Statements
          </CardTitle>
          <CardDescription>
            Upload PDF bank statements to extract transaction data using AI
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">Bank (optional)</label>
              <Select value={selectedBank} onValueChange={(v) => setSelectedBank(v as SupportedBank)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select bank" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_BANKS.map((bank) => (
                    <SelectItem key={bank.value} value={bank.value}>
                      {bank.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Drop PDF files here</p>
            <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
            <Button variant="outline" className="mt-4" asChild>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept="application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                Browse Files
              </label>
            </Button>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Uploaded Files ({files.length})</h4>
                {files.some((f) => f.status === "pending") && (
                  <Button size="sm" onClick={processAllFiles}>
                    Process All
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {files.map((uploadedFile, index) => (
                  <div
                    key={index}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedFileIndex === index
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => uploadedFile.result && setSelectedFileIndex(index)}
                  >
                    <FileText className="h-8 w-8 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{uploadedFile.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.file.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                      {uploadedFile.status === "processing" && (
                        <Progress value={uploadedFile.progress} className="h-1 mt-1" />
                      )}
                      {uploadedFile.status === "error" && (
                        <p className="text-xs text-red-500 mt-1">{uploadedFile.error}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {uploadedFile.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => processFile(index)}>
                          Process
                        </Button>
                      )}
                      {uploadedFile.status === "processing" && (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      )}
                      {uploadedFile.status === "success" && (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      )}
                      {uploadedFile.status === "error" && (
                        <AlertCircle className="h-5 w-5 text-red-500" />
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFile(index)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results Section */}
      {selectedResult && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  {selectedResult.bankName} Statement
                </CardTitle>
                <CardDescription>
                  {selectedResult.statementPeriod.startDate} to {selectedResult.statementPeriod.endDate}
                  {" | "}Account: {selectedResult.accountNumber}
                  {" | "}{selectedResult.accountType}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {selectedConfidence !== null && (
                  <Badge variant={selectedConfidence >= 80 ? "default" : selectedConfidence >= 60 ? "secondary" : "destructive"}>
                    {selectedConfidence}% confidence
                  </Badge>
                )}
                <Button
                  variant={feedbackMode ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    if (feedbackMode && pendingEdits.length > 0) {
                      submitFeedback()
                    } else {
                      setFeedbackMode(!feedbackMode)
                    }
                  }}
                  disabled={isSavingFeedback}
                >
                  {isSavingFeedback ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : feedbackMode ? (
                    <Save className="h-4 w-4 mr-2" />
                  ) : (
                    <Edit2 className="h-4 w-4 mr-2" />
                  )}
                  {feedbackMode ? (pendingEdits.length > 0 ? `Save ${pendingEdits.length} Changes` : "Exit Edit Mode") : "Edit Mode"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportTransactions("csv")}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportTransactions("excel")}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  Excel
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Feedback Mode Banner */}
            {feedbackMode && (
              <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain className="h-5 w-5 text-blue-600" />
                  <span className="text-sm text-blue-800">
                    <strong>Edit Mode:</strong> Click any transaction to correct errors. Your corrections help improve AI accuracy.
                  </span>
                </div>
                {pendingEdits.length > 0 && (
                  <Badge variant="secondary">{pendingEdits.length} pending changes</Badge>
                )}
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Opening Balance</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(selectedResult.openingBalance, selectedResult.currency)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Total Debits</p>
                <p className="text-lg font-semibold text-red-600">
                  -{formatCurrency(selectedResult.totalDebits, selectedResult.currency)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Total Credits</p>
                <p className="text-lg font-semibold text-green-600">
                  +{formatCurrency(selectedResult.totalCredits, selectedResult.currency)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Net Change</p>
                <p className={`text-lg font-semibold ${selectedResult.totalCredits - selectedResult.totalDebits >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatCurrency(selectedResult.totalCredits - selectedResult.totalDebits, selectedResult.currency)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/50">
                <p className="text-xs text-muted-foreground">Closing Balance</p>
                <p className="text-lg font-semibold">
                  {formatCurrency(selectedResult.closingBalance, selectedResult.currency)}
                </p>
              </div>
            </div>

            {/* Transactions Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    {feedbackMode && <TableHead className="w-[50px]">Conf.</TableHead>}
                    <TableHead className="w-[100px]">Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right w-[100px]">Debit</TableHead>
                    <TableHead className="text-right w-[100px]">Credit</TableHead>
                    <TableHead className="text-right w-[100px]">Balance</TableHead>
                    {feedbackMode && <TableHead className="w-[80px]">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedResult.transactions.map((txn) => {
                    const isEditing = editingTransaction === txn.id
                    const txnConfidence = transactionConfidences?.[txn.id] ?? 0

                    return (
                      <TableRow
                        key={txn.id}
                        className={feedbackMode && !isEditing ? "cursor-pointer hover:bg-muted/50" : ""}
                        onClick={() => feedbackMode && !isEditing && startEditing(txn.id, txn)}
                      >
                        {feedbackMode && (
                          <TableCell>
                            <Badge
                              variant={txnConfidence >= 80 ? "default" : txnConfidence >= 60 ? "secondary" : "destructive"}
                              className="text-xs"
                            >
                              {txnConfidence}%
                            </Badge>
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">
                          {isEditing ? (
                            <Input
                              value={editValues.date || ""}
                              onChange={(e) => setEditValues({ ...editValues, date: e.target.value })}
                              className="h-8 text-sm"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            txn.date
                          )}
                        </TableCell>
                        <TableCell>
                          {isEditing ? (
                            <div className="space-y-1">
                              <Input
                                value={editValues.description || ""}
                                onChange={(e) => setEditValues({ ...editValues, description: e.target.value })}
                                className="h-8 text-sm"
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Input
                                value={editValues.category || ""}
                                onChange={(e) => setEditValues({ ...editValues, category: e.target.value })}
                                placeholder="Category"
                                className="h-7 text-xs"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <div>
                              <p className="text-sm">{txn.description}</p>
                              {(txn.category || txn.checkNumber || txn.reference) && (
                                <div className="flex gap-2 mt-1">
                                  {txn.category && (
                                    <Badge variant="outline" className="text-xs">
                                      {txn.category}
                                    </Badge>
                                  )}
                                  {txn.checkNumber && (
                                    <span className="text-xs text-muted-foreground">
                                      Check #{txn.checkNumber}
                                    </span>
                                  )}
                                  {txn.reference && (
                                    <span className="text-xs text-muted-foreground">
                                      Ref: {txn.reference}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-red-600">
                          {isEditing ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editValues.debit ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, debit: e.target.value })}
                              className="h-8 text-sm text-right"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            txn.debit !== null ? formatCurrency(txn.debit, selectedResult.currency) : ""
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          {isEditing ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editValues.credit ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, credit: e.target.value })}
                              className="h-8 text-sm text-right"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            txn.credit !== null ? formatCurrency(txn.credit, selectedResult.currency) : ""
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {isEditing ? (
                            <Input
                              type="number"
                              step="0.01"
                              value={editValues.balance ?? ""}
                              onChange={(e) => setEditValues({ ...editValues, balance: e.target.value })}
                              className="h-8 text-sm text-right"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            txn.balance !== null ? formatCurrency(txn.balance, selectedResult.currency) : "-"
                          )}
                        </TableCell>
                        {feedbackMode && (
                          <TableCell>
                            {isEditing ? (
                              <div className="flex gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    saveEdit(txn.id, txn)
                                  }}
                                >
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    cancelEditing()
                                  }}
                                >
                                  <X className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  startEditing(txn.id, txn)
                                }}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            <p className="text-sm text-muted-foreground mt-4 text-center">
              {selectedResult.transactions.length} transactions extracted
              {feedbackMode && pendingEdits.length > 0 && (
                <span className="text-blue-600"> | {pendingEdits.length} pending corrections</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(",")[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amount)
}

function calculateTransactionConfidence(txn: BankTransaction): number {
  let score = 0

  // Date confidence (25 points)
  if (txn.date && /^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
    score += 25
  } else if (txn.date) {
    score += 10
  }

  // Amount confidence (30 points)
  if (txn.debit !== null || txn.credit !== null) {
    score += 30
  }

  // Description confidence (25 points)
  if (txn.description && txn.description.length > 10) {
    score += 25
  } else if (txn.description && txn.description.length > 3) {
    score += 15
  }

  // Balance confidence (10 points)
  if (txn.balance !== null) {
    score += 10
  }

  // Category confidence (10 points)
  if (txn.category) {
    score += 10
  }

  return Math.min(100, score)
}
