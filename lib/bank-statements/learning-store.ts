import type { BankTransaction, SupportedBank } from './types'

export interface LearnedPattern {
  id: string
  bankId: SupportedBank
  patternType: 'date_format' | 'transaction_category' | 'amount_format' | 'description_normalization'
  originalValue: string
  correctedValue: string
  confidence: number
  occurrences: number
  createdAt: string
  updatedAt: string
}

export interface TransactionCorrection {
  transactionId: string
  field: 'date' | 'description' | 'debit' | 'credit' | 'balance' | 'category'
  originalValue: string | number | null
  correctedValue: string | number | null
  bankId: SupportedBank
  userId: string
  createdAt: string
}

export interface LearningMetrics {
  bankId: SupportedBank
  totalTransactionsParsed: number
  totalCorrections: number
  accuracyRate: number
  confidenceScore: number
  lastUpdated: string
  improvementTrend: number // percentage improvement over last 30 days
}

export interface ConfidenceWeights {
  dateFormat: number
  amountParsing: number
  descriptionExtraction: number
  balanceReconciliation: number
  categoryAssignment: number
}

// In-memory learning store (synced with Supabase)
class LearningStore {
  private patterns: Map<string, LearnedPattern> = new Map()
  private corrections: TransactionCorrection[] = []
  private metrics: Map<SupportedBank, LearningMetrics> = new Map()
  private initialized: boolean = false

