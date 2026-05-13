import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"

/**
 * GET /api/admin/ai/usage
 *
 * Returns AI usage statistics for the admin dashboard.
 * Query params:
 *   - range: "24h" | "7d" | "30d" | "all" (default: "7d")
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const range = searchParams.get("range") || "7d"

    const supabase = createAdminClient()

    // Calculate the start date based on range
    let startDate: Date | null = null
    const now = new Date()
    switch (range) {
      case "24h":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case "all":
      default:
        startDate = null
    }

    // Build the base query
    let baseQuery = supabase.from("ai_usage_log").select("*")
    if (startDate) {
      baseQuery = baseQuery.gte("created_at", startDate.toISOString())
    }

    const { data: logs, error: logsError } = await baseQuery.order(
      "created_at",
      { ascending: false }
    )

    if (logsError) {
      console.error("[api/admin/ai/usage] Query error:", logsError)
      return NextResponse.json(
        { error: "Failed to fetch usage data" },
        { status: 500 }
      )
    }

    const allLogs = logs ?? []

    // Calculate summary stats
    const totalRequests = allLogs.length
    const successfulRequests = allLogs.filter((l) => l.success).length
    const failedRequests = totalRequests - successfulRequests
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0
    const totalTokens = allLogs.reduce(
      (sum, l) => sum + (l.total_tokens ?? 0),
      0
    )
    const avgLatencyMs =
      allLogs.length > 0
        ? allLogs.reduce((sum, l) => sum + (l.latency_ms ?? 0), 0) / allLogs.length
        : 0

    // Get display names from ai_configurations
    const { data: configs } = await supabase
      .from("ai_configurations")
      .select("use_case, display_name")
    const displayNameMap = new Map<string, string>()
    for (const c of configs ?? []) {
      displayNameMap.set(c.use_case, c.display_name)
    }

    // Group by use case
    const byUseCaseMap = new Map<
      string,
      {
        requests: number
        successful: number
        tokens: number
        latencySum: number
      }
    >()
    for (const log of allLogs) {
      const key = log.use_case
      const existing = byUseCaseMap.get(key) || {
        requests: 0,
        successful: 0,
        tokens: 0,
        latencySum: 0,
      }
      existing.requests++
      if (log.success) existing.successful++
      existing.tokens += log.total_tokens ?? 0
      existing.latencySum += log.latency_ms ?? 0
      byUseCaseMap.set(key, existing)
    }

    const byUseCase = Array.from(byUseCaseMap.entries())
      .map(([useCase, stats]) => ({
        useCase,
        displayName: displayNameMap.get(useCase) ?? useCase,
        requests: stats.requests,
        successRate:
          stats.requests > 0 ? (stats.successful / stats.requests) * 100 : 0,
        totalTokens: stats.tokens,
        avgLatencyMs: stats.requests > 0 ? stats.latencySum / stats.requests : 0,
      }))
      .sort((a, b) => b.requests - a.requests)

    // Group by model
    const byModelMap = new Map<
      string,
      { requests: number; successful: number; tokens: number }
    >()
    for (const log of allLogs) {
      const key = log.model
      const existing = byModelMap.get(key) || {
        requests: 0,
        successful: 0,
        tokens: 0,
      }
      existing.requests++
      if (log.success) existing.successful++
      existing.tokens += log.total_tokens ?? 0
      byModelMap.set(key, existing)
    }

    const byModel = Array.from(byModelMap.entries())
      .map(([model, stats]) => ({
        model,
        requests: stats.requests,
        successRate:
          stats.requests > 0 ? (stats.successful / stats.requests) * 100 : 0,
        totalTokens: stats.tokens,
      }))
      .sort((a, b) => b.requests - a.requests)

    // Recent activity (last 50)
    const recentActivity = allLogs.slice(0, 50).map((log) => ({
      id: log.id,
      useCase: displayNameMap.get(log.use_case) ?? log.use_case,
      model: log.model,
      success: log.success,
      totalTokens: log.total_tokens,
      latencyMs: log.latency_ms,
      errorMessage: log.error_message,
      userEmail: log.user_email,
      createdAt: log.created_at,
    }))

    return NextResponse.json({
      summary: {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate,
        totalTokens,
        avgLatencyMs,
      },
      byUseCase,
      byModel,
      recentActivity,
      timeRange: range,
    })
  } catch (error) {
    console.error("[api/admin/ai/usage] Error:", error)
    return NextResponse.json(
      { error: "Failed to fetch usage data" },
      { status: 500 }
    )
  }
}
