import type { BankTransaction, ParsedBankStatement } from './types'

export interface AuditIssue {
  id: string
  type: 'balance_mismatch' | 'duplicate' | 'date_sequence' | 'amount_invalid' | 'missing_data' | 'suspicious_pattern'
  severity: 'error' | 'warning' | 'info'
  transactionId?: string
  transactionIds?: string[]
  message: string
  details: Record<string, any>
  suggestedFix?: string
}

export interface AuditResult {
  passed: boolean
  score: number // 0-100
  issues: AuditIssue[]
  summary: {
    totalChecks: number
    passedChecks: number
    errors: number
    warnings: number
    info: number
  }
  recommendations: string[]
}

export interface BalanceReconciliationResult {
  isReconciled: boolean
  calculatedClosingBalance: number
  expectedClosingBalance: number
  difference: number
  discrepancies: Array<{
    transactionId: string
    expectedBalance: number
    actualBalance: number
    difference: number
  }>
}

export class AuditSystem {
  // Run all audit passes
  async runFullAudit(statement: ParsedBankStatement): Promise<AuditResult> {
    const issues: AuditIssue[] = []
    const recommendations: string[] = []

    // Pass 1: Balance Reconciliation
    const balanceResult = this.auditBalanceReconciliation(statement)
    issues.push(...balanceResult.issues)
    if (!balanceResult.passed) {
      recommendations.push('Review transactions for missing or incorrect amounts')
    }

    // Pass 2: Duplicate Detection
    const duplicateResult = this.auditDuplicateTransactions(statement.transactions)
    issues.push(...duplicateResult.issues)
    if (duplicateResult.issues.length > 0) {
      recommendations.push('Review potential duplicate transactions and remove if confirmed')
    }

    // Pass 3: Date Sequence Validation
    const dateResult = this.auditDateSequence(statement)
    issues.push(...dateResult.issues)
    if (!dateResult.passed) {
      recommendations.push('Verify transaction dates are in correct chronological order')
    }

    // Pass 4: Amount Validation
    const amountResult = this.auditAmounts(statement.transactions)
    issues.push(...amountResult.issues)
    if (amountResult.issues.length > 0) {
      recommendations.push('Review flagged transactions for unusual amounts')
    }

    // Pass 5: Data Completeness
    const completenessResult = this.auditDataCompleteness(statement)
    issues.push(...completenessResult.issues)
    if (!completenessResult.passed) {
      recommendations.push('Fill in missing transaction data where possible')
    }

    // Pass 6: Suspicious Pattern Detection
    const patternResult = this.auditSuspiciousPatterns(statement.transactions)
    issues.push(...patternResult.issues)
    if (patternResult.issues.length > 0) {
      recommendations.push('Review flagged transactions for potential data extraction errors')
    }

    // Calculate summary
    const errors = issues.filter(i => i.severity === 'error').length
    const warnings = issues.filter(i => i.severity === 'warning').length
    const info = issues.filter(i => i.severity === 'info').length
    const totalChecks = 6
    const passedChecks = [
      balanceResult.passed,
      duplicateResult.issues.length === 0,
      dateResult.passed,
      amountResult.issues.filter(i => i.severity === 'error').length === 0,
      completenessResult.passed,
      patternResult.issues.filter(i => i.severity === 'error').length === 0,
    ].filter(Boolean).length

    // Calculate score (0-100)
    const baseScore = (passedChecks / totalChecks) * 100
    const errorPenalty = errors * 5
    const warningPenalty = warnings * 2
    const score = Math.max(0, Math.min(100, baseScore - errorPenalty - warningPenalty))

    return {
      passed: errors === 0,
      score: Math.round(score),
      issues,
      summary: {
        totalChecks,
        passedChecks,
        errors,
        warnings,
        info,
      },
      recommendations,
    }
  }