  async initialize(patterns: LearnedPattern[], metrics: LearningMetrics[]): Promise<void> {
    this.patterns.clear()
    for (const pattern of patterns) {
      this.patterns.set(pattern.id, pattern)
    }

    this.metrics.clear()
    for (const metric of metrics) {
      this.metrics.set(metric.bankId, metric)
    }

    this.initialized = true
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getPattern(id: string): LearnedPattern | undefined {
    return this.patterns.get(id)
  }

  getPatternsForBank(bankId: SupportedBank): LearnedPattern[] {
    return Array.from(this.patterns.values()).filter(p => p.bankId === bankId)
  }

  getHighConfidencePatterns(bankId: SupportedBank, minConfidence: number = 0.8): LearnedPattern[] {
    return this.getPatternsForBank(bankId).filter(p => p.confidence >= minConfidence)
  }

  addPattern(pattern: Omit<LearnedPattern, 'id' | 'createdAt' | 'updatedAt'>): LearnedPattern {
    const id = `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = new Date().toISOString()

    const newPattern: LearnedPattern = {
      ...pattern,
      id,
      createdAt: now,
      updatedAt: now,
    }

    this.patterns.set(id, newPattern)
    return newPattern
  }

  updatePattern(id: string, updates: Partial<LearnedPattern>): LearnedPattern | null {
    const existing = this.patterns.get(id)
    if (!existing) return null

    const updated: LearnedPattern = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    this.patterns.set(id, updated)
    return updated
  }

  incrementPatternOccurrence(id: string): void {
    const pattern = this.patterns.get(id)
    if (pattern) {
      pattern.occurrences++
      pattern.confidence = Math.min(1, pattern.confidence + 0.01) // Slight confidence boost
      pattern.updatedAt = new Date().toISOString()
    }
  }

  addCorrection(correction: Omit<TransactionCorrection, 'createdAt'>): TransactionCorrection {
    const fullCorrection: TransactionCorrection = {
      ...correction,
      createdAt: new Date().toISOString(),
    }

    this.corrections.push(fullCorrection)
    this.updateMetricsFromCorrection(correction.bankId)

    return fullCorrection
  }

  getCorrectionsForBank(bankId: SupportedBank): TransactionCorrection[] {
    return this.corrections.filter(c => c.bankId === bankId)
  }

  getMetrics(bankId: SupportedBank): LearningMetrics | undefined {
    return this.metrics.get(bankId)
  }

  getAllMetrics(): LearningMetrics[] {
    return Array.from(this.metrics.values())
  }

  updateMetrics(bankId: SupportedBank, updates: Partial<LearningMetrics>): void {
    const existing = this.metrics.get(bankId)
    if (existing) {
      this.metrics.set(bankId, {
        ...existing,
        ...updates,
        lastUpdated: new Date().toISOString(),
      })
    } else {
      this.metrics.set(bankId, {
        bankId,
        totalTransactionsParsed: 0,
        totalCorrections: 0,
        accuracyRate: 0,
        confidenceScore: 0.5,
        lastUpdated: new Date().toISOString(),
        improvementTrend: 0,
        ...updates,
      })
    }
  }

  private updateMetricsFromCorrection(bankId: SupportedBank): void {
    const metrics = this.metrics.get(bankId)
    if (metrics) {
      const totalCorrections = metrics.totalCorrections + 1
      const accuracyRate = metrics.totalTransactionsParsed > 0
        ? Math.max(0, 1 - (totalCorrections / metrics.totalTransactionsParsed))
        : 0

      this.metrics.set(bankId, {
        ...metrics,
        totalCorrections,
        accuracyRate,
        lastUpdated: new Date().toISOString(),
      })
    }
  }

  recordTransactionsParsed(bankId: SupportedBank, count: number): void {
    const metrics = this.metrics.get(bankId) || {
      bankId,
      totalTransactionsParsed: 0,
      totalCorrections: 0,
      accuracyRate: 1,
      confidenceScore: 0.5,
      lastUpdated: new Date().toISOString(),
      improvementTrend: 0,
    }

    const newTotal = metrics.totalTransactionsParsed + count
    const accuracyRate = newTotal > 0
      ? Math.max(0, 1 - (metrics.totalCorrections / newTotal))
      : 1

    this.metrics.set(bankId, {
      ...metrics,
      totalTransactionsParsed: newTotal,
      accuracyRate,
      lastUpdated: new Date().toISOString(),
    })
  }

  // Learn from a batch of corrections
  learnFromCorrections(corrections: TransactionCorrection[]): LearnedPattern[] {
    const newPatterns: LearnedPattern[] = []

    // Group corrections by field and value
    const groupedCorrections = new Map<string, TransactionCorrection[]>()

    for (const correction of corrections) {
      const key = `${correction.bankId}:${correction.field}:${correction.originalValue}`
      const existing = groupedCorrections.get(key) || []
      existing.push(correction)
      groupedCorrections.set(key, existing)
    }

    // Create patterns for recurring corrections
    for (const [key, group] of groupedCorrections) {
      if (group.length >= 2) { // Only create pattern if we see same correction multiple times
        const first = group[0]
        const mostCommonCorrection = this.findMostCommon(group.map(c => String(c.correctedValue)))

        const patternType = this.fieldToPatternType(first.field)

        const existingPattern = Array.from(this.patterns.values()).find(
          p => p.bankId === first.bankId &&
               p.patternType === patternType &&
               p.originalValue === String(first.originalValue)
        )

        if (existingPattern) {
          this.updatePattern(existingPattern.id, {
            correctedValue: mostCommonCorrection,
            occurrences: existingPattern.occurrences + group.length,
            confidence: Math.min(1, existingPattern.confidence + (group.length * 0.05)),
          })
        } else {
          const newPattern = this.addPattern({
            bankId: first.bankId,
            patternType,
            originalValue: String(first.originalValue),
            correctedValue: mostCommonCorrection,
            confidence: Math.min(1, 0.5 + (group.length * 0.1)),
            occurrences: group.length,
          })
          newPatterns.push(newPattern)
        }
      }
    }

    return newPatterns
  }

  private fieldToPatternType(field: string): LearnedPattern['patternType'] {
    switch (field) {
      case 'date': return 'date_format'
      case 'category': return 'transaction_category'
      case 'debit':
      case 'credit':
      case 'balance': return 'amount_format'
      default: return 'description_normalization'
    }
  }

  private findMostCommon(values: string[]): string {
    const counts = new Map<string, number>()
    for (const value of values) {
      counts.set(value, (counts.get(value) || 0) + 1)
    }

    let maxCount = 0
    let mostCommon = values[0]

    for (const [value, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        mostCommon = value
      }
    }

    return mostCommon
  }

  // Apply learned patterns to improve transaction parsing
  applyLearnedPatterns(transaction: BankTransaction, bankId: SupportedBank): BankTransaction {
    const patterns = this.getHighConfidencePatterns(bankId, 0.7)
    let improved = { ...transaction }

    for (const pattern of patterns) {
      switch (pattern.patternType) {
        case 'transaction_category':
          if (transaction.description?.includes(pattern.originalValue)) {
            improved.category = pattern.correctedValue
            this.incrementPatternOccurrence(pattern.id)
          }
          break

        case 'description_normalization':
          if (transaction.description === pattern.originalValue) {
            improved.description = pattern.correctedValue
            this.incrementPatternOccurrence(pattern.id)
          }
          break

        case 'date_format':
          if (transaction.date === pattern.originalValue) {
            improved.date = pattern.correctedValue
            this.incrementPatternOccurrence(pattern.id)
          }
          break
      }
    }

    return improved
  }

  // Calculate transaction confidence score
  calculateTransactionConfidence(
    transaction: BankTransaction,
    bankId: SupportedBank,
    weights: ConfidenceWeights = {
      dateFormat: 0.2,
      amountParsing: 0.3,
      descriptionExtraction: 0.2,
      balanceReconciliation: 0.2,
      categoryAssignment: 0.1,
    }
  ): number {
    let score = 0

    // Date confidence
    if (transaction.date && /^\d{4}-\d{2}-\d{2}$/.test(transaction.date)) {
      score += weights.dateFormat
    }

    // Amount confidence
    if (transaction.debit !== null || transaction.credit !== null) {
      score += weights.amountParsing
    }

    // Description confidence
    if (transaction.description && transaction.description.length > 3) {
      score += weights.descriptionExtraction
    }

    // Balance confidence
    if (transaction.balance !== null) {
      score += weights.balanceReconciliation
    }

    // Category confidence
    if (transaction.category) {
      score += weights.categoryAssignment
    }

    // Boost confidence if we have learned patterns for this bank
    const bankPatterns = this.getHighConfidencePatterns(bankId)
    if (bankPatterns.length > 10) {
      score = Math.min(1, score * 1.1) // 10% boost for well-learned banks
    }

    return Math.round(score * 100) / 100
  }

  // Export state for persistence
  exportState(): {
    patterns: LearnedPattern[]
    metrics: LearningMetrics[]
  } {
    return {
      patterns: Array.from(this.patterns.values()),
      metrics: Array.from(this.metrics.values()),
    }
  }

  // Clear all data (for testing)
  clear(): void {
    this.patterns.clear()
    this.corrections = []
    this.metrics.clear()
    this.initialized = false
  }
}

// Singleton instance
export const learningStore = new LearningStore()
