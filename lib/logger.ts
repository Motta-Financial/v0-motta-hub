/**
 * Structured logging utility for API routes and server-side code.
 * 
 * In production (Vercel), logs are automatically captured and searchable.
 * In development, logs are formatted for readability.
 * 
 * Usage:
 *   import { logger } from "@/lib/logger"
 *   logger.info("karbon/clients", "Fetched clients", { count: 10 })
 *   logger.error("karbon/clients", "Failed to fetch", { error: err.message })
 */

type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  timestamp: string
  level: LogLevel
  context: string
  message: string
  data?: Record<string, unknown>
}

const isDev = process.env.NODE_ENV === "development"

function formatLog(entry: LogEntry): string {
  if (isDev) {
    // Human-readable format for development
    const dataStr = entry.data ? ` ${JSON.stringify(entry.data)}` : ""
    return `[${entry.level.toUpperCase()}] [${entry.context}] ${entry.message}${dataStr}`
  }
  // JSON format for production (Vercel logs)
  return JSON.stringify(entry)
}

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message,
    ...(data && { data }),
  }

  const formatted = formatLog(entry)

  switch (level) {
    case "debug":
      if (isDev) console.debug(formatted)
      break
    case "info":
      console.info(formatted)
      break
    case "warn":
      console.warn(formatted)
      break
    case "error":
      console.error(formatted)
      break
  }
}

export const logger = {
  debug: (context: string, message: string, data?: Record<string, unknown>) =>
    log("debug", context, message, data),
  info: (context: string, message: string, data?: Record<string, unknown>) =>
    log("info", context, message, data),
  warn: (context: string, message: string, data?: Record<string, unknown>) =>
    log("warn", context, message, data),
  error: (context: string, message: string, data?: Record<string, unknown>) =>
    log("error", context, message, data),
}

export default logger