  // Pass 1: Balance Reconciliation
  auditBalanceReconciliation(statement: ParsedBankStatement): { passed: boolean; issues: AuditIssue[]; result: BalanceReconciliationResult } {
    const issues: AuditIssue[] = []
    const discrepancies: BalanceReconciliationResult['discrepancies'] = []

    let runningBalance = statement.openingBalance
    const transactions = statement.transactions

    for (const txn of transactions) {
      const netAmount = (txn.credit || 0) - (txn.debit || 0)
      runningBalance += netAmount

      if (txn.balance !== null) {
        const difference = Math.abs(runningBalance - txn.balance)
        if (difference > 0.01) { // Allow for rounding
          discrepancies.push({
            transactionId: txn.id,
            expectedBalance: runningBalance,
            actualBalance: txn.balance,
            difference,
          })
        }
        // Use the statement's balance as source of truth for continuing
        runningBalance = txn.balance
      }
    }

    const closingDifference = Math.abs(runningBalance - statement.closingBalance)
    const isReconciled = closingDifference < 0.01 && discrepancies.length === 0

    if (closingDifference >= 0.01) {
      issues.push({
        id: `bal_closing_${Date.now()}`,
        type: 'balance_mismatch',
        severity: 'error',
        message: `Closing balance mismatch: calculated ${formatCurrency(runningBalance)}, expected ${formatCurrency(statement.closingBalance)}`,
        details: {
          calculated: runningBalance,
          expected: statement.closingBalance,
          difference: closingDifference,
        },
        suggestedFix: 'Review all transactions for missing entries or incorrect amounts',
      })
    }

    for (const discrepancy of discrepancies) {
      issues.push({
        id: `bal_txn_${discrepancy.transactionId}`,
        type: 'balance_mismatch',
        severity: 'warning',
        transactionId: discrepancy.transactionId,
        message: `Running balance discrepancy of ${formatCurrency(discrepancy.difference)}`,
        details: discrepancy,
        suggestedFix: 'Check this transaction and surrounding entries',
      })
    }

    return {
      passed: isReconciled,
      issues,
      result: {
        isReconciled,
        calculatedClosingBalance: runningBalance,
        expectedClosingBalance: statement.closingBalance,
        difference: closingDifference,
        discrepancies,
      },
    }
  }

