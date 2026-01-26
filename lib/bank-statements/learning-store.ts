// Learning Store - Improves accuracy over time based on user feedback

import type {
  Transaction,
  TransactionType,
  UserFeedback,
  LearningLog,
  BankProfile,
} from './types'
import {
  saveUserFeedback,
  addLearningLog,
  getLearningLogs,
  addTransactionPattern,
  getBankProfiles,
} from './supabase-storage'
import { inferTransactionType } from './bank-profiles'

interface LearnedPattern {
  pattern: string
  type: TransactionType
  confidence: number
  usageCount: number
}

// In-memory cache for learned patterns (refreshed periodically)
let learnedPatternsCache: Map<string, LearnedPattern[]> = new Map()
let lastCacheRefresh: Date | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Refresh the learned patterns cache from Supabase
 */
export async function refreshLearnedPatterns(): Promise<void> {
  try {
    const logs = await getLearningLogs()
    const profiles = await getBankProfiles()

    learnedPatternsCache.clear()

    // Group logs by bank profile
    for (const log of logs) {
      const bankId = log.bankProfileId || 'generic'
      if (!learnedPatternsCache.has(bankId)) {
        learnedPatternsCache.set(bankId, [])
      }

      learnedPatternsCache.get(bankId)!.push({
        pattern: log.newPattern,
        type: log.patternType as TransactionType,
        confidence: log.confidence,
        usageCount: log.usageCount,
      })
    }

    lastCacheRefresh = new Date()
    console.log('[learning-store] Refreshed learned patterns cache')
  } catch (error) {
    console.error('[learning-store] Error refreshing patterns cache:', error)
  }
}

/**
 * Get learned patterns, refreshing cache if stale
 */
export async function getLearnedPatterns(bankProfileId?: string): Promise<LearnedPattern[]> {
  // Check if cache needs refresh
  if (!lastCacheRefresh || Date.now() - lastCacheRefresh.getTime() > CACHE_TTL_MS) {
    await refreshLearnedPatterns()
  }

  const patterns: LearnedPattern[] = []

  // Get bank-specific patterns
  if (bankProfileId && learnedPatternsCache.has(bankProfileId)) {
    patterns.push(...learnedPatternsCache.get(bankProfileId)!)
  }

  // Get generic patterns
  if (learnedPatternsCache.has('generic')) {
    patterns.push(...learnedPatternsCache.get('generic')!)
  }

  // Sort by confidence and usage count
  return patterns.sort((a, b) => {
    const scoreA = a.confidence * 0.7 + Math.min(a.usageCount / 100, 1) * 30
    const scoreB = b.confidence * 0.7 + Math.min(b.usageCount / 100, 1) * 30
    return scoreB - scoreA
  })
}

/**
 * Learn from user feedback on a transaction
 */
export async function learnFromFeedback(
  feedback: Omit<UserFeedback, 'id' | 'createdAt'>,
  bankProfileId?: string
): Promise<{ success: boolean; patternLearned: boolean }> {
  try {
    // Save the feedback
    await saveUserFeedback(feedback)

    let patternLearned = false

    // If this is a correction, try to learn from it
    if (feedback.feedbackType === 'correction') {
      const original = feedback.originalValue
      const corrected = feedback.correctedValue

      // Learn type corrections
      if (original.type !== corrected.type && corrected.description) {
        const pattern = extractPattern(corrected.description)
        if (pattern) {
          await addLearningLog({
            bankProfileId: bankProfileId || 'generic',
            patternType: 'type',
            originalPattern: original.type || 'unknown',
            newPattern: pattern,
            confidence: 80, // Start with 80% confidence
            usageCount: 1,
            lastUsed: new Date().toISOString(),
          })

          // If confidence is high enough, add as transaction pattern
          await addTransactionPattern({
            bankProfileId: bankProfileId || 'generic',
            pattern: pattern,
            type: corrected.type as TransactionType,
            descriptionGroup: 0,
            amountGroup: 1,
            priority: 10, // Lower priority than built-in patterns
          })

          patternLearned = true
        }
      }

      // Learn description patterns for amounts
      if (original.debit !== corrected.debit || original.credit !== corrected.credit) {
        // Log amount corrections for analysis
        await addLearningLog({
          bankProfileId: bankProfileId || 'generic',
          patternType: 'amount',
          originalPattern: JSON.stringify({ debit: original.debit, credit: original.credit }),
          newPattern: JSON.stringify({ debit: corrected.debit, credit: corrected.credit }),
          confidence: 90,
          usageCount: 1,
          lastUsed: new Date().toISOString(),
        })
      }

      // Learn date format corrections
      if (original.date !== corrected.date) {
        await addLearningLog({
          bankProfileId: bankProfileId || 'generic',
          patternType: 'date',
          originalPattern: original.date || '',
          newPattern: corrected.date || '',
          confidence: 85,
          usageCount: 1,
          lastUsed: new Date().toISOString(),
        })
      }
    }

    // Invalidate cache to pick up new patterns
    lastCacheRefresh = null

    return { success: true, patternLearned }
  } catch (error) {
    console.error('[learning-store] Error learning from feedback:', error)
    return { success: false, patternLearned: false }
  }
}

