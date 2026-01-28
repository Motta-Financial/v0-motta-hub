export interface BankTransaction {
  id: string
  date: string
  description: string
  debit: number | null
  credit: number | null
  balance: number | null
  category?: string
  checkNumber?: string
  reference?: string
}

export interface ParsedBankStatement {
  bankName: string
  accountNumber: string
  accountType: string
  statementPeriod: {
    startDate: string
    endDate: string
  }
  openingBalance: number
  closingBalance: number
  transactions: BankTransaction[]
  totalDebits: number
  totalCredits: number
  currency: string
}

export interface BankStatementParseRequest {
  fileContent: string // Base64 encoded PDF
  fileName: string
  bankHint?: SupportedBank
}

export interface BankStatementParseResponse {
  success: boolean
  data?: ParsedBankStatement
  error?: string
  confidence?: number
}

export interface ExportRequest {
  transactions: BankTransaction[]
  format: 'csv' | 'excel'
  bankName?: string
  statementPeriod?: {
    startDate: string
    endDate: string
  }
}

export interface ExportResponse {
  success: boolean
  data?: string // Base64 encoded file
  filename?: string
  mimeType?: string
  error?: string
}

export type SupportedBank =
  | 'chase'
  | 'wells_fargo'
  | 'td_bank'
  | 'capital_one'
  | 'amex'
  | 'bank_of_america'
  | 'citibank'
  | 'us_bank'
  | 'pnc'
  | 'truist'
  | 'other'

export const SUPPORTED_BANKS: { value: SupportedBank; label: string }[] = [
  { value: 'chase', label: 'Chase' },
  { value: 'wells_fargo', label: 'Wells Fargo' },
  { value: 'td_bank', label: 'TD Bank' },
  { value: 'capital_one', label: 'Capital One' },
  { value: 'amex', label: 'American Express' },
  { value: 'bank_of_america', label: 'Bank of America' },
  { value: 'citibank', label: 'Citibank' },
  { value: 'us_bank', label: 'U.S. Bank' },
  { value: 'pnc', label: 'PNC Bank' },
  { value: 'truist', label: 'Truist' },
  { value: 'other', label: 'Other' },
]
