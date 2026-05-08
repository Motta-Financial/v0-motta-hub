/**
 * Web research tools for ALFRED. Wired into `app/api/alfred/chat/route.ts`.
 *
 *   webSearch  — Parallel Web Search API (broad research, ranked excerpts)
 *   browsePage — Browserbase + Playwright (deep read of a known URL)
 */
export { webSearchTool } from "./web-search"
export { browsePageTool } from "./browse-page"
