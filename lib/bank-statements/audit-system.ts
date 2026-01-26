// Audit System for verifying extracted bank statement data

import type { Transaction, AccuracyMetrics, ParsedStatement } from './types'

/**
 * Verify that running balances are consistent
 * Returns discrepancy amount if balances don't match
 */
export function verifyBalanceConsistency(
  transactions: Transaction[],
  openingBalance: number | null,
  closingBalance: number | null
): { verified: boolean; discrepancy: number | null; details: string[] } {
  const details: string[] = []

  if (openingBalance === null || closingBalance === null) {
    details.push('Opening or closing balance not available for verification')
    return { verified: false, discrepancy: null, details }
  }

  // Calculate expected closing balance from transactions
  let calculatedBalance = openingBalance

  for (const tx of transactions) {
    if (tx.credit !== null) {
      calculatedBalance += tx.credit
    }
    if (tx.debit !== null) {
      calculatedBalance -= tx.debit
    }
  }

  const discrepancy = Math.abs(calculatedBalance - closingBalance)
  const verified = discrepancy < 0.01 // Allow for small rounding errors

  if (verified) {
    details.push('Balance verification passed')
  } else {
    details.push(`Balance discrepancy: expected ${closingBalance.toFixed(2)}, calculated ${calculatedBalance.toFixed(2)}`)
    details.push(`Discrepancy amount: ${discrepancy.toFixed(2)}`)
  }

  return { verified, discrepancy: verified ? 0 : discrepancy, details }
}

/**
 * Check for running balance consistency within transactions
 */
