"use client"

import { DashboardLayout } from "@/components/dashboard-layout"
import { BankStatementConverter } from "@/components/bank-statement-converter"

export default function BankStatementsPage() {
  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bank Statement Converter</h1>
          <p className="text-muted-foreground">
            Upload bank statement PDFs to extract transactions automatically using AI
          </p>
        </div>

        <BankStatementConverter />
      </div>
    </DashboardLayout>
  )
}
