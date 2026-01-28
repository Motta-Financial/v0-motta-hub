import type { SupportedBank } from './types'

export interface DateFormatPattern {
  pattern: RegExp
  format: string
  example: string
}

export interface TransactionPattern {
  pattern: RegExp
  category: string
  description: string
  isDebit: boolean
}

export interface KnownError {
  pattern: RegExp
  correction: string
  description: string
}

export interface BankProfile {
  bankId: SupportedBank
  bankName: string
  dateFormats: DateFormatPattern[]
  transactionPatterns: TransactionPattern[]
  knownErrors: KnownError[]
  balanceLocation: 'right' | 'separate_column' | 'running'
  debitCreditFormat: 'separate_columns' | 'single_with_sign' | 'single_with_indicator'
  headerPatterns: string[]
  footerPatterns: string[]
  pageBreakIndicators: string[]
  commonOCRErrors: Record<string, string>
}

export const BANK_PROFILES: Record<SupportedBank, BankProfile> = {
  chase: {
    bankId: 'chase',
    bankName: 'Chase',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{2})\/(\d{2})/, format: 'MM/DD', example: '01/15' },
    ],
    transactionPatterns: [
      { pattern: /CHASE CREDIT CRD AUTOPAY/i, category: 'Credit Card Payment', description: 'Chase credit card auto-payment', isDebit: true },
      { pattern: /ZELLE (TO|FROM)/i, category: 'Transfer', description: 'Zelle transfer', isDebit: false },
      { pattern: /ORIG CO NAME:.*QUICKBOOKS/i, category: 'Payroll', description: 'QuickBooks payroll', isDebit: true },
      { pattern: /ATM WITHDRAWAL/i, category: 'ATM', description: 'ATM withdrawal', isDebit: true },
      { pattern: /DEPOSIT/i, category: 'Deposit', description: 'Deposit', isDebit: false },
      { pattern: /ACH (DEBIT|CREDIT)/i, category: 'ACH', description: 'ACH transaction', isDebit: false },
      { pattern: /WIRE (IN|OUT)/i, category: 'Wire', description: 'Wire transfer', isDebit: false },
    ],
    knownErrors: [
      { pattern: /(\d+)\.(\d{2})CR/, correction: '$1.$2 CREDIT', description: 'CR suffix indicates credit' },
      { pattern: /BAIANCE/i, correction: 'BALANCE', description: 'Common OCR error' },
    ],
    balanceLocation: 'right',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['CHASE', 'Account Number', 'Statement Period'],
    footerPatterns: ['Page', 'of', 'Continued'],
    pageBreakIndicators: ['Continued on next page', 'Page \\d+ of \\d+'],
    commonOCRErrors: {
      'l': '1',
      'O': '0',
      'S': '5',
      'B': '8',
    },
  },
  wells_fargo: {
    bankId: 'wells_fargo',
    bankName: 'Wells Fargo',
    dateFormats: [
      { pattern: /(\d{1,2})\/(\d{1,2})/, format: 'M/D', example: '1/15' },
      { pattern: /(\d{2})\/(\d{2})\/(\d{2})/, format: 'MM/DD/YY', example: '01/15/24' },
    ],
    transactionPatterns: [
      { pattern: /ONLINE TRANSFER/i, category: 'Transfer', description: 'Online transfer', isDebit: false },
      { pattern: /BILL PAY/i, category: 'Bill Payment', description: 'Online bill payment', isDebit: true },
      { pattern: /PURCHASE AUTHORIZED/i, category: 'Purchase', description: 'Debit card purchase', isDebit: true },
      { pattern: /MOBILE DEPOSIT/i, category: 'Deposit', description: 'Mobile check deposit', isDebit: false },
      { pattern: /DIRECT DEP/i, category: 'Payroll', description: 'Direct deposit', isDebit: false },
      { pattern: /PAYROLL/i, category: 'Payroll', description: 'Payroll deposit', isDebit: false },
    ],
    knownErrors: [
      { pattern: /WITHDRAWAI/i, correction: 'WITHDRAWAL', description: 'Common OCR error' },
    ],
    balanceLocation: 'running',
    debitCreditFormat: 'single_with_sign',
    headerPatterns: ['Wells Fargo', 'Account Summary', 'Statement Period'],
    footerPatterns: ['Member FDIC', 'Page'],
    pageBreakIndicators: ['Continued', 'Page \\d+'],
    commonOCRErrors: {
      'l': '1',
      'I': '1',
    },
  },
  td_bank: {
    bankId: 'td_bank',
    bankName: 'TD Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /([A-Z]{3}) (\d{1,2})/, format: 'MMM D', example: 'JAN 15' },
    ],
    transactionPatterns: [
      { pattern: /TD BANK VISA/i, category: 'Credit Card', description: 'TD Bank credit card', isDebit: false },
      { pattern: /PREAUTHORIZED DEBIT/i, category: 'Pre-authorized', description: 'Pre-authorized debit', isDebit: true },
      { pattern: /INTERAC E-TRANSFER/i, category: 'E-Transfer', description: 'Interac e-transfer', isDebit: false },
      { pattern: /PAYROLL DEPOSIT/i, category: 'Payroll', description: 'Payroll', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'separate_column',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['TD Bank', 'Account Statement'],
    footerPatterns: ['TD Bank Group', 'Member FDIC'],
    pageBreakIndicators: ['Statement continued'],
    commonOCRErrors: {},
  },
  capital_one: {
    bankId: 'capital_one',
    bankName: 'Capital One',
    dateFormats: [
      { pattern: /([A-Z]{3}) (\d{1,2}), (\d{4})/, format: 'MMM D, YYYY', example: 'Jan 15, 2024' },
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
    ],
    transactionPatterns: [
      { pattern: /360 CHECKING/i, category: 'Transfer', description: '360 account transfer', isDebit: false },
      { pattern: /INTEREST PAYMENT/i, category: 'Interest', description: 'Interest earned', isDebit: false },
      { pattern: /VENMO/i, category: 'Transfer', description: 'Venmo transfer', isDebit: false },
      { pattern: /CASHREWARDS/i, category: 'Rewards', description: 'Cash rewards redemption', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'single_with_indicator',
    headerPatterns: ['Capital One', 'Account Summary'],
    footerPatterns: ['Capital One', 'FDIC'],
    pageBreakIndicators: ['Page \\d+'],
    commonOCRErrors: {},
  },
  amex: {
    bankId: 'amex',
    bankName: 'American Express',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{2})/, format: 'MM/DD/YY', example: '01/15/24' },
      { pattern: /([A-Z]{3}) (\d{1,2})/, format: 'MMM D', example: 'Jan 15' },
    ],
    transactionPatterns: [
      { pattern: /PAYMENT.*THANK YOU/i, category: 'Payment', description: 'Payment received', isDebit: false },
      { pattern: /AMAZON/i, category: 'Shopping', description: 'Amazon purchase', isDebit: true },
      { pattern: /UBER/i, category: 'Transportation', description: 'Uber/Lyft', isDebit: true },
      { pattern: /MEMBERSHIP REWARDS/i, category: 'Rewards', description: 'Rewards redemption', isDebit: false },
      { pattern: /ANNUAL FEE/i, category: 'Fee', description: 'Annual membership fee', isDebit: true },
    ],
    knownErrors: [
      { pattern: /PYMT/i, correction: 'PAYMENT', description: 'Abbreviated payment' },
    ],
    balanceLocation: 'right',
    debitCreditFormat: 'single_with_sign',
    headerPatterns: ['American Express', 'Statement Closing Date'],
    footerPatterns: ['americanexpress.com', 'Member Since'],
    pageBreakIndicators: ['Continued on reverse', 'Page \\d+'],
    commonOCRErrors: {},
  },
  bank_of_america: {
    bankId: 'bank_of_america',
    bankName: 'Bank of America',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{2})\/(\d{2})\/(\d{2})/, format: 'MM/DD/YY', example: '01/15/24' },
    ],
    transactionPatterns: [
      { pattern: /KEEP THE CHANGE/i, category: 'Savings', description: 'Keep the Change transfer', isDebit: true },
      { pattern: /BA ELECTRONIC/i, category: 'ACH', description: 'Electronic transfer', isDebit: false },
      { pattern: /CHECKCARD/i, category: 'Purchase', description: 'Debit card purchase', isDebit: true },
      { pattern: /ELAN/i, category: 'ATM', description: 'ATM transaction', isDebit: true },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Bank of America', 'Account Number'],
    footerPatterns: ['Member FDIC', 'Equal Housing Lender'],
    pageBreakIndicators: ['Continued', 'Page'],
    commonOCRErrors: {},
  },
  citibank: {
    bankId: 'citibank',
    bankName: 'Citibank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})/, format: 'MM/DD', example: '01/15' },
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
    ],
    transactionPatterns: [
      { pattern: /CITI MOBILE/i, category: 'Mobile', description: 'Citi mobile transaction', isDebit: false },
      { pattern: /THANKYOU POINTS/i, category: 'Rewards', description: 'ThankYou points', isDebit: false },
      { pattern: /BALANCE TRANSFER/i, category: 'Transfer', description: 'Balance transfer', isDebit: true },
    ],
    knownErrors: [],
    balanceLocation: 'right',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Citi', 'Statement Period'],
    footerPatterns: ['citibank.com'],
    pageBreakIndicators: ['Page \\d+ of \\d+'],
    commonOCRErrors: {},
  },
  us_bank: {
    bankId: 'us_bank',
    bankName: 'U.S. Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
    ],
    transactionPatterns: [
      { pattern: /USBANK/i, category: 'Bank', description: 'US Bank transaction', isDebit: false },
      { pattern: /FLEXPERKS/i, category: 'Rewards', description: 'FlexPerks redemption', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['U.S. Bank', 'Account Statement'],
    footerPatterns: ['Member FDIC', 'usbank.com'],
    pageBreakIndicators: ['Page \\d+'],
    commonOCRErrors: {},
  },
  pnc: {
    bankId: 'pnc',
    bankName: 'PNC Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{2})-(\d{2})-(\d{4})/, format: 'MM-DD-YYYY', example: '01-15-2024' },
    ],
    transactionPatterns: [
      { pattern: /PNC BANK/i, category: 'Bank', description: 'PNC transaction', isDebit: false },
      { pattern: /VIRTUAL WALLET/i, category: 'Transfer', description: 'Virtual Wallet transfer', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'separate_column',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['PNC Bank', 'Statement'],
    footerPatterns: ['pnc.com', 'Member FDIC'],
    pageBreakIndicators: ['Continued'],
    commonOCRErrors: {},
  },
  truist: {
    bankId: 'truist',
    bankName: 'Truist',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
    ],
    transactionPatterns: [
      { pattern: /TRUIST/i, category: 'Bank', description: 'Truist transaction', isDebit: false },
      { pattern: /SUNTRUST/i, category: 'Bank', description: 'Legacy SunTrust', isDebit: false },
      { pattern: /BB&T/i, category: 'Bank', description: 'Legacy BB&T', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Truist', 'Account Statement'],
    footerPatterns: ['truist.com', 'Member FDIC'],
    pageBreakIndicators: ['Page'],
    commonOCRErrors: {},
  },
  other: {
    bankId: 'other',
    bankName: 'Other Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{4})-(\d{2})-(\d{2})/, format: 'YYYY-MM-DD', example: '2024-01-15' },
      { pattern: /(\d{2})-(\d{2})-(\d{4})/, format: 'DD-MM-YYYY', example: '15-01-2024' },
      { pattern: /([A-Z]{3}) (\d{1,2}), (\d{4})/, format: 'MMM D, YYYY', example: 'Jan 15, 2024' },
    ],
    transactionPatterns: [
      { pattern: /DEPOSIT/i, category: 'Deposit', description: 'Deposit', isDebit: false },
      { pattern: /WITHDRAWAL/i, category: 'Withdrawal', description: 'Withdrawal', isDebit: true },
      { pattern: /TRANSFER/i, category: 'Transfer', description: 'Transfer', isDebit: false },
      { pattern: /PAYMENT/i, category: 'Payment', description: 'Payment', isDebit: true },
      { pattern: /FEE/i, category: 'Fee', description: 'Fee', isDebit: true },
      { pattern: /INTEREST/i, category: 'Interest', description: 'Interest', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Statement', 'Account'],
    footerPatterns: ['Page', 'FDIC'],
    pageBreakIndicators: ['Page \\d+', 'Continued'],
    commonOCRErrors: {
      'l': '1',
      'O': '0',
      'I': '1',
    },
  },
}

// Additional regional bank profiles
export const REGIONAL_BANK_PROFILES: Record<string, BankProfile> = {
  first_bank_colorado: {
    bankId: 'other',
    bankName: 'First Bank of Colorado',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{2})\/(\d{2})\/(\d{2})/, format: 'MM/DD/YY', example: '01/15/24' },
    ],
    transactionPatterns: [
      { pattern: /FIRST BANK/i, category: 'Bank', description: 'First Bank transaction', isDebit: false },
      { pattern: /EFIRSTBANK/i, category: 'Online', description: 'Online banking', isDebit: false },
      { pattern: /ATM.*FIRST BANK/i, category: 'ATM', description: 'First Bank ATM', isDebit: true },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['First Bank', 'efirstbank', 'Colorado'],
    footerPatterns: ['Member FDIC', 'firstbank.com'],
    pageBreakIndicators: ['Page \\d+'],
    commonOCRErrors: {},
  },
  plains_commerce: {
    bankId: 'other',
    bankName: 'Plains Commerce Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
    ],
    transactionPatterns: [
      { pattern: /PLAINS COMMERCE/i, category: 'Bank', description: 'Plains Commerce transaction', isDebit: false },
      { pattern: /PCB/i, category: 'Bank', description: 'PCB transaction', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'separate_column',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Plains Commerce', 'Bank Statement'],
    footerPatterns: ['Member FDIC', 'plainscommerce.com'],
    pageBreakIndicators: ['Page'],
    commonOCRErrors: {},
  },
  eastern_bank: {
    bankId: 'other',
    bankName: 'Eastern Bank',
    dateFormats: [
      { pattern: /(\d{2})\/(\d{2})\/(\d{4})/, format: 'MM/DD/YYYY', example: '01/15/2024' },
      { pattern: /(\d{2})\/(\d{2})/, format: 'MM/DD', example: '01/15' },
    ],
    transactionPatterns: [
      { pattern: /EASTERN BANK/i, category: 'Bank', description: 'Eastern Bank transaction', isDebit: false },
      { pattern: /EB MOBILE/i, category: 'Mobile', description: 'Mobile banking', isDebit: false },
      { pattern: /EASTERN ONLINE/i, category: 'Online', description: 'Online banking', isDebit: false },
    ],
    knownErrors: [],
    balanceLocation: 'running',
    debitCreditFormat: 'separate_columns',
    headerPatterns: ['Eastern Bank', 'Account Statement'],
    footerPatterns: ['Member FDIC', 'easternbank.com'],
    pageBreakIndicators: ['Page \\d+ of \\d+'],
    commonOCRErrors: {},
  },
}

export function getBankProfile(bankId: SupportedBank): BankProfile {
  return BANK_PROFILES[bankId] || BANK_PROFILES.other
}

export function detectBankFromContent(content: string): SupportedBank | null {
  const contentLower = content.toLowerCase()

  // Check main banks
  for (const [bankId, profile] of Object.entries(BANK_PROFILES)) {
    for (const pattern of profile.headerPatterns) {
      if (contentLower.includes(pattern.toLowerCase())) {
        return bankId as SupportedBank
      }
    }
  }

  // Check regional banks
  for (const profile of Object.values(REGIONAL_BANK_PROFILES)) {
    for (const pattern of profile.headerPatterns) {
      if (contentLower.includes(pattern.toLowerCase())) {
        return 'other' // Return 'other' but we know which regional bank
      }
    }
  }

  return null
}

export function categorizeTransaction(description: string, bankId: SupportedBank): string | null {
  const profile = getBankProfile(bankId)

  for (const pattern of profile.transactionPatterns) {
    if (pattern.pattern.test(description)) {
      return pattern.category
    }
  }

  // Try common patterns from 'other' profile
  if (bankId !== 'other') {
    for (const pattern of BANK_PROFILES.other.transactionPatterns) {
      if (pattern.pattern.test(description)) {
        return pattern.category
      }
    }
  }

  return null
}

export function applyKnownErrorCorrections(text: string, bankId: SupportedBank): string {
  const profile = getBankProfile(bankId)
  let corrected = text

  for (const error of profile.knownErrors) {
    corrected = corrected.replace(error.pattern, error.correction)
  }

  // Apply OCR corrections
  for (const [wrong, right] of Object.entries(profile.commonOCRErrors)) {
    // Only apply in numeric contexts
    corrected = corrected.replace(new RegExp(`(?<=\\d)${wrong}(?=\\d)`, 'g'), right)
  }

  return corrected
}
