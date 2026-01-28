import { createClient } from '@/lib/supabase/server'
import type { SupportedBank } from './types'
import type { LearnedPattern, LearningMetrics, TransactionCorrection } from './learning-store'

export interface BankProfileRecord {
  id: string
  bank_id: SupportedBank
  bank_name: string
  date_formats: any[]
  transaction_patterns: any[]
  known_errors: any[]
  balance_location: string
  debit_credit_format: string
  header_patterns: string[]
  footer_patterns: string[]
  common_ocr_errors: Record<string, string>
  created_at: string
  updated_at: string
}

export interface TransactionPatternRecord {
  id: string
  bank_id: SupportedBank
  pattern_type: string
  original_value: string
  corrected_value: string
  confidence: number
  occurrences: number
  created_at: string
  updated_at: string
}

export interface UserFeedbackRecord {
  id: string
  user_id: string
  transaction_id: string
  bank_id: SupportedBank
  field: string
  original_value: string | null
  corrected_value: string | null
  created_at: string
}

export interface AccuracyMetricsRecord {
  id: string
  bank_id: SupportedBank
  total_transactions_parsed: number
  total_corrections: number
  accuracy_rate: number
  confidence_score: number
  improvement_trend: number
  last_updated: string
}

export interface LearningLogRecord {
  id: string
  bank_id: SupportedBank
  event_type: 'parse' | 'correction' | 'pattern_learned' | 'pattern_applied'
  details: Record<string, any>
  created_at: string
}

// Storage class for Supabase persistence
export class SupabaseStorage {
  // Load bank profiles from Supabase
  async loadBankProfiles(): Promise<BankProfileRecord[]> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('bank_profiles')
      .select('*')
      .order('bank_name')

    if (error) {
      console.error('Error loading bank profiles:', error)
      return []
    }

