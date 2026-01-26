// Supabase Storage for Bank Statement data persistence

import { createClient } from '@supabase/supabase-js'
import type {
  BankProfile,
  TransactionPattern,
  UserFeedback,
  LearningLog,
  ParsedStatement,
  AccuracyMetrics,
} from './types'

// Initialize Supabase client for server-side operations
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(supabaseUrl, supabaseServiceKey)
}

// ============ Bank Profiles ============

export async function getBankProfiles(): Promise<BankProfile[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bank_profiles')
    .select('*')
    .order('name')

  if (error) {
    console.error('[bank-statements] Error fetching bank profiles:', error)
    return []
  }

  return data || []
}

export async function getBankProfileById(id: string): Promise<BankProfile | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bank_profiles')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[bank-statements] Error fetching bank profile:', error)
    return null
  }

  return data
}

export async function upsertBankProfile(profile: Partial<BankProfile> & { id: string }): Promise<BankProfile | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('bank_profiles')
    .upsert({
      ...profile,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('[bank-statements] Error upserting bank profile:', error)
    return null
  }

  return data
}

// ============ Transaction Patterns ============

export async function getTransactionPatterns(bankProfileId?: string): Promise<TransactionPattern[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('transaction_patterns')
    .select('*')
    .order('priority', { ascending: true })

  if (bankProfileId) {
    query = query.eq('bank_profile_id', bankProfileId)
  }

  const { data, error } = await query

  if (error) {
    console.error('[bank-statements] Error fetching transaction patterns:', error)
    return []
  }

  return data || []
}

export async function addTransactionPattern(pattern: Omit<TransactionPattern, 'id' | 'createdAt'>): Promise<TransactionPattern | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('transaction_patterns')
    .insert({
      bank_profile_id: pattern.bankProfileId,
      pattern: pattern.pattern,
      type: pattern.type,
      description_group: pattern.descriptionGroup,
      amount_group: pattern.amountGroup,
      priority: pattern.priority,
    })
    .select()
    .single()

  if (error) {
    console.error('[bank-statements] Error adding transaction pattern:', error)
    return null
  }

  return data
}

// ============ User Feedback ============

export async function saveUserFeedback(feedback: Omit<UserFeedback, 'id' | 'createdAt'>): Promise<UserFeedback | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('user_feedback')
    .insert({
      statement_id: feedback.statementId,
      transaction_id: feedback.transactionId,
      user_id: feedback.userId,
      feedback_type: feedback.feedbackType,
      original_value: feedback.originalValue,
      corrected_value: feedback.correctedValue,
    })
    .select()
    .single()

  if (error) {
    console.error('[bank-statements] Error saving user feedback:', error)
    return null
  }

  return data
}

export async function getUserFeedback(statementId: string): Promise<UserFeedback[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('user_feedback')
    .select('*')
    .eq('statement_id', statementId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[bank-statements] Error fetching user feedback:', error)
    return []
  }

  return data || []
}

export async function getFeedbackStats(): Promise<{
  totalFeedback: number
  corrections: number
  verifications: number
  byBank: Record<string, number>
}> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('user_feedback')
    .select('feedback_type, statement_id')

  if (error) {
    console.error('[bank-statements] Error fetching feedback stats:', error)
    return { totalFeedback: 0, corrections: 0, verifications: 0, byBank: {} }
  }

  const feedback = data || []
  return {
    totalFeedback: feedback.length,
    corrections: feedback.filter(f => f.feedback_type === 'correction').length,
    verifications: feedback.filter(f => f.feedback_type === 'verification').length,
    byBank: {}, // Would need join with statements table for this
  }
}

// ============ Accuracy Metrics ============

export async function saveAccuracyMetrics(
  statementId: string,
  metrics: AccuracyMetrics
): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('accuracy_metrics')
    .upsert({
      statement_id: statementId,
      overall_score: metrics.overallScore,
      balance_verified: metrics.balanceVerified,
      balance_discrepancy: metrics.balanceDiscrepancy,
      duplicates_found: metrics.duplicatesFound,
      low_confidence_count: metrics.lowConfidenceCount,
      total_transactions: metrics.totalTransactions,
      verified_transactions: metrics.verifiedTransactions,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    console.error('[bank-statements] Error saving accuracy metrics:', error)
    return false
  }

  return true
}

export async function getAccuracyMetrics(statementId: string): Promise<AccuracyMetrics | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('accuracy_metrics')
    .select('*')
    .eq('statement_id', statementId)
    .single()

  if (error) {
    console.error('[bank-statements] Error fetching accuracy metrics:', error)
    return null
  }

  return {
    overallScore: data.overall_score,
    balanceVerified: data.balance_verified,
    balanceDiscrepancy: data.balance_discrepancy,
    duplicatesFound: data.duplicates_found,
    lowConfidenceCount: data.low_confidence_count,
    totalTransactions: data.total_transactions,
    verifiedTransactions: data.verified_transactions,
  }
}