  // Pass 2: Duplicate Detection
  auditDuplicateTransactions(transactions: BankTransaction[]): { issues: AuditIssue[] } {
    const issues: AuditIssue[] = []
    const seen = new Map<string, BankTransaction[]>()

    for (const txn of transactions) {
      // Create a signature for potential duplicates
      const signature = `${txn.date}|${txn.debit || 0}|${txn.credit || 0}|${txn.description?.substring(0, 20)}`
      const existing = seen.get(signature) || []
      existing.push(txn)
      seen.set(signature, existing)
    }

    for (const [signature, duplicates] of seen) {
      if (duplicates.length > 1) {
        // Check if descriptions are identical (more likely true duplicate)
        const descriptions = duplicates.map(d => d.description)
        const allSame = descriptions.every(d => d === descriptions[0])

        issues.push({
          id: `dup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'duplicate',
          severity: allSame ? 'warning' : 'info',
          transactionIds: duplicates.map(d => d.id),
          message: `${duplicates.length} potential duplicate transactions found`,
          details: {
            count: duplicates.length,
            date: duplicates[0].date,
            amount: duplicates[0].debit || duplicates[0].credit,
            descriptions,
          },
          suggestedFix: allSame
            ? 'These appear to be duplicates. Review and remove if confirmed.'
            : 'Similar transactions on same date. Verify if intentional.',
        })
      }
    }

    return { issues }
  }

  // Pass 3: Date Sequence Validation
  auditDateSequence(statement: ParsedBankStatement): { passed: boolean; issues: AuditIssue[] } {
    const issues: AuditIssue[] = []
    const transactions = statement.transactions
    let passed = true

    // Check if dates are in order
    for (let i = 1; i < transactions.length; i++) {
      const prevDate = new Date(transactions[i - 1].date)
      const currDate = new Date(transactions[i].date)

      if (currDate < prevDate) {
        passed = false
        issues.push({
          id: `date_seq_${transactions[i].id}`,
          type: 'date_sequence',
          severity: 'warning',
          transactionId: transactions[i].id,
          message: `Transaction date ${transactions[i].date} appears before previous transaction date ${transactions[i - 1].date}`,
          details: {
            previousDate: transactions[i - 1].date,
            currentDate: transactions[i].date,
            previousId: transactions[i - 1].id,
          },
          suggestedFix: 'Verify transaction dates are correct',
        })
      }
    }

    // Check if dates fall within statement period
    const startDate = new Date(statement.statementPeriod.startDate)
    const endDate = new Date(statement.statementPeriod.endDate)

    for (const txn of transactions) {
      if (!txn.date) continue
      const txnDate = new Date(txn.date)

      if (txnDate < startDate || txnDate > endDate) {
        issues.push({
          id: `date_range_${txn.id}`,
          type: 'date_sequence',
          severity: 'warning',
          transactionId: txn.id,
          message: `Transaction date ${txn.date} is outside statement period`,
          details: {
            transactionDate: txn.date,
            periodStart: statement.statementPeriod.startDate,
            periodEnd: statement.statementPeriod.endDate,
          },
          suggestedFix: 'Check if date was extracted correctly',
        })
      }
    }

    // Check for invalid dates
    for (const txn of transactions) {
      if (!txn.date || !/^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
        passed = false
        issues.push({
          id: `date_format_${txn.id}`,
          type: 'date_sequence',
          severity: 'error',
          transactionId: txn.id,
          message: `Invalid date format: "${txn.date}"`,
          details: { date: txn.date },
          suggestedFix: 'Correct the date to YYYY-MM-DD format',
        })
      }
    }

    return { passed, issues }
  }

  // Pass 4: Amount Validation
  auditAmounts(transactions: BankTransaction[]): { issues: AuditIssue[] } {
    const issues: AuditIssue[] = []

    for (const txn of transactions) {
      // Check for missing amounts
      if (txn.debit === null && txn.credit === null) {
        issues.push({
          id: `amt_missing_${txn.id}`,
          type: 'amount_invalid',
          severity: 'error',
          transactionId: txn.id,
          message: 'Transaction has no debit or credit amount',
          details: { transaction: txn },
          suggestedFix: 'Add the correct amount in debit or credit column',
        })
      }

      // Check for both debit and credit
      if (txn.debit !== null && txn.credit !== null && txn.debit > 0 && txn.credit > 0) {
        issues.push({
          id: `amt_both_${txn.id}`,
          type: 'amount_invalid',
          severity: 'warning',
          transactionId: txn.id,
          message: 'Transaction has both debit and credit amounts',
          details: { debit: txn.debit, credit: txn.credit },
          suggestedFix: 'Verify which column should have the amount',
        })
      }

      // Check for negative amounts
      if ((txn.debit !== null && txn.debit < 0) || (txn.credit !== null && txn.credit < 0)) {
        issues.push({
          id: `amt_negative_${txn.id}`,
          type: 'amount_invalid',
          severity: 'warning',
          transactionId: txn.id,
          message: 'Transaction has negative amount',
          details: { debit: txn.debit, credit: txn.credit },
          suggestedFix: 'Amounts should be positive; use debit/credit columns for direction',
        })
      }

      // Check for unusually large amounts (potential OCR error)
      const amount = txn.debit || txn.credit || 0
      if (amount > 10000000) { // $10 million threshold
        issues.push({
          id: `amt_large_${txn.id}`,
          type: 'amount_invalid',
          severity: 'info',
          transactionId: txn.id,
          message: `Unusually large amount: ${formatCurrency(amount)}`,
          details: { amount },
          suggestedFix: 'Verify this amount is correct (may be OCR error)',
        })
      }

      // Check for amounts with too many decimal places
      const checkDecimals = (value: number | null): boolean => {
        if (value === null) return false
        const str = value.toString()
        const parts = str.split('.')
        return parts.length === 2 && parts[1].length > 2
      }

      if (checkDecimals(txn.debit) || checkDecimals(txn.credit)) {
        issues.push({
          id: `amt_decimals_${txn.id}`,
          type: 'amount_invalid',
          severity: 'info',
          transactionId: txn.id,
          message: 'Amount has more than 2 decimal places',
          details: { debit: txn.debit, credit: txn.credit },
          suggestedFix: 'Round to 2 decimal places',
        })
      }
    }

    return { issues }
  }

  // Pass 5: Data Completeness
  auditDataCompleteness(statement: ParsedBankStatement): { passed: boolean; issues: AuditIssue[] } {
    const issues: AuditIssue[] = []
    let passed = true

    // Check statement-level completeness
    if (!statement.bankName || statement.bankName === 'Unknown Bank') {
      issues.push({
        id: 'complete_bank',
        type: 'missing_data',
        severity: 'info',
        message: 'Bank name not identified',
        details: {},
        suggestedFix: 'Manually specify the bank',
      })
    }

    if (!statement.statementPeriod.startDate || !statement.statementPeriod.endDate) {
      passed = false
      issues.push({
        id: 'complete_period',
        type: 'missing_data',
        severity: 'warning',
        message: 'Statement period not fully extracted',
        details: { period: statement.statementPeriod },
        suggestedFix: 'Manually enter the statement period',
      })
    }

    // Check transaction-level completeness
    const missingDates = statement.transactions.filter(t => !t.date).length
    const missingDescriptions = statement.transactions.filter(t => !t.description || t.description.length < 3).length
    const missingAmounts = statement.transactions.filter(t => t.debit === null && t.credit === null).length

    if (missingDates > 0) {
      passed = false
      issues.push({
        id: 'complete_dates',
        type: 'missing_data',
        severity: 'error',
        message: `${missingDates} transactions missing dates`,
        details: { count: missingDates },
        suggestedFix: 'Review and add missing dates',
      })
    }

    if (missingDescriptions > 0) {
      issues.push({
        id: 'complete_descriptions',
        type: 'missing_data',
        severity: 'warning',
        message: `${missingDescriptions} transactions with missing or short descriptions`,
        details: { count: missingDescriptions },
        suggestedFix: 'Review and complete descriptions',
      })
    }

    if (missingAmounts > 0) {
      passed = false
      issues.push({
        id: 'complete_amounts',
        type: 'missing_data',
        severity: 'error',
        message: `${missingAmounts} transactions missing amounts`,
        details: { count: missingAmounts },
        suggestedFix: 'Review and add missing amounts',
      })
    }

    return { passed, issues }
  }

  // Pass 6: Suspicious Pattern Detection
  auditSuspiciousPatterns(transactions: BankTransaction[]): { issues: AuditIssue[] } {
    const issues: AuditIssue[] = []

    for (const txn of transactions) {
      // Check for descriptions that look like OCR errors
      if (txn.description) {
        // Multiple consecutive numbers in description (possible misread)
        if (/\d{10,}/.test(txn.description)) {
          issues.push({
            id: `pattern_numbers_${txn.id}`,
            type: 'suspicious_pattern',
            severity: 'info',
            transactionId: txn.id,
            message: 'Description contains long number sequence (possible OCR error)',
            details: { description: txn.description },
            suggestedFix: 'Verify description was extracted correctly',
          })
        }

        // Description is mostly special characters
        const specialCharRatio = (txn.description.match(/[^a-zA-Z0-9\s]/g) || []).length / txn.description.length
        if (specialCharRatio > 0.3 && txn.description.length > 10) {
          issues.push({
            id: `pattern_special_${txn.id}`,
            type: 'suspicious_pattern',
            severity: 'warning',
            transactionId: txn.id,
            message: 'Description has unusual character pattern (possible OCR error)',
            details: { description: txn.description, specialCharRatio },
            suggestedFix: 'Review and correct the description',
          })
        }

        // Description appears truncated
        if (txn.description.endsWith('...') || txn.description.endsWith('..')) {
          issues.push({
            id: `pattern_truncated_${txn.id}`,
            type: 'suspicious_pattern',
            severity: 'info',
            transactionId: txn.id,
            message: 'Description appears truncated',
            details: { description: txn.description },
            suggestedFix: 'Check original statement for full description',
          })
        }
      }

      // Check for round number amounts that might indicate errors
      const amount = txn.debit || txn.credit
      if (amount && amount >= 1000 && amount % 1000 === 0) {
        issues.push({
          id: `pattern_round_${txn.id}`,
          type: 'suspicious_pattern',
          severity: 'info',
          transactionId: txn.id,
          message: `Round number amount (${formatCurrency(amount)}) - verify if correct`,
          details: { amount },
        })
      }
    }

    return { issues }
  }
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

// Export singleton instance
export const auditSystem = new AuditSystem()
