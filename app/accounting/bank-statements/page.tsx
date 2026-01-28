"use client"

import { DashboardLayout } from "@/components/dashboard-layout"
import { BankStatementConverter } from "@/components/bank-statement-converter"

export default function BankStatementsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Bank Statement Converter</h1>
          <p className="text-muted-foreground">
            Upload PDF bank statements and extract transaction data using AI. Export to CSV or Excel for bookkeeping.
          </p>
        </div>

        <BankStatementConverter />
      </div>
    </DashboardLayout>
  )
}