// ============ Learning Log ============

export async function addLearningLog(log: Omit<LearningLog, 'id' | 'createdAt'>): Promise<LearningLog | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('learning_log')
    .insert({
      bank_profile_id: log.bankProfileId,
      pattern_type: log.patternType,
      original_pattern: log.originalPattern,
      new_pattern: log.newPattern,
      confidence: log.confidence,
      usage_count: log.usageCount,
      last_used: log.lastUsed,
    })
    .select()
    .single()

  if (error) {
    console.error('[bank-statements] Error adding learning log:', error)
    return null
  }

  return data
}

export async function getLearningLogs(bankProfileId?: string): Promise<LearningLog[]> {
  const supabase = getSupabaseClient()
  let query = supabase
    .from('learning_log')
    .select('*')
    .order('usage_count', { ascending: false })

  if (bankProfileId) {
    query = query.eq('bank_profile_id', bankProfileId)
  }

  const { data, error } = await query

  if (error) {
    console.error('[bank-statements] Error fetching learning logs:', error)
    return []
  }

  return data || []
}

export async function incrementPatternUsage(logId: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase.rpc('increment_pattern_usage', { log_id: logId })

  if (error) {
    // Fallback if RPC doesn't exist
    const { error: updateError } = await supabase
      .from('learning_log')
      .update({
        usage_count: supabase.rpc('increment', { x: 1 }),
        last_used: new Date().toISOString(),
      })
      .eq('id', logId)

    if (updateError) {
      console.error('[bank-statements] Error incrementing pattern usage:', updateError)
      return false
    }
  }

  return true
}

// ============ Parsed Statements (for history/caching) ============

export async function saveParsedStatement(statement: ParsedStatement): Promise<boolean> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('parsed_statements')
    .upsert({
      id: statement.id,
      file_name: statement.fileName,
      bank_name: statement.bankName,
      bank_profile_id: statement.bankProfileId,
      account_number: statement.accountNumber,
      statement_period_start: statement.statementPeriod.start,
      statement_period_end: statement.statementPeriod.end,
      opening_balance: statement.openingBalance,
      closing_balance: statement.closingBalance,
      transactions: statement.transactions,
      accuracy_score: statement.accuracy.overallScore,
      parsed_at: statement.parsedAt,
    })

  if (error) {
    console.error('[bank-statements] Error saving parsed statement:', error)
    return false
  }

  // Also save accuracy metrics
  await saveAccuracyMetrics(statement.id, statement.accuracy)

  return true
}

export async function getParsedStatement(id: string): Promise<ParsedStatement | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('parsed_statements')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[bank-statements] Error fetching parsed statement:', error)
    return null
  }

  const metrics = await getAccuracyMetrics(id)

  return {
    id: data.id,
    fileName: data.file_name,
    bankName: data.bank_name,
    bankProfileId: data.bank_profile_id,
    accountNumber: data.account_number,
    statementPeriod: {
      start: data.statement_period_start,
      end: data.statement_period_end,
    },
    openingBalance: data.opening_balance,
    closingBalance: data.closing_balance,
    transactions: data.transactions,
    accuracy: metrics || {
      overallScore: data.accuracy_score,
      balanceVerified: false,
      balanceDiscrepancy: null,
      duplicatesFound: 0,
      lowConfidenceCount: 0,
      totalTransactions: data.transactions?.length || 0,
      verifiedTransactions: 0,
    },
    rawText: '',
    parsedAt: data.parsed_at,
  }
}

export async function getRecentStatements(limit: number = 10): Promise<ParsedStatement[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('parsed_statements')
    .select('*')
    .order('parsed_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[bank-statements] Error fetching recent statements:', error)
    return []
  }

  return (data || []).map(d => ({
    id: d.id,
    fileName: d.file_name,
    bankName: d.bank_name,
    bankProfileId: d.bank_profile_id,
    accountNumber: d.account_number,
    statementPeriod: {
      start: d.statement_period_start,
      end: d.statement_period_end,
    },
    openingBalance: d.opening_balance,
    closingBalance: d.closing_balance,
    transactions: d.transactions,
    accuracy: {
      overallScore: d.accuracy_score,
      balanceVerified: false,
      balanceDiscrepancy: null,
      duplicatesFound: 0,
      lowConfidenceCount: 0,
      totalTransactions: d.transactions?.length || 0,
      verifiedTransactions: 0,
    },
    rawText: '',
    parsedAt: d.parsed_at,
  }))
}
