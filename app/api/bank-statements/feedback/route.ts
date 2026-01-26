import { NextResponse } from 'next/server'
import type { FeedbackRequest, FeedbackResponse } from '@/lib/bank-statements/types'
import { learnFromFeedback } from '@/lib/bank-statements/learning-store'
import { saveUserFeedback, getFeedbackStats } from '@/lib/bank-statements/supabase-storage'

export async function POST(request: Request) {
  try {
    const body: FeedbackRequest & { userId?: string; bankProfileId?: string } = await request.json()

    const {
      statementId,
      transactionId,
      feedbackType,
      originalValue,
      correctedValue,
      userId = 'anonymous',
      bankProfileId,
    } = body

    // Validate required fields
    if (!statementId || !transactionId || !feedbackType) {
      return NextResponse.json(
        { success: false, message: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Validate feedback type
    if (!['correction', 'verification', 'deletion', 'addition'].includes(feedbackType)) {
      return NextResponse.json(
        { success: false, message: 'Invalid feedback type' },
        { status: 400 }
      )
    }

    // Learn from the feedback
    const result = await learnFromFeedback(
      {
        statementId,
        transactionId,
        userId,
        feedbackType,
        originalValue: originalValue || {},
        correctedValue: correctedValue || {},
      },
      bankProfileId
    )

    const response: FeedbackResponse = {
      success: result.success,
      message: result.success
        ? result.patternLearned
          ? 'Feedback saved and pattern learned'
          : 'Feedback saved successfully'
        : 'Failed to save feedback',
      patternLearned: result.patternLearned,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('[bank-statements] Feedback error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to process feedback' },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const statementId = searchParams.get('statementId')

    if (statementId) {
      // Get feedback for a specific statement
      const { getUserFeedback } = await import('@/lib/bank-statements/supabase-storage')
      const feedback = await getUserFeedback(statementId)
      return NextResponse.json({ success: true, feedback })
    }

    // Get overall feedback stats
    const stats = await getFeedbackStats()
    return NextResponse.json({ success: true, stats })
  } catch (error) {
    console.error('[bank-statements] Get feedback error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to get feedback' },
      { status: 500 }
    )
  }
}