export function verifyRunningBalances(
  transactions: Transaction[]
): { valid: boolean; errors: { index: number; expected: number; actual: number }[] } {
  const errors: { index: number; expected: number; actual: number }[] = []

  for (let i = 1; i < transactions.length; i++) {
    const prevTx = transactions[i - 1]
    const currTx = transactions[i]

    if (prevTx.balance !== null && currTx.balance !== null) {
      let expectedBalance = prevTx.balance

      if (currTx.credit !== null) {
        expectedBalance += currTx.credit
      }
      if (currTx.debit !== null) {
        expectedBalance -= currTx.debit
      }

      const diff = Math.abs(expectedBalance - currTx.balance)
      if (diff > 0.01) {
        errors.push({
          index: i,
          expected: expectedBalance,
          actual: currTx.balance,
        })
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Detect duplicate transactions
 */
export function detectDuplicates(
  transactions: Transaction[]
): { duplicates: { indices: number[]; transaction: Transaction }[] } {
  const duplicates: { indices: number[]; transaction: Transaction }[] = []
  const seen = new Map<string, number[]>()

  transactions.forEach((tx, index) => {
    // Create a key from date, amount, and description
    const amount = tx.debit ?? tx.credit ?? 0
    const key = `${tx.date}|${amount.toFixed(2)}|${tx.description.toLowerCase().trim()}`

    if (seen.has(key)) {
      seen.get(key)!.push(index)
    } else {
      seen.set(key, [index])
    }
  })

  // Find actual duplicates (more than one occurrence)
  seen.forEach((indices, _key) => {
    if (indices.length > 1) {
      duplicates.push({
        indices,
        transaction: transactions[indices[0]],
      })
    }
  })

  return { duplicates }
}

/**
 * Identify potentially suspicious transactions
 */
export function identifySuspiciousTransactions(
  transactions: Transaction[]
): { suspicious: { index: number; reason: string; transaction: Transaction }[] } {
  const suspicious: { index: number; reason: string; transaction: Transaction }[] = []

  transactions.forEach((tx, index) => {
    // Check for unusually large amounts
    const amount = tx.debit ?? tx.credit ?? 0
    if (amount > 100000) {
      suspicious.push({
        index,
        reason: 'Unusually large amount (>$100,000)',
        transaction: tx,
      })
    }

    // Check for round numbers that might be errors
    if (amount > 1000 && amount % 1000 === 0) {
      suspicious.push({
        index,
        reason: 'Large round number - verify accuracy',
        transaction: tx,
      })
    }

    // Check for missing description
    if (!tx.description || tx.description.trim().length < 3) {
      suspicious.push({
        index,
        reason: 'Missing or very short description',
        transaction: tx,
      })
    }

    // Check for future dates
    const txDate = new Date(tx.date)
    if (txDate > new Date()) {
      suspicious.push({
        index,
        reason: 'Transaction date is in the future',
        transaction: tx,
      })
    }

    // Check for low confidence
    if (tx.confidence < 70) {
      suspicious.push({
        index,
        reason: `Low confidence score (${tx.confidence}%)`,
        transaction: tx,
      })
    }
  })

  return { suspicious }
}

/**
 * Validate date sequence (transactions should be in chronological order)
 */
export function validateDateSequence(
  transactions: Transaction[]
): { valid: boolean; outOfOrder: number[] } {
  const outOfOrder: number[] = []

  for (let i = 1; i < transactions.length; i++) {
    const prevDate = new Date(transactions[i - 1].date)
    const currDate = new Date(transactions[i].date)

    // Allow same date, but flag if current is before previous
    if (currDate < prevDate) {
      outOfOrder.push(i)
    }
  }

  return { valid: outOfOrder.length === 0, outOfOrder }
}

/**
 * Calculate overall accuracy metrics for a parsed statement
 */
export function calculateAccuracyMetrics(statement: ParsedStatement): AccuracyMetrics {
  const transactions = statement.transactions

  // Verify balance consistency
  const balanceCheck = verifyBalanceConsistency(
    transactions,
    statement.openingBalance,
    statement.closingBalance
  )

  // Detect duplicates
  const { duplicates } = detectDuplicates(transactions)

  // Count low confidence transactions
  const lowConfidenceCount = transactions.filter(tx => tx.confidence < 70).length

  // Count verified transactions
  const verifiedTransactions = transactions.filter(tx => tx.verified).length

  // Calculate overall score
  let score = 100

  // Deduct for balance discrepancy
  if (!balanceCheck.verified) {
    score -= 20
  }

  // Deduct for duplicates
  score -= Math.min(duplicates.length * 5, 15)

  // Deduct for low confidence transactions
  const lowConfidenceRatio = lowConfidenceCount / Math.max(transactions.length, 1)
  score -= Math.min(lowConfidenceRatio * 30, 20)

  // Deduct if no transactions found
  if (transactions.length === 0) {
    score -= 30
  }

  // Ensure score is between 0 and 100
  score = Math.max(0, Math.min(100, score))

  return {
    overallScore: Math.round(score),
    balanceVerified: balanceCheck.verified,
    balanceDiscrepancy: balanceCheck.discrepancy,
    duplicatesFound: duplicates.length,
    lowConfidenceCount,
    totalTransactions: transactions.length,
    verifiedTransactions,
  }
}

/**
 * Run full audit on a parsed statement
 */
export function runFullAudit(statement: ParsedStatement): {
  accuracy: AccuracyMetrics
  balanceCheck: ReturnType<typeof verifyBalanceConsistency>
  duplicates: ReturnType<typeof detectDuplicates>
  suspicious: ReturnType<typeof identifySuspiciousTransactions>
  dateSequence: ReturnType<typeof validateDateSequence>
  runningBalances: ReturnType<typeof verifyRunningBalances>
} {
  return {
    accuracy: calculateAccuracyMetrics(statement),
    balanceCheck: verifyBalanceConsistency(
      statement.transactions,
      statement.openingBalance,
      statement.closingBalance
    ),
    duplicates: detectDuplicates(statement.transactions),
    suspicious: identifySuspiciousTransactions(statement.transactions),
    dateSequence: validateDateSequence(statement.transactions),
    runningBalances: verifyRunningBalances(statement.transactions),
  }
}
