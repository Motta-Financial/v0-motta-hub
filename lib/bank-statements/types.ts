// Bank Statement Types

export interface Transaction {
  id: string
  date: string
  description: string
  debit: number | null
  credit: number | null
  balance: number | null
  type: TransactionType
  category?: string
  confidence: number // 0-100 confidence score
  rawText?: string // Original text from PDF
  verified: boolean
  corrected: boolean
}

export type TransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'payment'
  | 'fee'
  | 'interest'
  | 'check'
  | 'atm'
  | 'pos'
  | 'ach'
  | 'wire'
  | 'refund'
  | 'adjustment'
  | 'other'

export interface BankProfile {
  id: string
  name: string
  aliases: string[]
  dateFormats: string[]
  columnOrder: ('date' | 'description' | 'debit' | 'credit' | 'balance')[]
  headerPatterns: string[]
  transactionPatterns: TransactionPattern[]
  balancePatterns: string[]
  skipPatterns: string[] // Lines to skip (headers, footers, etc.)
  createdAt?: string
  updatedAt?: string
}

export interface TransactionPattern {
  id: string
  bankProfileId: string
  pattern: string // Regex pattern
  type: TransactionType
  descriptionGroup: number // Regex group for description
  amountGroup: number // Regex group for amount
  priority: number
  createdAt?: string
}

export interface ParsedStatement {
  id: string
  fileName: string
  bankName: string | null
  bankProfileId: string | null
  accountNumber: string | null
  statementPeriod: {
    start: string | null
    end: string | null
  }
  openingBalance: number | null
  closingBalance: number | null
  transactions: Transaction[]
  accuracy: AccuracyMetrics
  rawText: string
  parsedAt: string
}

export interface AccuracyMetrics {
  overallScore: number // 0-100
  balanceVerified: boolean
  balanceDiscrepancy: number | null
  duplicatesFound: number
  lowConfidenceCount: number
  totalTransactions: number
  verifiedTransactions: number
}

export interface UserFeedback {
  id: string
  statementId: string
  transactionId: string
  userId: string
  feedbackType: 'correction' | 'verification' | 'deletion' | 'addition'
  originalValue: Record<string, any>
  correctedValue: Record<string, any>
  createdAt: string
}

export interface LearningLog {
  id: string
  bankProfileId: string
  patternType: 'date' | 'amount' | 'description' | 'type' | 'balance'
  originalPattern: string
  newPattern: string
  confidence: number
  usageCount: number
  lastUsed: string
  createdAt: string
}

export interface ExportOptions {
  format: 'csv' | 'xlsx'
  includeRawText: boolean
  includeConfidence: boolean
  dateFormat: string
  columns: string[]
}

export interface ParseRequest {
  file: File
  bankHint?: string // Optional hint about which bank
}

export interface ParseResponse {
  success: boolean
  statement?: ParsedStatement
  error?: string
}

export interface FeedbackRequest {
  statementId: string
  transactionId: string
  feedbackType: 'correction' | 'verification' | 'deletion' | 'addition'
  originalValue: Record<string, any>
  correctedValue: Record<string, any>
}

export interface FeedbackResponse {
  success: boolean
  message: string
  patternLearned?: boolean
}