    return data || []
  }

  // Save or update a bank profile
  async saveBankProfile(profile: Omit<BankProfileRecord, 'id' | 'created_at' | 'updated_at'>): Promise<BankProfileRecord | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('bank_profiles')
      .upsert({
        ...profile,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'bank_id',
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving bank profile:', error)
      return null
    }

    return data
  }

  // Load learned patterns for a specific bank
  async loadPatterns(bankId?: SupportedBank): Promise<TransactionPatternRecord[]> {
    const supabase = await createClient()

    let query = supabase
      .from('transaction_patterns')
      .select('*')
      .order('confidence', { ascending: false })

    if (bankId) {
      query = query.eq('bank_id', bankId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error loading patterns:', error)
      return []
    }

    return data || []
  }

  // Save a learned pattern
  async savePattern(pattern: Omit<TransactionPatternRecord, 'id' | 'created_at' | 'updated_at'>): Promise<TransactionPatternRecord | null> {
    const supabase = await createClient()

    // Check for existing pattern
    const { data: existing } = await supabase
      .from('transaction_patterns')
      .select('id')
      .eq('bank_id', pattern.bank_id)
      .eq('pattern_type', pattern.pattern_type)
      .eq('original_value', pattern.original_value)
      .single()

    if (existing) {
      // Update existing pattern
      const { data, error } = await supabase
        .from('transaction_patterns')
        .update({
          corrected_value: pattern.corrected_value,
          confidence: pattern.confidence,
          occurrences: pattern.occurrences,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (error) {
        console.error('Error updating pattern:', error)
        return null
      }
      return data
    }

    // Insert new pattern
    const { data, error } = await supabase
      .from('transaction_patterns')
      .insert({
        ...pattern,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving pattern:', error)
      return null
    }

    return data
  }

  // Bulk save patterns
  async savePatternsBulk(patterns: Omit<TransactionPatternRecord, 'id' | 'created_at' | 'updated_at'>[]): Promise<number> {
    const supabase = await createClient()

    const now = new Date().toISOString()
    const patternsWithTimestamps = patterns.map(p => ({
      ...p,
      created_at: now,
      updated_at: now,
    }))

    const { data, error } = await supabase
      .from('transaction_patterns')
      .upsert(patternsWithTimestamps, {
        onConflict: 'bank_id,pattern_type,original_value',
      })
      .select()

    if (error) {
      console.error('Error bulk saving patterns:', error)
      return 0
    }

    return data?.length || 0
  }

  // Save user feedback/correction
  async saveFeedback(feedback: Omit<UserFeedbackRecord, 'id' | 'created_at'>): Promise<UserFeedbackRecord | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('user_feedback')
      .insert({
        ...feedback,
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving feedback:', error)
      return null
    }

    return data
  }

  // Load feedback for learning
  async loadFeedback(bankId?: SupportedBank, limit: number = 100): Promise<UserFeedbackRecord[]> {
    const supabase = await createClient()

    let query = supabase
      .from('user_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (bankId) {
      query = query.eq('bank_id', bankId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error loading feedback:', error)
      return []
    }

    return data || []
  }

  // Load accuracy metrics
  async loadMetrics(bankId?: SupportedBank): Promise<AccuracyMetricsRecord[]> {
    const supabase = await createClient()

    let query = supabase
      .from('accuracy_metrics')
      .select('*')
      .order('bank_id')

    if (bankId) {
      query = query.eq('bank_id', bankId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error loading metrics:', error)
      return []
    }

    return data || []
  }

  // Update accuracy metrics
  async updateMetrics(metrics: Omit<AccuracyMetricsRecord, 'id'>): Promise<AccuracyMetricsRecord | null> {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('accuracy_metrics')
      .upsert({
        ...metrics,
        last_updated: new Date().toISOString(),
      }, {
        onConflict: 'bank_id',
      })
      .select()
      .single()

    if (error) {
      console.error('Error updating metrics:', error)
      return null
    }

    return data
  }

  // Log a learning event
  async logEvent(
    bankId: SupportedBank,
    eventType: LearningLogRecord['event_type'],
    details: Record<string, any>
  ): Promise<void> {
    const supabase = await createClient()

    const { error } = await supabase
      .from('learning_log')
      .insert({
        bank_id: bankId,
        event_type: eventType,
        details,
        created_at: new Date().toISOString(),
      })

    if (error) {
      console.error('Error logging event:', error)
    }
  }

  // Get learning history
  async getLearningHistory(bankId: SupportedBank, days: number = 30): Promise<LearningLogRecord[]> {
    const supabase = await createClient()

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)

    const { data, error } = await supabase
      .from('learning_log')
      .select('*')
      .eq('bank_id', bankId)
      .gte('created_at', cutoffDate.toISOString())
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error loading learning history:', error)
      return []
    }

    return data || []
  }

  // Calculate improvement trend
  async calculateImprovementTrend(bankId: SupportedBank): Promise<number> {
    const supabase = await createClient()

    // Get corrections from last 30 days
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const fifteenDaysAgo = new Date()
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)

    // Count corrections in first half of period
    const { count: firstHalfCount } = await supabase
      .from('user_feedback')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bankId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .lt('created_at', fifteenDaysAgo.toISOString())

    // Count corrections in second half of period
    const { count: secondHalfCount } = await supabase
      .from('user_feedback')
      .select('*', { count: 'exact', head: true })
      .eq('bank_id', bankId)
      .gte('created_at', fifteenDaysAgo.toISOString())

    const first = firstHalfCount || 0
    const second = secondHalfCount || 0

    if (first === 0 && second === 0) return 0
    if (first === 0) return -100 // Getting worse
    if (second === 0) return 100 // Getting better

    // Positive trend means fewer corrections (improvement)
    const trend = ((first - second) / first) * 100
    return Math.round(trend)
  }

  // Convert database records to learning store format
  convertPatternToLearningFormat(record: TransactionPatternRecord): LearnedPattern {
    return {
      id: record.id,
      bankId: record.bank_id,
      patternType: record.pattern_type as LearnedPattern['patternType'],
      originalValue: record.original_value,
      correctedValue: record.corrected_value,
      confidence: record.confidence,
      occurrences: record.occurrences,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
    }
  }

  convertMetricsToLearningFormat(record: AccuracyMetricsRecord): LearningMetrics {
    return {
      bankId: record.bank_id,
      totalTransactionsParsed: record.total_transactions_parsed,
      totalCorrections: record.total_corrections,
      accuracyRate: record.accuracy_rate,
      confidenceScore: record.confidence_score,
      lastUpdated: record.last_updated,
      improvementTrend: record.improvement_trend,
    }
  }

  // Initialize learning store from database
  async initializeLearningStore(): Promise<{
    patterns: LearnedPattern[]
    metrics: LearningMetrics[]
  }> {
    const [patternRecords, metricsRecords] = await Promise.all([
      this.loadPatterns(),
      this.loadMetrics(),
    ])

    return {
      patterns: patternRecords.map(r => this.convertPatternToLearningFormat(r)),
      metrics: metricsRecords.map(r => this.convertMetricsToLearningFormat(r)),
    }
  }

  // Sync learning store to database
  async syncLearningStore(state: {
    patterns: LearnedPattern[]
    metrics: LearningMetrics[]
  }): Promise<void> {
    // Save patterns
    for (const pattern of state.patterns) {
      await this.savePattern({
        bank_id: pattern.bankId,
        pattern_type: pattern.patternType,
        original_value: pattern.originalValue,
        corrected_value: pattern.correctedValue,
        confidence: pattern.confidence,
        occurrences: pattern.occurrences,
      })
    }

    // Save metrics
    for (const metric of state.metrics) {
      await this.updateMetrics({
        bank_id: metric.bankId,
        total_transactions_parsed: metric.totalTransactionsParsed,
        total_corrections: metric.totalCorrections,
        accuracy_rate: metric.accuracyRate,
        confidence_score: metric.confidenceScore,
        improvement_trend: metric.improvementTrend,
        last_updated: metric.lastUpdated,
      })
    }
  }
}

// Export singleton instance
export const supabaseStorage = new SupabaseStorage()
