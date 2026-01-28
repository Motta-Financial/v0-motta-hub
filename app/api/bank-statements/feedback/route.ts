import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseStorage } from '@/lib/bank-statements/supabase-storage'
import { learningStore } from '@/lib/bank-statements/learning-store'
import type { SupportedBank, BankTransaction } from '@/lib/bank-statements/types'

export interface FeedbackRequest {
  transactionId: string
  bankId: SupportedBank
  corrections: Array<{
    field: 'date' | 'description' | 'debit' | 'credit' | 'balance' | 'category'
    originalValue: string | number | null
    correctedValue: string | number | null
  }>
  statementId?: string
}

export interface FeedbackResponse {
  success: boolean
  message?: string
  patternsLearned?: number
  error?: string
}

export async function POST(request: NextRequest): Promise<NextResponse<FeedbackResponse>> {
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

    const body: FeedbackRequest = await request.json()
    const { transactionId, bankId, corrections, statementId } = body

    if (!transactionId || !bankId || !corrections || corrections.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Save each correction to the database
    const savedCorrections = []
    for (const correction of corrections) {
      const feedback = await supabaseStorage.saveFeedback({
        user_id: user.id,
        transaction_id: transactionId,
        bank_id: bankId,
        field: correction.field,
        original_value: correction.originalValue !== null ? String(correction.originalValue) : null,
        corrected_value: correction.correctedValue !== null ? String(correction.correctedValue) : null,
      })

      if (feedback) {
        savedCorrections.push(feedback)

        // Add to in-memory learning store
        learningStore.addCorrection({
          transactionId,
          field: correction.field,
          originalValue: correction.originalValue,
          correctedValue: correction.correctedValue,
          bankId,
          userId: user.id,
        })
      }
    }

    // Log the feedback event
    await supabaseStorage.logEvent(bankId, 'correction', {
      transactionId,
      correctionsCount: corrections.length,
      fields: corrections.map(c => c.field),
      userId: user.id,
      statementId,
    })

    // Try to learn new patterns from accumulated corrections
    const recentFeedback = await supabaseStorage.loadFeedback(bankId, 50)
    const correctionForLearning = recentFeedback.map(f => ({
      transactionId: f.transaction_id,
      field: f.field as any,
      originalValue: f.original_value,
      correctedValue: f.corrected_value,
      bankId: f.bank_id,
      userId: f.user_id,
      createdAt: f.created_at,
    }))

    const newPatterns = learningStore.learnFromCorrections(correctionForLearning)

    // Save new patterns to database
    if (newPatterns.length > 0) {
      await supabaseStorage.savePatternsBulk(
        newPatterns.map(p => ({
          bank_id: p.bankId,
          pattern_type: p.patternType,
          original_value: p.originalValue,
          corrected_value: p.correctedValue,
          confidence: p.confidence,
          occurrences: p.occurrences,
        }))
      )

      // Log pattern learning
      await supabaseStorage.logEvent(bankId, 'pattern_learned', {
        patternsCount: newPatterns.length,
        patterns: newPatterns.map(p => ({
          type: p.patternType,
          original: p.originalValue,
          corrected: p.correctedValue,
          confidence: p.confidence,
        })),
      })
    }

    // Update accuracy metrics
    const currentMetrics = await supabaseStorage.loadMetrics(bankId)
    const existingMetrics = currentMetrics[0]

    const totalCorrections = (existingMetrics?.total_corrections || 0) + corrections.length
    const totalParsed = existingMetrics?.total_transactions_parsed || 1
    const accuracyRate = Math.max(0, 1 - (totalCorrections / Math.max(totalParsed, totalCorrections)))
    const improvementTrend = await supabaseStorage.calculateImprovementTrend(bankId)

    await supabaseStorage.updateMetrics({
      bank_id: bankId,
      total_transactions_parsed: totalParsed,
      total_corrections: totalCorrections,
      accuracy_rate: accuracyRate,
      confidence_score: existingMetrics?.confidence_score || 0.5,
      improvement_trend: improvementTrend,
      last_updated: new Date().toISOString(),
    })

    return NextResponse.json({
      success: true,
      message: `Saved ${savedCorrections.length} corrections`,
      patternsLearned: newPatterns.length,
    })
  } catch (error) {
    console.error('Feedback error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save feedback' },
      { status: 500 }
    )
  }
}

// Bulk feedback for multiple transactions
export async function PUT(request: NextRequest): Promise<NextResponse<FeedbackResponse>> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body: {
      bankId: SupportedBank
      transactions: Array<{
        transactionId: string
        corrections: FeedbackRequest['corrections']
      }>
    } = await request.json()

    const { bankId, transactions } = body

    if (!bankId || !transactions || transactions.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      )
    }

    let totalSaved = 0
    let totalPatternsLearned = 0

    for (const txn of transactions) {
      for (const correction of txn.corrections) {
        const feedback = await supabaseStorage.saveFeedback({
          user_id: user.id,
          transaction_id: txn.transactionId,
          bank_id: bankId,
          field: correction.field,
          original_value: correction.originalValue !== null ? String(correction.originalValue) : null,
          corrected_value: correction.correctedValue !== null ? String(correction.correctedValue) : null,
        })

        if (feedback) {
          totalSaved++
          learningStore.addCorrection({
            transactionId: txn.transactionId,
            field: correction.field,
            originalValue: correction.originalValue,
            correctedValue: correction.correctedValue,
            bankId,
            userId: user.id,
          })
        }
      }
    }

    // Learn from all corrections
    const recentFeedback = await supabaseStorage.loadFeedback(bankId, 100)
    const correctionForLearning = recentFeedback.map(f => ({
      transactionId: f.transaction_id,
      field: f.field as any,
      originalValue: f.original_value,
      correctedValue: f.corrected_value,
      bankId: f.bank_id,
      userId: f.user_id,
      createdAt: f.created_at,
    }))

    const newPatterns = learningStore.learnFromCorrections(correctionForLearning)
    totalPatternsLearned = newPatterns.length

    if (newPatterns.length > 0) {
      await supabaseStorage.savePatternsBulk(
        newPatterns.map(p => ({
          bank_id: p.bankId,
          pattern_type: p.patternType,
          original_value: p.originalValue,
          corrected_value: p.correctedValue,
          confidence: p.confidence,
          occurrences: p.occurrences,
        }))
      )
    }

    // Log bulk feedback
    await supabaseStorage.logEvent(bankId, 'correction', {
      bulkCorrection: true,
      transactionsCount: transactions.length,
      correctionsCount: totalSaved,
      userId: user.id,
    })

    return NextResponse.json({
      success: true,
      message: `Saved ${totalSaved} corrections across ${transactions.length} transactions`,
      patternsLearned: totalPatternsLearned,
    })
  } catch (error) {
    console.error('Bulk feedback error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to save feedback' },
      { status: 500 }
    )
  }
}
