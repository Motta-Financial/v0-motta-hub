"use client"

import { useState, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Upload,
  FileText,
  Download,
  Check,
  X,
  AlertCircle,
  Loader2,
  Edit2,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Building2,
  Calendar,
  DollarSign,
  FileSpreadsheet,
  Trash2,
} from "lucide-react"
import type { Transaction, ParsedStatement, TransactionType, ExportOptions } from "@/lib/bank-statements/types"

const TRANSACTION_TYPES: { value: TransactionType; label: string }[] = [
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "transfer", label: "Transfer" },
  { value: "payment", label: "Payment" },
  { value: "fee", label: "Fee" },
  { value: "interest", label: "Interest" },
  { value: "check", label: "Check" },
  { value: "atm", label: "ATM" },
  { value: "pos", label: "POS/Purchase" },
  { value: "ach", label: "ACH" },
  { value: "wire", label: "Wire" },
  { value: "refund", label: "Refund" },
  { value: "adjustment", label: "Adjustment" },
  { value: "other", label: "Other" },
]

export function BankStatementConverter() {
  // State
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statement, setStatement] = useState<ParsedStatement | null>(null)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [feedbackMode, setFeedbackMode] = useState(false)
  const [verifiedTransactions, setVerifiedTransactions] = useState<Set<string>>(new Set())

  // Export options state
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: "csv",
    includeRawText: false,
    includeConfidence: false,
    dateFormat: "YYYY-MM-DD",
    columns: ["date", "description", "debit", "credit", "balance", "type"],
  })

  // File drop handlers
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

    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === "application/pdf") {
      setFile(droppedFile)
      setError(null)
    } else {
      setError("Please upload a PDF file")
    }
  }, [])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (selectedFile.type === "application/pdf") {
        setFile(selectedFile)
        setError(null)
      } else {
        setError("Please upload a PDF file")
      }
    }
  }, [])

  // Parse the PDF
  const handleParse = async () => {
    if (!file) return

    setParsing(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/bank-statements/parse", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to parse statement")
      }

      setStatement(data.statement)
      setVerifiedTransactions(new Set())
    } catch (err) {
      console.error("Parse error:", err)
      setError(err instanceof Error ? err.message : "Failed to parse bank statement")
    } finally {
      setParsing(false)
    }
  }

  // Edit transaction
  const handleEditTransaction = (tx: Transaction) => {
    setEditingTransaction({ ...tx })
    setEditDialogOpen(true)
  }

  const handleSaveEdit = async () => {
    if (!editingTransaction || !statement) return

    // Find original transaction
    const originalTx = statement.transactions.find((t) => t.id === editingTransaction.id)
    if (!originalTx) return

    // Save feedback to learn from correction
    try {
      await fetch("/api/bank-statements/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statementId: statement.id,
          transactionId: editingTransaction.id,
          feedbackType: "correction",
          originalValue: {
            date: originalTx.date,
            description: originalTx.description,
            debit: originalTx.debit,
            credit: originalTx.credit,
            type: originalTx.type,
          },
          correctedValue: {
            date: editingTransaction.date,
            description: editingTransaction.description,
            debit: editingTransaction.debit,
            credit: editingTransaction.credit,
            type: editingTransaction.type,
          },
          bankProfileId: statement.bankProfileId,
        }),
      })
    } catch (err) {
      console.error("Failed to save feedback:", err)
    }

    // Update the transaction in state
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) =>
        t.id === editingTransaction.id ? { ...editingTransaction, corrected: true } : t
      ),
    })

    setEditDialogOpen(false)
    setEditingTransaction(null)
  }

  // Verify transaction
  const handleVerifyTransaction = async (txId: string) => {
    if (!statement) return

    const tx = statement.transactions.find((t) => t.id === txId)
    if (!tx) return

    // Mark as verified
    const newVerified = new Set(verifiedTransactions)
    if (newVerified.has(txId)) {
      newVerified.delete(txId)
    } else {
      newVerified.add(txId)

      // Save verification feedback
      try {
        await fetch("/api/bank-statements/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            statementId: statement.id,
            transactionId: txId,
            feedbackType: "verification",
            originalValue: tx,
            correctedValue: tx,
            bankProfileId: statement.bankProfileId,
          }),
        })
      } catch (err) {
        console.error("Failed to save verification:", err)
      }
    }

    setVerifiedTransactions(newVerified)

    // Update transaction in statement
    setStatement({
      ...statement,
      transactions: statement.transactions.map((t) =>
        t.id === txId ? { ...t, verified: newVerified.has(txId) } : t
      ),
    })
  }

  // Export transactions
  const handleExport = async () => {
    if (!statement) return

    setExporting(true)

    try {
      const response = await fetch("/api/bank-statements/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactions: statement.transactions,
          options: exportOptions,
          fileName: statement.fileName,
          bankName: statement.bankName,
          statementPeriod: statement.statementPeriod,
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to export")
      }

      // Get the filename from the Content-Disposition header
      const contentDisposition = response.headers.get("Content-Disposition")
      const filenameMatch = contentDisposition?.match(/filename="(.+)"/)
      const filename = filenameMatch?.[1] || "transactions.csv"

      // Create download
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      setExportDialogOpen(false)
    } catch (err) {
      console.error("Export error:", err)
      setError("Failed to export transactions")
    } finally {
      setExporting(false)
    }
  }

  // Reset everything
  const handleReset = () => {
    setFile(null)
    setStatement(null)
    setError(null)
    setVerifiedTransactions(new Set())
    setFeedbackMode(false)
  }

  // Calculate stats
  const getStats = () => {
    if (!statement) return null

    const transactions = statement.transactions
    const totalDebits = transactions.reduce((sum, t) => sum + (t.debit || 0), 0)
    const totalCredits = transactions.reduce((sum, t) => sum + (t.credit || 0), 0)
    const verifiedCount = verifiedTransactions.size
    const correctedCount = transactions.filter((t) => t.corrected).length

    return {
      totalTransactions: transactions.length,
      totalDebits,
      totalCredits,
      netChange: totalCredits - totalDebits,
      verifiedCount,
      correctedCount,
    }
  }

  const stats = getStats()

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      {!statement && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Upload Bank Statement
            </CardTitle>
            <CardDescription>
              Upload a PDF bank statement to extract transactions automatically using AI
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : file
                    ? "border-green-500 bg-green-50"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {file ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center gap-2 text-green-600">
                    <FileText className="h-8 w-8" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <div className="flex justify-center gap-2">
                    <Button onClick={handleParse} disabled={parsing}>
                      {parsing ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Parsing...
                        </>
                      ) : (
                        <>
                          <FileSpreadsheet className="mr-2 h-4 w-4" />
                          Extract Transactions
                        </>
                      )}
                    </Button>
                    <Button variant="outline" onClick={() => setFile(null)}>
                      <X className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
                  <div>
                    <p className="font-medium">Drag and drop your PDF here</p>
                    <p className="text-sm text-muted-foreground">or click to browse</p>
                  </div>
                  <Input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                    id="file-upload"
                  />
                  <Label htmlFor="file-upload" className="cursor-pointer">
                    <Button variant="outline" asChild>
                      <span>
                        <FileText className="mr-2 h-4 w-4" />
                        Select PDF
                      </span>
                    </Button>
                  </Label>
                </div>
              )}
            </div>

            {error && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* Parsing Progress */}
      {parsing && (
        <Card>
          <CardContent className="py-8">
            <div className="space-y-4 text-center">
              <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
              <div>
                <p className="font-medium">Analyzing bank statement...</p>
                <p className="text-sm text-muted-foreground">
                  Using AI to extract transactions from your PDF
                </p>
              </div>
              <Progress value={undefined} className="w-full max-w-md mx-auto" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Section */}
      {statement && (
        <>
          {/* Statement Summary */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    {statement.bankName || "Bank Statement"}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {statement.fileName}
                    {statement.accountNumber && ` • Account: ${statement.accountNumber}`}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setFeedbackMode(!feedbackMode)}>
                    {feedbackMode ? (
                      <>
                        <X className="mr-2 h-4 w-4" />
                        Exit Feedback
                      </>
                    ) : (
                      <>
                        <Edit2 className="mr-2 h-4 w-4" />
                        Verify/Correct
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(true)}>
                    <Download className="mr-2 h-4 w-4" />
                    Export
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    New Statement
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-5">
                {/* Period */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Statement Period</p>
                  <p className="flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {statement.statementPeriod.start && statement.statementPeriod.end
                      ? `${statement.statementPeriod.start} to ${statement.statementPeriod.end}`
                      : "Not available"}
                  </p>
                </div>

                {/* Opening Balance */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Opening Balance</p>
                  <p className="font-medium">
                    {statement.openingBalance !== null
                      ? `$${statement.openingBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                      : "N/A"}
                  </p>
                </div>

                {/* Closing Balance */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Closing Balance</p>
                  <p className="font-medium">
                    {statement.closingBalance !== null
                      ? `$${statement.closingBalance.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
                      : "N/A"}
                  </p>
                </div>

                {/* Transactions */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Transactions</p>
                  <p className="font-medium">{statement.transactions.length}</p>
                </div>

                {/* Accuracy */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">Accuracy Score</p>
                  <div className="flex items-center gap-2">
                    <Progress value={statement.accuracy.overallScore} className="flex-1 h-2" />
                    <Badge
                      variant={
                        statement.accuracy.overallScore >= 90
                          ? "default"
                          : statement.accuracy.overallScore >= 70
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {statement.accuracy.overallScore}%
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Accuracy Details */}
              <div className="mt-4 flex flex-wrap gap-2">
                {statement.accuracy.balanceVerified ? (
                  <Badge variant="outline" className="border-green-500 text-green-700">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Balance Verified
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-yellow-500 text-yellow-700">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    Balance Not Verified
                  </Badge>
                )}

                {statement.accuracy.duplicatesFound > 0 && (
                  <Badge variant="outline" className="border-orange-500 text-orange-700">
                    <AlertCircle className="mr-1 h-3 w-3" />
                    {statement.accuracy.duplicatesFound} Potential Duplicates
                  </Badge>
                )}

                {statement.accuracy.lowConfidenceCount > 0 && (
                  <Badge variant="outline" className="border-yellow-500 text-yellow-700">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {statement.accuracy.lowConfidenceCount} Low Confidence
                  </Badge>
                )}

                {stats && stats.verifiedCount > 0 && (
                  <Badge variant="outline" className="border-green-500 text-green-700">
                    <Check className="mr-1 h-3 w-3" />
                    {stats.verifiedCount} Verified
                  </Badge>
                )}

                {stats && stats.correctedCount > 0 && (
                  <Badge variant="outline" className="border-blue-500 text-blue-700">
                    <Edit2 className="mr-1 h-3 w-3" />
                    {stats.correctedCount} Corrected
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Transactions Table */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Transactions
              </CardTitle>
              {feedbackMode && (
                <CardDescription className="text-blue-600">
                  Feedback mode: Click the checkmark to verify a transaction, or the edit button to
                  correct it
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {stats && (
                <div className="mb-4 grid grid-cols-4 gap-4 p-4 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Debits</p>
                    <p className="text-lg font-semibold text-red-600">
                      -${stats.totalDebits.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Credits</p>
                    <p className="text-lg font-semibold text-green-600">
                      +${stats.totalCredits.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Net Change</p>
                    <p
                      className={`text-lg font-semibold ${
                        stats.netChange >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {stats.netChange >= 0 ? "+" : ""}$
                      {stats.netChange.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Transactions</p>
                    <p className="text-lg font-semibold">{stats.totalTransactions}</p>
                  </div>
                </div>
              )}

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {feedbackMode && <TableHead className="w-[80px]">Actions</TableHead>}
                      <TableHead className="w-[100px]">Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-[100px] text-right">Debit</TableHead>
                      <TableHead className="w-[100px] text-right">Credit</TableHead>
                      <TableHead className="w-[100px] text-right">Balance</TableHead>
                      <TableHead className="w-[100px]">Type</TableHead>
                      {feedbackMode && <TableHead className="w-[80px]">Confidence</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {statement.transactions.map((tx) => (
                      <TableRow
                        key={tx.id}
                        className={`${tx.corrected ? "bg-blue-50" : ""} ${
                          verifiedTransactions.has(tx.id) ? "bg-green-50" : ""
                        } ${tx.confidence < 70 ? "bg-yellow-50" : ""}`}
                      >
                        {feedbackMode && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className={`h-7 w-7 p-0 ${
                                  verifiedTransactions.has(tx.id)
                                    ? "text-green-600"
                                    : "text-muted-foreground"
                                }`}
                                onClick={() => handleVerifyTransaction(tx.id)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => handleEditTransaction(tx)}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="font-mono text-sm">{tx.date}</TableCell>
                        <TableCell className="max-w-[300px] truncate" title={tx.description}>
                          {tx.description}
                          {tx.corrected && (
                            <Badge variant="outline" className="ml-2 text-xs">
                              Corrected
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-red-600">
                          {tx.debit !== null ? `$${tx.debit.toFixed(2)}` : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono text-green-600">
                          {tx.credit !== null ? `$${tx.credit.toFixed(2)}` : ""}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {tx.balance !== null ? `$${tx.balance.toFixed(2)}` : ""}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-xs">
                            {tx.type}
                          </Badge>
                        </TableCell>
                        {feedbackMode && (
                          <TableCell>
                            <Badge
                              variant={
                                tx.confidence >= 90
                                  ? "default"
                                  : tx.confidence >= 70
                                    ? "secondary"
                                    : "destructive"
                              }
                              className="text-xs"
                            >
                              {tx.confidence}%
                            </Badge>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Edit Transaction Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Transaction</DialogTitle>
            <DialogDescription>
              Correct any errors in this transaction. Your feedback helps improve accuracy.
            </DialogDescription>
          </DialogHeader>

          {editingTransaction && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={editingTransaction.date}
                  onChange={(e) =>
                    setEditingTransaction({ ...editingTransaction, date: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={editingTransaction.description}
                  onChange={(e) =>
                    setEditingTransaction({ ...editingTransaction, description: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Debit Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingTransaction.debit ?? ""}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        debit: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Credit Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={editingTransaction.credit ?? ""}
                    onChange={(e) =>
                      setEditingTransaction({
                        ...editingTransaction,
                        credit: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Transaction Type</Label>
                <Select
                  value={editingTransaction.type}
                  onValueChange={(value: TransactionType) =>
                    setEditingTransaction({ ...editingTransaction, type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSACTION_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>
              <Save className="mr-2 h-4 w-4" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Transactions</DialogTitle>
            <DialogDescription>Choose your export format and options</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={exportOptions.format}
                onValueChange={(value: "csv" | "xlsx") =>
                  setExportOptions({ ...exportOptions, format: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="csv">CSV</SelectItem>
                  <SelectItem value="xlsx">Excel (CSV with UTF-8 BOM)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date Format</Label>
              <Select
                value={exportOptions.dateFormat}
                onValueChange={(value) => setExportOptions({ ...exportOptions, dateFormat: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Additional Columns</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-confidence"
                    checked={exportOptions.includeConfidence}
                    onCheckedChange={(checked) =>
                      setExportOptions({ ...exportOptions, includeConfidence: checked as boolean })
                    }
                  />
                  <Label htmlFor="include-confidence" className="font-normal">
                    Include confidence scores
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-raw"
                    checked={exportOptions.includeRawText}
                    onCheckedChange={(checked) =>
                      setExportOptions({ ...exportOptions, includeRawText: checked as boolean })
                    }
                  />
                  <Label htmlFor="include-raw" className="font-normal">
                    Include raw text
                  </Label>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
