import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import type { Transaction, ParsedStatement, TransactionType } from '@/lib/bank-statements/types'
import { detectBankFromText, inferTransactionType, DEFAULT_BANK_PROFILES } from '@/lib/bank-statements/bank-profiles'
import { calculateAccuracyMetrics } from '@/lib/bank-statements/audit-system'
import { applyLearnedPatternsToTransactions } from '@/lib/bank-statements/learning-store'
import { saveParsedStatement } from '@/lib/bank-statements/supabase-storage'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const bankHint = formData.get('bankHint') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    if (!file.type.includes('pdf')) {
      return NextResponse.json({ error: 'File must be a PDF' }, { status: 400 })
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 })
    }

    // Convert PDF to base64 for Claude
    const arrayBuffer = await file.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')

    // Use Claude to extract transactions from the PDF
    const extractionResult = await extractTransactionsWithClaude(base64, file.name, bankHint)

    if (!extractionResult.success) {
      return NextResponse.json({ error: extractionResult.error }, { status: 500 })
    }

    const statement = extractionResult.statement!

    // Apply learned patterns to improve classification
    statement.transactions = await applyLearnedPatternsToTransactions(
      statement.transactions,
      statement.bankProfileId || undefined
    )

    // Calculate accuracy metrics
    statement.accuracy = calculateAccuracyMetrics(statement)

    // Save to Supabase for history
    await saveParsedStatement(statement)

    return NextResponse.json({
      success: true,
      statement,
    })
  } catch (error) {
    console.error('[bank-statements] Parse error:', error)
    return NextResponse.json(
      { error: 'Failed to parse bank statement' },
      { status: 500 }
    )
  }
}

async function extractTransactionsWithClaude(
  base64Pdf: string,
  fileName: string,
  bankHint?: string | null
): Promise<{ success: boolean; statement?: ParsedStatement; error?: string }> {
  try {
    const systemPrompt = `You are a bank statement parser. Extract all transactions from the bank statement PDF.

For each transaction, extract:
- date (in YYYY-MM-DD format)
- description (the full transaction description)
- debit (amount withdrawn/spent, null if not a debit)
- credit (amount deposited/received, null if not a credit)
- balance (running balance after transaction, null if not shown)
- type (one of: deposit, withdrawal, transfer, payment, fee, interest, check, atm, pos, ach, wire, refund, adjustment, other)

Also extract:
- bankName (the name of the bank)
- accountNumber (masked account number if shown, e.g., "****1234")
- statementPeriodStart (start date in YYYY-MM-DD)
- statementPeriodEnd (end date in YYYY-MM-DD)
- openingBalance (beginning balance)
- closingBalance (ending balance)

IMPORTANT:
- Parse ALL transactions, not just a sample
- Maintain the original order of transactions
- Use positive numbers for both debits and credits
- If a transaction shows as negative, it's typically a debit
- Be precise with amounts - include cents
- If you can't determine if something is a debit or credit, use context clues from the description

Respond with valid JSON only, no markdown or explanation.`

    const userPrompt = `Parse this bank statement PDF and extract all transactions.
${bankHint ? `Bank hint: ${bankHint}` : ''}

Return JSON in this exact format:
{
  "bankName": "Bank Name",
  "accountNumber": "****1234",
  "statementPeriodStart": "2024-01-01",
  "statementPeriodEnd": "2024-01-31",
  "openingBalance": 1000.00,
  "closingBalance": 1500.00,
  "transactions": [
    {
      "date": "2024-01-05",
      "description": "DIRECT DEPOSIT PAYROLL",
      "debit": null,
      "credit": 2500.00,
      "balance": 3500.00,
      "type": "ach"
    }
  ]
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Pdf,
              },
            },
            {
              type: 'text',
              text: userPrompt,
            },
          ],
        },
      ],
      system: systemPrompt,
    })

    // Extract the text content from Claude's response
    const textContent = response.content.find(c => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return { success: false, error: 'No text response from Claude' }
    }

    // Parse the JSON response
    let parsed: any
    try {
      // Try to extract JSON from the response (in case there's any surrounding text)
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return { success: false, error: 'Could not find JSON in response' }
      }
      parsed = JSON.parse(jsonMatch[0])
    } catch (parseError) {
      console.error('[bank-statements] JSON parse error:', parseError)
      return { success: false, error: 'Failed to parse Claude response as JSON' }
    }

    // Detect bank profile
    const bankProfile = bankHint
      ? DEFAULT_BANK_PROFILES.find(p =>
          p.name.toLowerCase().includes(bankHint.toLowerCase()) ||
          p.aliases.some(a => a.toLowerCase().includes(bankHint.toLowerCase()))
        )
      : detectBankFromText(parsed.bankName || '')

    // Transform transactions to our format
    const transactions: Transaction[] = (parsed.transactions || []).map((tx: any, index: number) => {
      const type = tx.type as TransactionType || inferTransactionType(tx.description || '')

      return {
        id: `tx-${Date.now()}-${index}`,
        date: tx.date || '',
        description: tx.description || '',
        debit: tx.debit !== null && tx.debit !== undefined ? Number(tx.debit) : null,
        credit: tx.credit !== null && tx.credit !== undefined ? Number(tx.credit) : null,
        balance: tx.balance !== null && tx.balance !== undefined ? Number(tx.balance) : null,
        type,
        confidence: calculateConfidence(tx),
        rawText: tx.description,
        verified: false,
        corrected: false,
      }
    })

    const statement: ParsedStatement = {
      id: `stmt-${Date.now()}`,
      fileName,
      bankName: parsed.bankName || null,
      bankProfileId: bankProfile?.id || null,
      accountNumber: parsed.accountNumber || null,
      statementPeriod: {
        start: parsed.statementPeriodStart || null,
        end: parsed.statementPeriodEnd || null,
      },
      openingBalance: parsed.openingBalance !== null && parsed.openingBalance !== undefined
        ? Number(parsed.openingBalance)
        : null,
      closingBalance: parsed.closingBalance !== null && parsed.closingBalance !== undefined
        ? Number(parsed.closingBalance)
        : null,
      transactions,
      accuracy: {
        overallScore: 0,
        balanceVerified: false,
        balanceDiscrepancy: null,
        duplicatesFound: 0,
        lowConfidenceCount: 0,
        totalTransactions: transactions.length,
        verifiedTransactions: 0,
      },
      rawText: '',
      parsedAt: new Date().toISOString(),
    }

    return { success: true, statement }
  } catch (error) {
    console.error('[bank-statements] Claude extraction error:', error)
    return { success: false, error: 'Failed to extract transactions from PDF' }
  }
}

function calculateConfidence(tx: any): number {
  let confidence = 85 // Base confidence

  // Increase confidence if we have complete data
  if (tx.date && tx.description && (tx.debit !== null || tx.credit !== null)) {
    confidence += 5
  }

  // Increase if we have balance
  if (tx.balance !== null) {
    confidence += 5
  }

  // Decrease if description is very short
  if (tx.description && tx.description.length < 10) {
    confidence -= 10
  }

  // Decrease if type is 'other'
  if (tx.type === 'other') {
    confidence -= 10
  }

  return Math.max(50, Math.min(100, confidence))
}
