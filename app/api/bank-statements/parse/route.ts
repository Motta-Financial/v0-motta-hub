import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import type {
  BankStatementParseRequest,
  BankStatementParseResponse,
  ParsedBankStatement,
  BankTransaction,
} from '@/lib/bank-statements/types'

export const maxDuration = 60

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const EXTRACTION_PROMPT = `You are an expert at extracting financial data from bank statements. Analyze the provided bank statement PDF and extract all transaction data.

Return a JSON object with the following structure:
{
  "bankName": "Name of the bank",
  "accountNumber": "Last 4 digits only (e.g., '****1234')",
  "accountType": "Checking, Savings, Credit Card, etc.",
  "statementPeriod": {
    "startDate": "YYYY-MM-DD",
    "endDate": "YYYY-MM-DD"
  },
  "openingBalance": 0.00,
  "closingBalance": 0.00,
  "transactions": [
    {
      "id": "unique-id-1",
      "date": "YYYY-MM-DD",
      "description": "Transaction description",
      "debit": null or amount,
      "credit": null or amount,
      "balance": null or running balance if shown,
      "category": "optional category if determinable",
      "checkNumber": "optional check number",
      "reference": "optional reference number"
    }
  ],
  "totalDebits": 0.00,
  "totalCredits": 0.00,
  "currency": "USD"
}

Important rules:
1. Dates must be in YYYY-MM-DD format
2. All monetary amounts should be positive numbers (use debit/credit columns to indicate direction)
3. For credit cards: purchases are debits, payments are credits
4. For bank accounts: withdrawals/payments are debits, deposits are credits
5. Generate unique IDs for each transaction (use format: "txn-{index}")
6. If balance is not shown per transaction, set it to null
7. Extract ALL transactions from the statement
8. Calculate totalDebits and totalCredits by summing the respective columns
9. Only include the last 4 digits of account numbers for security

Return ONLY the JSON object, no additional text or explanation.`

export async function POST(request: NextRequest): Promise<NextResponse<BankStatementParseResponse>> {
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

    const body: BankStatementParseRequest = await request.json()
    const { fileContent, fileName, bankHint } = body

    if (!fileContent) {
      return NextResponse.json(
        { success: false, error: 'No file content provided' },
        { status: 400 }
      )
    }

    // Build the prompt with optional bank hint
    let prompt = EXTRACTION_PROMPT
    if (bankHint && bankHint !== 'other') {
      prompt += `\n\nNote: The user indicated this is a ${bankHint.replace('_', ' ')} statement. Use this as context for parsing the format.`
    }

    // Call Claude API with the PDF
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: fileContent,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    })

    // Extract the text content from the response
    const textContent = response.content.find((block) => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json(
        { success: false, error: 'No response from AI' },
        { status: 500 }
      )
    }

    // Parse the JSON response
    let parsedData: ParsedBankStatement
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('No JSON found in response')
      }
      parsedData = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('Failed to parse AI response:', textContent.text)
      return NextResponse.json(
        { success: false, error: 'Failed to parse bank statement data' },
        { status: 500 }
      )
    }

    // Validate and normalize the data
    const normalizedData = normalizeTransactionData(parsedData)

    // Calculate confidence based on data completeness
    const confidence = calculateConfidence(normalizedData)

    return NextResponse.json({
      success: true,
      data: normalizedData,
      confidence,
    })
  } catch (error) {
    console.error('Bank statement parse error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to parse bank statement' },
      { status: 500 }
    )
  }
}

function normalizeTransactionData(data: ParsedBankStatement): ParsedBankStatement {
  // Ensure all transactions have required fields
  const transactions: BankTransaction[] = (data.transactions || []).map((txn, index) => ({
    id: txn.id || `txn-${index + 1}`,
    date: txn.date || '',
    description: txn.description || '',
    debit: typeof txn.debit === 'number' ? txn.debit : null,
    credit: typeof txn.credit === 'number' ? txn.credit : null,
    balance: typeof txn.balance === 'number' ? txn.balance : null,
    category: txn.category,
    checkNumber: txn.checkNumber,
    reference: txn.reference,
  }))

  // Recalculate totals
  const totalDebits = transactions.reduce((sum, txn) => sum + (txn.debit || 0), 0)
  const totalCredits = transactions.reduce((sum, txn) => sum + (txn.credit || 0), 0)

  return {
    bankName: data.bankName || 'Unknown Bank',
    accountNumber: data.accountNumber || '****',
    accountType: data.accountType || 'Unknown',
    statementPeriod: {
      startDate: data.statementPeriod?.startDate || '',
      endDate: data.statementPeriod?.endDate || '',
    },
    openingBalance: data.openingBalance || 0,
    closingBalance: data.closingBalance || 0,
    transactions,
    totalDebits: Math.round(totalDebits * 100) / 100,
    totalCredits: Math.round(totalCredits * 100) / 100,
    currency: data.currency || 'USD',
  }
}

function calculateConfidence(data: ParsedBankStatement): number {
  let score = 0
  const maxScore = 100

  // Has bank name (10 points)
  if (data.bankName && data.bankName !== 'Unknown Bank') score += 10

  // Has account info (10 points)
  if (data.accountNumber && data.accountNumber !== '****') score += 5
  if (data.accountType && data.accountType !== 'Unknown') score += 5

  // Has statement period (10 points)
  if (data.statementPeriod.startDate) score += 5
  if (data.statementPeriod.endDate) score += 5

  // Has transactions (40 points)
  if (data.transactions.length > 0) {
    score += 20
    // Check transaction quality
    const validDates = data.transactions.filter((t) => t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)).length
    const validAmounts = data.transactions.filter((t) => t.debit !== null || t.credit !== null).length
    score += Math.min(10, (validDates / data.transactions.length) * 10)
    score += Math.min(10, (validAmounts / data.transactions.length) * 10)
  }

  // Balance info (20 points)
  if (data.openingBalance !== 0 || data.closingBalance !== 0) score += 10
  if (data.totalDebits > 0 || data.totalCredits > 0) score += 10

  // Totals match calculation (10 points)
  const calculatedDebits = data.transactions.reduce((sum, t) => sum + (t.debit || 0), 0)
  const calculatedCredits = data.transactions.reduce((sum, t) => sum + (t.credit || 0), 0)
  if (
    Math.abs(calculatedDebits - data.totalDebits) < 0.01 &&
    Math.abs(calculatedCredits - data.totalCredits) < 0.01
  ) {
    score += 10
  }

  return Math.round((score / maxScore) * 100)
}
