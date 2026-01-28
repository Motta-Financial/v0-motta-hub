import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ExportRequest, ExportResponse, BankTransaction } from '@/lib/bank-statements/types'

export async function POST(request: NextRequest): Promise<NextResponse<ExportResponse>> {
  try {
    // Verify authentication
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body: ExportRequest = await request.json()
    const { transactions, format, bankName, statementPeriod } = body

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No transactions provided' },
        { status: 400 }
      )
    }

    if (format !== 'csv' && format !== 'excel') {
      return NextResponse.json(
        { success: false, error: 'Invalid format. Use "csv" or "excel"' },
        { status: 400 }
      )
    }

    // Generate filename
    const dateStr = statementPeriod
      ? `${statementPeriod.startDate}_to_${statementPeriod.endDate}`
      : new Date().toISOString().split('T')[0]
    const bankStr = bankName ? bankName.toLowerCase().replace(/\s+/g, '_') : 'bank'
    const baseFilename = `${bankStr}_statement_${dateStr}`

    if (format === 'csv') {
      const csvContent = generateCSV(transactions)
      const base64Data = Buffer.from(csvContent, 'utf-8').toString('base64')

      return NextResponse.json({
        success: true,
        data: base64Data,
        filename: `${baseFilename}.csv`,
        mimeType: 'text/csv',
      })
    } else {
      // Generate Excel-compatible XML (SpreadsheetML)
      const excelContent = generateExcelXML(transactions, bankName, statementPeriod)
      const base64Data = Buffer.from(excelContent, 'utf-8').toString('base64')

      return NextResponse.json({
        success: true,
        data: base64Data,
        filename: `${baseFilename}.xls`,
        mimeType: 'application/vnd.ms-excel',
      })
    }
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to export data' },
      { status: 500 }
    )
  }
}

function generateCSV(transactions: BankTransaction[]): string {
  const headers = ['Date', 'Description', 'Debit', 'Credit', 'Balance', 'Category', 'Check #', 'Reference']
  const rows = transactions.map((txn) => [
    txn.date,
    `"${(txn.description || '').replace(/"/g, '""')}"`,
    txn.debit !== null ? txn.debit.toFixed(2) : '',
    txn.credit !== null ? txn.credit.toFixed(2) : '',
    txn.balance !== null ? txn.balance.toFixed(2) : '',
    txn.category ? `"${txn.category.replace(/"/g, '""')}"` : '',
    txn.checkNumber || '',
    txn.reference || '',
  ])

  // Add summary rows
  const totalDebits = transactions.reduce((sum, t) => sum + (t.debit || 0), 0)
  const totalCredits = transactions.reduce((sum, t) => sum + (t.credit || 0), 0)

  rows.push([]) // Empty row
  rows.push(['', 'TOTAL DEBITS', totalDebits.toFixed(2), '', '', '', '', ''])
  rows.push(['', 'TOTAL CREDITS', '', totalCredits.toFixed(2), '', '', '', ''])
  rows.push(['', 'NET CHANGE', '', '', (totalCredits - totalDebits).toFixed(2), '', '', ''])

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n')
}

function generateExcelXML(
  transactions: BankTransaction[],
  bankName?: string,
  statementPeriod?: { startDate: string; endDate: string }
): string {
  const totalDebits = transactions.reduce((sum, t) => sum + (t.debit || 0), 0)
  const totalCredits = transactions.reduce((sum, t) => sum + (t.credit || 0), 0)

  const escapeXML = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }

  const dataRows = transactions
    .map(
      (txn) => `
    <Row>
      <Cell><Data ss:Type="String">${escapeXML(txn.date || '')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXML(txn.description || '')}</Data></Cell>
      <Cell><Data ss:Type="Number">${txn.debit !== null ? txn.debit : ''}</Data></Cell>
      <Cell><Data ss:Type="Number">${txn.credit !== null ? txn.credit : ''}</Data></Cell>
      <Cell><Data ss:Type="Number">${txn.balance !== null ? txn.balance : ''}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXML(txn.category || '')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXML(txn.checkNumber || '')}</Data></Cell>
      <Cell><Data ss:Type="String">${escapeXML(txn.reference || '')}</Data></Cell>
    </Row>`
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#CCCCCC" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Currency">
      <NumberFormat ss:Format="#,##0.00"/>
    </Style>
    <Style ss:ID="Total">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E6E6E6" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Bank Statement">
    <Table>
      <Column ss:Width="80"/>
      <Column ss:Width="300"/>
      <Column ss:Width="80"/>
      <Column ss:Width="80"/>
      <Column ss:Width="80"/>
      <Column ss:Width="100"/>
      <Column ss:Width="60"/>
      <Column ss:Width="100"/>
      ${bankName ? `<Row><Cell ss:MergeAcross="7"><Data ss:Type="String">${escapeXML(bankName)} Statement</Data></Cell></Row>` : ''}
      ${statementPeriod ? `<Row><Cell ss:MergeAcross="7"><Data ss:Type="String">Period: ${escapeXML(statementPeriod.startDate)} to ${escapeXML(statementPeriod.endDate)}</Data></Cell></Row>` : ''}
      <Row></Row>
      <Row ss:StyleID="Header">
        <Cell><Data ss:Type="String">Date</Data></Cell>
        <Cell><Data ss:Type="String">Description</Data></Cell>
        <Cell><Data ss:Type="String">Debit</Data></Cell>
        <Cell><Data ss:Type="String">Credit</Data></Cell>
        <Cell><Data ss:Type="String">Balance</Data></Cell>
        <Cell><Data ss:Type="String">Category</Data></Cell>
        <Cell><Data ss:Type="String">Check #</Data></Cell>
        <Cell><Data ss:Type="String">Reference</Data></Cell>
      </Row>
      ${dataRows}
      <Row></Row>
      <Row ss:StyleID="Total">
        <Cell></Cell>
        <Cell><Data ss:Type="String">TOTAL DEBITS</Data></Cell>
        <Cell ss:StyleID="Currency"><Data ss:Type="Number">${totalDebits.toFixed(2)}</Data></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
      </Row>
      <Row ss:StyleID="Total">
        <Cell></Cell>
        <Cell><Data ss:Type="String">TOTAL CREDITS</Data></Cell>
        <Cell></Cell>
        <Cell ss:StyleID="Currency"><Data ss:Type="Number">${totalCredits.toFixed(2)}</Data></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
      </Row>
      <Row ss:StyleID="Total">
        <Cell></Cell>
        <Cell><Data ss:Type="String">NET CHANGE</Data></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell ss:StyleID="Currency"><Data ss:Type="Number">${(totalCredits - totalDebits).toFixed(2)}</Data></Cell>
        <Cell></Cell>
        <Cell></Cell>
        <Cell></Cell>
      </Row>
    </Table>
  </Worksheet>
</Workbook>`
}
