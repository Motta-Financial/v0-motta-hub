"use client"

import { useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js"

/**
 * The Postgres tables that have Realtime enabled by migration 030.
 * Adding a new table here without also enabling REPLICA IDENTITY FULL +
 * the supabase_realtime publication will silently never deliver events.
 */
export type RealtimeTable =
  | "work_items"
  | "contacts"
  | "organizations"
  | "client_groups"
  | "karbon_notes"
  | "karbon_invoices"
  | "karbon_tasks"
  | "team_members"
  | "karbon_webhook_subscriptions"
  | "karbon_webhook_events"

export type RealtimeEvent = "INSERT" | "UPDATE" | "DELETE" | "*"

export interface UseKarbonRealtimeOptions<T extends Record<string, any> = Record<string, any>> {
  /** Table to subscribe to. Must be in the supabase_realtime publication. */
  table: RealtimeTable
  /** Events to listen for. Defaults to all changes. */
  event?: RealtimeEvent
  /** Optional Postgres-style filter, e.g. `client_key=eq.abc123`. */
  filter?: string
  /** Disable subscription (e.g. while loading) without unmounting the consumer. */
  enabled?: boolean
  /** Fired for INSERT events. */
  onInsert?: (row: T) => void
  /** Fired for UPDATE events; receives both old and new rows when REPLICA IDENTITY FULL is set. */
  onUpdate?: (newRow: T, oldRow: T | null) => void
  /** Fired for DELETE events. */
  onDelete?: (oldRow: T) => void
  /** Catch-all that always fires after the typed callbacks. */
  onChange?: (payload: RealtimePostgresChangesPayload<T>) => void
}

/**
 * Subscribe to live Postgres changes on Karbon-synced tables.
 *
 * When a Karbon webhook lands, the receiver upserts the row in Supabase, which
 * triggers a Realtime broadcast that this hook delivers to the UI — closing the
 * loop from "user changes record in Karbon" to "Motta Hub UI updates" with no
 * manual refresh.
 *
 * Each call creates its own channel keyed on (table, event, filter) so multiple
 * components can subscribe to overlapping streams without stomping on each other.
 *
 * @example
 *   useKarbonRealtime<WorkItem>({
 *     table: "work_items",
 *     event: "*",
 *     filter: `assignee_id=eq.${teamMemberId}`,
 *     onChange: () => mutate(), // SWR
 *   })
 */
export function useKarbonRealtime<T extends Record<string, any> = Record<string, any>>(
  opts: UseKarbonRealtimeOptions<T>,
) {
  // Refs keep the effect dependency list stable — the consumer can pass a new
  // callback on every render without us tearing down/rebuilding the channel.
  const onInsertRef = useRef(opts.onInsert)
  const onUpdateRef = useRef(opts.onUpdate)
  const onDeleteRef = useRef(opts.onDelete)
  const onChangeRef = useRef(opts.onChange)

  useEffect(() => {
    onInsertRef.current = opts.onInsert
    onUpdateRef.current = opts.onUpdate
    onDeleteRef.current = opts.onDelete
    onChangeRef.current = opts.onChange
  })

  const enabled = opts.enabled !== false
  const event = opts.event ?? "*"
  const { table, filter } = opts

  useEffect(() => {
    if (!enabled) return

    const supabase = createClient()
    // A unique channel name per consumer prevents collision when the same hook
    // is used in two components on one page.
    const channelName = `karbon-rt:${table}:${event}:${filter ?? "all"}:${Math.random().toString(36).slice(2, 8)}`

    const channel = (supabase.channel(channelName) as any)
      .on(
        "postgres_changes",
        { event, schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<T>) => {
          try {
            if (payload.eventType === "INSERT" && onInsertRef.current) {
              onInsertRef.current(payload.new as T)
            } else if (payload.eventType === "UPDATE" && onUpdateRef.current) {
              onUpdateRef.current(payload.new as T, (payload.old as T) || null)
            } else if (payload.eventType === "DELETE" && onDeleteRef.current) {
              onDeleteRef.current(payload.old as T)
            }
            onChangeRef.current?.(payload)
          } catch (err) {
            console.error("[useKarbonRealtime] callback error:", err)
          }
        },
      )
      .subscribe((status: string) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn(`[useKarbonRealtime] ${table} channel ${status}`)
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [enabled, table, event, filter])
}