/**
 * Extract a regex pattern from a description
 */
function extractPattern(description: string): string | null {
  if (!description || description.length < 3) return null

  // Clean the description
  const cleaned = description.toUpperCase().trim()

  // Extract key words (remove numbers and special chars)
  const words = cleaned
    .replace(/[0-9]+/g, '\\d+')
    .replace(/[^A-Z\\d\s]+/g, '.*')
    .split(/\s+/)
    .filter(w => w.length > 2)

  if (words.length === 0) return null

  // Create pattern from first few significant words
  const patternWords = words.slice(0, 3).join('.*')
  return patternWords
}

/**
 * Apply learned patterns to improve transaction classification
 */
export async function applyLearnedPatterns(
  transaction: Transaction,
  bankProfileId?: string
): Promise<Transaction> {
  const patterns = await getLearnedPatterns(bankProfileId)

  if (patterns.length === 0) {
    return transaction
  }

  const description = transaction.description.toUpperCase()

  for (const learned of patterns) {
    try {
      const regex = new RegExp(learned.pattern, 'i')
      if (regex.test(description)) {
        // Apply the learned type if confidence is high enough
        if (learned.confidence >= 70) {
          return {
            ...transaction,
            type: learned.type,
            confidence: Math.min(transaction.confidence + 10, 100),
          }
        }
      }
    } catch {
      // Invalid regex pattern, skip
      continue
    }
  }

  return transaction
}

/**
 * Batch apply learned patterns to multiple transactions
 */
export async function applyLearnedPatternsToTransactions(
  transactions: Transaction[],
  bankProfileId?: string
): Promise<Transaction[]> {
  const patterns = await getLearnedPatterns(bankProfileId)

  if (patterns.length === 0) {
    return transactions
  }

  return transactions.map(tx => {
    const description = tx.description.toUpperCase()

    for (const learned of patterns) {
      try {
        const regex = new RegExp(learned.pattern, 'i')
        if (regex.test(description) && learned.confidence >= 70) {
          return {
            ...tx,
            type: learned.type,
            confidence: Math.min(tx.confidence + 10, 100),
          }
        }
      } catch {
        continue
      }
    }

    return tx
  })
}

/**
 * Get learning statistics
 */
export async function getLearningStats(bankProfileId?: string): Promise<{
  totalPatterns: number
  highConfidencePatterns: number
  recentlyUsedPatterns: number
  topPatterns: LearnedPattern[]
}> {
  const patterns = await getLearnedPatterns(bankProfileId)
  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  return {
    totalPatterns: patterns.length,
    highConfidencePatterns: patterns.filter(p => p.confidence >= 80).length,
    recentlyUsedPatterns: patterns.filter(p => p.usageCount > 0).length,
    topPatterns: patterns.slice(0, 10),
  }
}

/**
 * Suggest transaction type based on learned patterns and built-in rules
 */
export async function suggestTransactionType(
  description: string,
  bankProfileId?: string
): Promise<{ type: TransactionType; confidence: number; source: 'learned' | 'builtin' }> {
  // First, try learned patterns
  const patterns = await getLearnedPatterns(bankProfileId)
  const upperDesc = description.toUpperCase()

  for (const learned of patterns) {
    try {
      const regex = new RegExp(learned.pattern, 'i')
      if (regex.test(upperDesc) && learned.confidence >= 70) {
        return {
          type: learned.type,
          confidence: learned.confidence,
          source: 'learned',
        }
      }
    } catch {
      continue
    }
  }

  // Fall back to built-in type inference
  const inferredType = inferTransactionType(description)
  return {
    type: inferredType,
    confidence: inferredType === 'other' ? 50 : 75,
    source: 'builtin',
  }
}
