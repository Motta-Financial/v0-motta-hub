// Pre-loaded Bank Profiles for common banks

import type { BankProfile, TransactionType } from './types'

export const DEFAULT_BANK_PROFILES: BankProfile[] = [
  {
    id: 'chase',
    name: 'Chase Bank',
    aliases: ['jpmorgan chase', 'chase', 'jpm', 'jpmorgan'],
    dateFormats: ['MM/DD/YYYY', 'MM/DD/YY', 'M/D/YYYY'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*amount.*balance',
      'transaction.*date.*description.*withdrawals.*deposits.*balance',
      'posting date.*description.*amount',
    ],
    transactionPatterns: [
      {
        id: 'chase-ach',
        bankProfileId: 'chase',
        pattern: 'ACH.*(?:DEBIT|CREDIT)',
        type: 'ach',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'chase-wire',
        bankProfileId: 'chase',
        pattern: 'WIRE.*(?:IN|OUT)',
        type: 'wire',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'chase-check',
        bankProfileId: 'chase',
        pattern: 'CHECK\\s+#?\\d+',
        type: 'check',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'beginning balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'ending balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'opening balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'closing balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+ of \\d+',
      'continued on next page',
      'account summary',
      'statement period',
    ],
  },
  {
    id: 'wells-fargo',
    name: 'Wells Fargo',
    aliases: ['wells fargo', 'wellsfargo', 'wf'],
    dateFormats: ['MM/DD', 'MM/DD/YYYY', 'M/D'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*withdrawals.*deposits.*ending.*balance',
      'date.*check.*description.*credits.*debits.*balance',
    ],
    transactionPatterns: [
      {
        id: 'wf-online',
        bankProfileId: 'wells-fargo',
        pattern: 'ONLINE TRANSFER.*(?:FROM|TO)',
        type: 'transfer',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'wf-atm',
        bankProfileId: 'wells-fargo',
        pattern: 'ATM.*(?:WITHDRAWAL|DEPOSIT)',
        type: 'atm',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'wf-purchase',
        bankProfileId: 'wells-fargo',
        pattern: 'PURCHASE AUTHORIZED ON',
        type: 'pos',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 2,
      },
    ],
    balancePatterns: [
      'beginning balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'ending balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
      'account number',
      'statement period',
    ],
  },
  {
    id: 'td-bank',
    name: 'TD Bank',
    aliases: ['td bank', 'td', 'toronto dominion'],
    dateFormats: ['MM/DD/YYYY', 'MM/DD', 'DD-MMM-YYYY'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*debits.*credits.*balance',
      'post date.*description.*amount.*balance',
    ],
    transactionPatterns: [
      {
        id: 'td-visa',
        bankProfileId: 'td-bank',
        pattern: 'VISA.*(?:PURCHASE|PAYMENT)',
        type: 'pos',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'td-direct',
        bankProfileId: 'td-bank',
        pattern: 'DIRECT.*(?:DEPOSIT|DEBIT)',
        type: 'ach',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'previous balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'current balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
      'continued',
    ],
  },
  {
    id: 'capital-one',
    name: 'Capital One',
    aliases: ['capital one', 'capitalone', 'cap one'],
    dateFormats: ['MMM DD, YYYY', 'MM/DD/YYYY', 'MM/DD'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*transaction.*amount.*balance',
      'date.*description.*credits.*debits.*balance',
    ],
    transactionPatterns: [
      {
        id: 'cap1-transfer',
        bankProfileId: 'capital-one',
        pattern: 'TRANSFER.*(?:FROM|TO)',
        type: 'transfer',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'cap1-interest',
        bankProfileId: 'capital-one',
        pattern: 'INTEREST.*(?:PAID|EARNED)',
        type: 'interest',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'opening balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'closing balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
      'summary',
    ],
  },
  {
    id: 'amex',
    name: 'American Express',
    aliases: ['american express', 'amex', 'americanexpress'],
    dateFormats: ['MM/DD/YY', 'MM/DD/YYYY', 'MMM DD'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*amount',
      'date of transaction.*merchant.*amount',
    ],
    transactionPatterns: [
      {
        id: 'amex-payment',
        bankProfileId: 'amex',
        pattern: 'PAYMENT.*(?:RECEIVED|THANK YOU)',
        type: 'payment',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'amex-refund',
        bankProfileId: 'amex',
        pattern: '(?:REFUND|CREDIT|RETURN)',
        type: 'refund',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 2,
      },
    ],
    balancePatterns: [
      'previous balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'new balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
      'cardmember since',
    ],
  },
  {
    id: 'bank-of-america',
    name: 'Bank of America',
    aliases: ['bank of america', 'bofa', 'boa', 'bankofamerica'],
    dateFormats: ['MM/DD/YYYY', 'MM/DD/YY', 'MM/DD'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*withdrawals.*deposits.*running balance',
      'date.*check.*description.*amount.*balance',
    ],
    transactionPatterns: [
      {
        id: 'bofa-online',
        bankProfileId: 'bank-of-america',
        pattern: 'ONLINE BANKING.*(?:PAYMENT|TRANSFER)',
        type: 'transfer',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'bofa-zelle',
        bankProfileId: 'bank-of-america',
        pattern: 'ZELLE.*(?:PAYMENT|TRANSFER)',
        type: 'transfer',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'bofa-checkcard',
        bankProfileId: 'bank-of-america',
        pattern: 'CHECKCARD\\s+\\d+',
        type: 'pos',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 2,
      },
    ],
    balancePatterns: [
      'beginning balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'ending balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+ of \\d+',
      'account summary',
    ],
  },
  {
    id: 'citi',
    name: 'Citibank',
    aliases: ['citibank', 'citi', 'citicorp'],
    dateFormats: ['MM/DD', 'MM/DD/YYYY', 'MM/DD/YY'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*credits.*debits.*balance',
      'trans date.*post date.*description.*amount',
    ],
    transactionPatterns: [
      {
        id: 'citi-payment',
        bankProfileId: 'citi',
        pattern: 'PAYMENT.*(?:RECEIVED|THANK)',
        type: 'payment',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
      {
        id: 'citi-fee',
        bankProfileId: 'citi',
        pattern: '(?:SERVICE|MONTHLY|ANNUAL).*FEE',
        type: 'fee',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'previous balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'new balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
      'continued',
    ],
  },
  {
    id: 'pnc',
    name: 'PNC Bank',
    aliases: ['pnc', 'pnc bank'],
    dateFormats: ['MM/DD/YYYY', 'MM/DD', 'M/D/YY'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*withdrawals.*deposits.*balance',
    ],
    transactionPatterns: [
      {
        id: 'pnc-transfer',
        bankProfileId: 'pnc',
        pattern: 'TRANSFER.*(?:FROM|TO)',
        type: 'transfer',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'beginning balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'ending balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
    ],
  },
  {
    id: 'us-bank',
    name: 'US Bank',
    aliases: ['us bank', 'usbank', 'u.s. bank'],
    dateFormats: ['MM/DD/YYYY', 'MM/DD', 'MM-DD-YYYY'],
    columnOrder: ['date', 'description', 'debit', 'credit', 'balance'],
    headerPatterns: [
      'date.*description.*amount.*balance',
    ],
    transactionPatterns: [
      {
        id: 'usb-debit',
        bankProfileId: 'us-bank',
        pattern: 'DEBIT CARD.*(?:PURCHASE|PAYMENT)',
        type: 'pos',
        descriptionGroup: 0,
        amountGroup: 1,
        priority: 1,
      },
    ],
    balancePatterns: [
      'beginning balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
      'ending balance[:\\s]+\\$?([\\d,]+\\.\\d{2})',
    ],
    skipPatterns: [
      'page \\d+',
    ],
  },
]

// Transaction type inference from description
export const TRANSACTION_TYPE_KEYWORDS: Record<TransactionType, string[]> = {
  deposit: ['deposit', 'credit', 'incoming', 'received'],
  withdrawal: ['withdrawal', 'debit', 'outgoing'],
  transfer: ['transfer', 'xfer', 'zelle', 'venmo', 'paypal'],
  payment: ['payment', 'pay', 'bill pay'],
  fee: ['fee', 'charge', 'service charge', 'maintenance fee', 'overdraft'],
  interest: ['interest', 'int paid', 'int earned', 'dividend'],
  check: ['check', 'chk', 'ck #'],
  atm: ['atm', 'cash withdrawal', 'cash deposit'],
  pos: ['pos', 'purchase', 'debit card', 'checkcard', 'visa', 'mastercard'],
  ach: ['ach', 'direct deposit', 'direct debit', 'electronic'],
  wire: ['wire', 'wire transfer', 'swift'],
  refund: ['refund', 'return', 'credit adjustment', 'reversal'],
  adjustment: ['adjustment', 'correction', 'adj'],
  other: [],
}

/**
 * Detect bank from statement text
 */
export function detectBankFromText(text: string): BankProfile | null {
  const lowerText = text.toLowerCase()

  for (const profile of DEFAULT_BANK_PROFILES) {
    // Check for bank name
    if (lowerText.includes(profile.name.toLowerCase())) {
      return profile
    }

    // Check for aliases
    for (const alias of profile.aliases) {
      if (lowerText.includes(alias.toLowerCase())) {
        return profile
      }
    }
  }

  return null
}

/**
 * Infer transaction type from description
 */
export function inferTransactionType(description: string): TransactionType {
  const lowerDesc = description.toLowerCase()

  for (const [type, keywords] of Object.entries(TRANSACTION_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerDesc.includes(keyword)) {
        return type as TransactionType
      }
    }
  }

  return 'other'
}

/**
 * Get bank profile by ID
 */
export function getBankProfileById(id: string): BankProfile | null {
  return DEFAULT_BANK_PROFILES.find(p => p.id === id) || null
}

/**
 * Get all bank profiles
 */
export function getAllBankProfiles(): BankProfile[] {
  return DEFAULT_BANK_PROFILES
}
