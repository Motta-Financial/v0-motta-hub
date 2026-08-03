"use client"

/**
 * Optional React hooks for the marketing site. Not required — the
 * marketing site can also just use the bare Supabase client + plain
 * fetch — but these encode the recommended caching / fallback rules.
 */
import { useEffect, useState } from "react"
import { getPublicSupabase, type FirmStatsPublic } from "./direct"

/**
 * Fetch the live "trust signal" stats from
 * marketing.firm_stats_public_rpc() and re-fetch every `intervalMs`.
 * Falls back silently to null on error so the calling component can
 * hide the strip.
 */
export function useFirmStats(intervalMs = 5 * 60_000): FirmStatsPublic | null {
  const [stats, setStats] = useState<FirmStatsPublic | null>(null)
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const supabase = getPublicSupabase()
        const { data, error } = await supabase.rpc("firm_stats_public_rpc")
        if (cancelled) return
        if (error || !data) {
          // Silent fail — marketing site keeps last value or hides.
          return
        }
        const row = Array.isArray(data) ? data[0] : data
        setStats(row as FirmStatsPublic)
      } catch {
        // network blip — leave previous value
      }
    }
    void tick()
    const t = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [intervalMs])
  return stats
}
