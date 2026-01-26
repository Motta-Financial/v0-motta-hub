import { NextResponse } from 'next/server'
import type { Transaction, ExportOptions } from '@/lib/bank-statements/types'

export async function POST(request: Request) {
  try {
    const body: {
      transactions: Transaction[]
      options: ExportOptions
      fileName?: string
      bankName?: string
      statementPeriod?: { start: string | null; end: string | null }
    } = await request.json()

    const { transactions, options, fileName, bankName, statementPeriod } = body

    if (!transactions || !Array.isArray(transactions)) {
      return NextResponse.json(
        { error: 'No transactions provided' },
        { status: 400 }
      )
    }

    const format = options?.format || 'csv'
    const columns = options?.columns || ['date', 'description', 'debit', 'credit', 'balance', 'type']
    const includeRawText = options?.includeRawText ?? false
    const includeConfidence = options?.includeConfidence ?? false
    const dateFormat = options?.dateFormat || 'YYYY-MM-DD'

    if (format === 'csv') {
      const csv = generateCSV(transactions, columns, includeRawText, includeConfidence, dateFormat)

      const exportFileName = generateFileName(fileName, bankName, statementPeriod, 'csv')

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${exportFileName}"`,
        },
      })
    } else if (format === 'xlsx') {
      // Generate Excel-compatible CSV with BOM for proper UTF-8 handling
      const csv = generateCSV(transactions, columns, includeRawText, includeConfidence, dateFormat)
      const csvWithBom = '\ufeff' + csv // Add BOM for Excel UTF-8 compatibility

      const exportFileName = generateFileName(fileName, bankName, statementPeriod, 'csv')

      return new NextResponse(csvWithBom, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${exportFileName}"`,
        },
      })
    }

    return NextResponse.json(
      { error: 'Invalid export format' },
      { status: 400 }
    )
  } catch (error) {
    console.error('[bank-statements] Export error:', error)
    return NextResponse.json(
      { error: 'Failed to export transactions' },
      { status: 500 }
    )
  }
}

function generateCSV(
  transactions: Transaction[],
  columns: string[],
  includeRawText: boolean,
  includeConfidence: boolean,
  dateFormat: string
): string {
  // Build header row
  const allColumns = [...columns]
  if (includeRawText && !allColumns.includes('rawText')) {
    allColumns.push('rawText')
  }
  if (includeConfidence && !allColumns.includes('confidence')) {
    allColumns.push('confidence')
  }

  // Map column names to display names
  const columnDisplayNames: Record<string, string> = {
    date: 'Date',
    description: 'Description',
    debit: 'Debit',
    credit: 'Credit',
    balance: 'Balance',
    type: 'Type',
    category: 'Category',
    rawText: 'Raw Text',
    confidence: 'Confidence %',
    verified: 'Verified',
    corrected: 'Corrected',
  }

  const headers = allColumns.map(col => columnDisplayNames[col] || col)
  const rows: string[] = [headers.map(escapeCSV).join(',')]

  // Build data rows
  for (const tx of transactions) {
    const row = allColumns.map(col => {
      const value = getTransactionValue(tx, col, dateFormat)
      return escapeCSV(value)
    })
    rows.push(row.join(','))
  }

  return rows.join('\n')
}

function getTransactionValue(tx: Transaction, column: string, dateFormat: string): string {
  switch (column) {
    case 'date':
      return formatDate(tx.date, dateFormat)
    case 'description':
      return tx.description || ''
    case 'debit':
      return tx.debit !== null ? tx.debit.toFixed(2) : ''
    case 'credit':
      return tx.credit !== null ? tx.credit.toFixed(2) : ''
    case 'balance':
      return tx.balance !== null ? tx.balance.toFixed(2) : ''
    case 'type':
      return tx.type || ''
    case 'category':
      return tx.category || ''
    case 'rawText':
      return tx.rawText || ''
    case 'confidence':
      return tx.confidence?.toString() || ''
    case 'verified':
      return tx.verified ? 'Yes' : 'No'
    case 'corrected':
      return tx.corrected ? 'Yes' : 'No'
    default:
      return ''
  }
}

function formatDate(dateStr: string, format: string): string {
  if (!dateStr) return ''

  try {
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    switch (format) {
      case 'YYYY-MM-DD':
        return `${year}-${month}-${day}`
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`
      case 'DD/MM/YYYY':
        return `${day}/${month}/${year}`
      case 'MM-DD-YYYY':
        return `${month}-${day}-${year}`
      default:
        return `${year}-${month}-${day}`
    }
  } catch {
    return dateStr
  }
}

function escapeCSV(value: string): string {
  if (value === null || value === undefined) {
    return ''
  }

  const stringValue = String(value)

  // If the value contains comma, newline, or double quote, wrap in quotes
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    // Escape double quotes by doubling them
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  return stringValue
}

function generateFileName(
  originalFileName?: string,
  bankName?: string,
  statementPeriod?: { start: string | null; end: string | null },
  extension: string = 'csv'
): string {
  const parts: string[] = []

  // Add bank name if available
  if (bankName) {
    parts.push(bankName.replace(/[^a-zA-Z0-9]/g, '_'))
  }

  // Add statement period if available
  if (statementPeriod?.start && statementPeriod?.end) {
    const start = statementPeriod.start.replace(/-/g, '')
    const end = statementPeriod.end.replace(/-/g, '')
    parts.push(`${start}_to_${end}`)
  } else if (originalFileName) {
    // Use original filename without extension
    const nameWithoutExt = originalFileName.replace(/\.[^/.]+$/, '')
    parts.push(nameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_'))
  }

  // Add timestamp
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  parts.push(timestamp)

  // Join parts and add extension
  const baseName = parts.length > 0 ? parts.join('_') : 'transactions'
  return `${baseName}_export.${extension}`
}

// GET endpoint to provide export options
export async function GET() {
  return NextResponse.json({
    formats: ['csv', 'xlsx'],
    dateFormats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'MM-DD-YYYY'],
    availableColumns: [
      { id: 'date', name: 'Date', default: true },
      { id: 'description', name: 'Description', default: true },
      { id: 'debit', name: 'Debit', default: true },
      { id: 'credit', name: 'Credit', default: true },
      { id: 'balance', name: 'Balance', default: true },
      { id: 'type', name: 'Type', default: true },
      { id: 'category', name: 'Category', default: false },
      { id: 'rawText', name: 'Raw Text', default: false },
      { id: 'confidence', name: 'Confidence %', default: false },
      { id: 'verified', name: 'Verified', default: false },
      { id: 'corrected', name: 'Corrected', default: false },
    ],
  })
}
