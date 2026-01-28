import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseStorage } from '@/lib/bank-statements/supabase-storage'
import type { SupportedBank } from '@/lib/bank-statements/types'

export interface MetricsResponse {
  success: boolean
  data?: {
    overall: {
      totalTransactionsParsed: number
      totalCorrections: number
      overallAccuracy: number
      averageConfidence: number
      banksProcessed: number
      improvementTrend: number
    }
    byBank: Array<{
      bankId: SupportedBank
      bankName: string
      transactionsParsed: number
      corrections: number
      accuracy: number
      confidence: number
      improvementTrend: number
      lastUpdated: string
    }>
    recentActivity: {
      last24Hours: {
        parses: number
        corrections: number
        patternsLearned: number
      }
      last7Days: {
        parses: number
        corrections: number
        patternsLearned: number
      }
      last30Days: {
        parses: number
        corrections: number
        patternsLearned: number
      }
    }
    topPatterns: Array<{
      bankId: SupportedBank
      patternType: string
      originalValue: string
      correctedValue: string
      confidence: number
      occurrences: number
    }>
  }
  error?: string
}

const BANK_NAMES: Record<SupportedBank, string> = {
  chase: 'Chase',
  wells_fargo: 'Wells Fargo',
  td_bank: 'TD Bank',
  capital_one: 'Capital One',
  amex: 'American Express',
  bank_of_america: 'Bank of America',
  citibank: 'Citibank',
  us_bank: 'U.S. Bank',
  pnc: 'PNC Bank',
  truist: 'Truist',
  other: 'Other',
}

export async function GET(request: NextRequest): Promise<NextResponse<MetricsResponse>> {
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

    // Get bank filter from query params
    const { searchParams } = new URL(request.url)
    const bankFilter = searchParams.get('bank') as SupportedBank | null

    // Load all metrics
    const metricsRecords = await supabaseStorage.loadMetrics(bankFilter || undefined)

    // Calculate overall stats
    let totalParsed = 0
    let totalCorrections = 0
    let totalConfidence = 0

    const byBank = metricsRecords.map(record => {
      totalParsed += record.total_transactions_parsed
      totalCorrections += record.total_corrections
      totalConfidence += record.confidence_score

      return {
        bankId: record.bank_id,
        bankName: BANK_NAMES[record.bank_id] || record.bank_id,
        transactionsParsed: record.total_transactions_parsed,
        corrections: record.total_corrections,
        accuracy: Math.round(record.accuracy_rate * 100),
        confidence: Math.round(record.confidence_score * 100),
        improvementTrend: record.improvement_trend,
        lastUpdated: record.last_updated,
      }
    })

    // Sort by transactions parsed
    byBank.sort((a, b) => b.transactionsParsed - a.transactionsParsed)

    const overallAccuracy = totalParsed > 0
      ? Math.round((1 - totalCorrections / totalParsed) * 100)
      : 100
    const averageConfidence = metricsRecords.length > 0
      ? Math.round((totalConfidence / metricsRecords.length) * 100)
      : 50

    // Calculate overall improvement trend
    let totalTrend = 0
    for (const record of metricsRecords) {
      totalTrend += record.improvement_trend
    }
    const overallTrend = metricsRecords.length > 0
      ? Math.round(totalTrend / metricsRecords.length)
      : 0

    // Get recent activity from learning log
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    // Query learning log for activity counts
    const { data: recentLogs } = await supabase
      .from('learning_log')
      .select('event_type, created_at')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false })

    const countActivity = (logs: any[], since: Date) => {
      const filtered = logs?.filter(l => new Date(l.created_at) >= since) || []
      return {
        parses: filtered.filter(l => l.event_type === 'parse').length,
        corrections: filtered.filter(l => l.event_type === 'correction').length,
        patternsLearned: filtered.filter(l => l.event_type === 'pattern_learned').length,
      }
    }

    const recentActivity = {
      last24Hours: countActivity(recentLogs || [], oneDayAgo),
      last7Days: countActivity(recentLogs || [], sevenDaysAgo),
      last30Days: countActivity(recentLogs || [], thirtyDaysAgo),
    }

    // Get top patterns
    const patterns = await supabaseStorage.loadPatterns(bankFilter || undefined)
    const topPatterns = patterns
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 10)
      .map(p => ({
        bankId: p.bank_id,
        patternType: p.pattern_type,
        originalValue: p.original_value,
        correctedValue: p.corrected_value,
        confidence: Math.round(p.confidence * 100),
        occurrences: p.occurrences,
      }))

    return NextResponse.json({
      success: true,
      data: {
        overall: {
          totalTransactionsParsed: totalParsed,
          totalCorrections,
          overallAccuracy,
          averageConfidence,
          banksProcessed: metricsRecords.length,
          improvementTrend: overallTrend,
        },
        byBank,
        recentActivity,
        topPatterns,
      },
    })
  } catch (error) {
    console.error('Metrics error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load metrics' },
      { status: 500 }
    )
  }
}

// Update metrics (called after parsing)
export async function POST(request: NextRequest): Promise<NextResponse<{ success: boolean; error?: string }>> {
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
      transactionsParsed: number
      confidence: number
    } = await request.json()

    const { bankId, transactionsParsed, confidence } = body

    // Load current metrics
    const currentMetrics = await supabaseStorage.loadMetrics(bankId)
    const existing = currentMetrics[0]

    const newTotalParsed = (existing?.total_transactions_parsed || 0) + transactionsParsed
    const totalCorrections = existing?.total_corrections || 0
    const accuracyRate = newTotalParsed > 0
      ? Math.max(0, 1 - totalCorrections / newTotalParsed)
      : 1

    // Calculate weighted average confidence
    const oldWeight = existing?.total_transactions_parsed || 0
    const newWeight = transactionsParsed
    const totalWeight = oldWeight + newWeight
    const weightedConfidence = totalWeight > 0
      ? ((existing?.confidence_score || 0.5) * oldWeight + confidence * newWeight) / totalWeight
      : confidence

    const improvementTrend = await supabaseStorage.calculateImprovementTrend(bankId)

    await supabaseStorage.updateMetrics({
      bank_id: bankId,
      total_transactions_parsed: newTotalParsed,
      total_corrections: totalCorrections,
      accuracy_rate: accuracyRate,
      confidence_score: weightedConfidence,
      improvement_trend: improvementTrend,
      last_updated: new Date().toISOString(),
    })

    // Log parse event
    await supabaseStorage.logEvent(bankId, 'parse', {
      transactionsParsed,
      confidence,
      userId: user.id,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update metrics error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update metrics' },
      { status: 500 }
    )
  }
}
