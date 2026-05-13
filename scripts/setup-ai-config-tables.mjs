/**
 * Creates the ai_configurations and ai_usage_log tables for the
 * ALFRED AI Setup admin page.
 *
 * Run once:
 *   node --env-file-if-exists=/vercel/share/.env.project scripts/setup-ai-config-tables.mjs
 */
import pg from "pg"

const url = (process.env.POSTGRES_URL_NON_POOLING || "")
  .replace(/([?&])sslmode=[^&]+&?/g, "$1")
  .replace(/[?&]$/, "")

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

// ─────────────────────────────────────────────────────────────────────────────
// ai_configurations — stores per-use-case model + prompt overrides
// ─────────────────────────────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS ai_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Unique use case key, e.g. "alfred_chat", "daily_briefing", "tommy_recap"
    use_case TEXT NOT NULL UNIQUE,
    
    -- Human-readable label shown in the admin UI
    display_name TEXT NOT NULL,
    
    -- Description of where/how this AI call is used
    description TEXT,
    
    -- The file path or route where this AI call lives (for reference)
    source_location TEXT,
    
    -- Model override (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4.6")
    -- NULL means use the default from lib/ai/models.ts
    model TEXT,
    
    -- System prompt override (full text)
    -- NULL means use the hardcoded prompt in the source file
    system_prompt TEXT,
    
    -- Whether this configuration is active (allows disabling use cases)
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)

console.log("Created ai_configurations table")

// ─────────────────────────────────────────────────────────────────────────────
// ai_usage_log — tracks every AI request for stats
// ─────────────────────────────────────────────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Which use case this request came from
    use_case TEXT NOT NULL,
    
    -- Model that was actually used
    model TEXT NOT NULL,
    
    -- Token counts (nullable since not all providers report them)
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Latency in milliseconds
    latency_ms INTEGER,
    
    -- Whether the request succeeded
    success BOOLEAN NOT NULL DEFAULT true,
    
    -- Error message if failed
    error_message TEXT,
    
    -- Optional user context (who triggered the request)
    user_id UUID,
    user_email TEXT,
    
    -- Request metadata (e.g. conversation_id for ALFRED)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`)

console.log("Created ai_usage_log table")

// ─────────────────────────────────────────────────────────────────────────────
// Indexes for efficient querying
// ─────────────────────────────────────────────────────────────────────────────
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_use_case ON ai_usage_log(use_case);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created_at ON ai_usage_log(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_model ON ai_usage_log(model);
  CREATE INDEX IF NOT EXISTS idx_ai_usage_log_success ON ai_usage_log(success);
`)

console.log("Created indexes")

// ─────────────────────────────────────────────────────────────────────────────
// Seed the default configurations for each AI use case
// ─────────────────────────────────────────────────────────────────────────────
const seedConfigs = [
  {
    use_case: "alfred_chat",
    display_name: "ALFRED Chat",
    description:
      "The main ALFRED AI assistant that answers partner questions, looks up clients, checks workloads, and performs database queries. Uses tool calling for multi-step reasoning.",
    source_location: "app/api/alfred/chat/route.ts",
    model: null, // Uses ALFRED_CHAT_MODEL default
    system_prompt: null, // Uses the hardcoded system prompt in the route
  },
  {
    use_case: "daily_briefing",
    display_name: "Daily Briefing",
    description:
      "Generates the prose intro paragraph for the daily morning briefing email sent to team members. Summarizes key metrics and tasks.",
    source_location: "app/api/cron/daily-briefing/route.ts",
    model: null, // Uses EMAIL_PROSE_MODEL default
    system_prompt: null,
  },
  {
    use_case: "tommy_recap",
    display_name: "Tommy Weekly Recap",
    description:
      "Generates the narrative summary for the weekly Tommy Awards recap email, highlighting winners and point standings.",
    source_location: "app/api/cron/tommy-weekly-recap/route.ts",
    model: null, // Uses EMAIL_PROSE_MODEL default
    system_prompt: null,
  },
  {
    use_case: "jotform_enrichment",
    display_name: "Jotform Lead Enrichment",
    description:
      "Summarizes web research results when enriching new leads from Jotform submissions. Produces a concise profile of the prospect.",
    source_location: "lib/jotform/enrich.ts",
    model: null, // Uses RESEARCH_SUMMARY_MODEL default
    system_prompt: null,
  },
  {
    use_case: "question_research",
    display_name: "Question Research",
    description:
      "Analyzes web search results to answer research questions during lead qualification. Extracts key facts from search snippets.",
    source_location: "lib/jotform/research-questions.ts",
    model: null, // Uses RESEARCH_SUMMARY_MODEL default
    system_prompt: null,
  },
  {
    use_case: "claude_playground",
    display_name: "Claude Playground",
    description:
      "Internal testing playground for Claude models. Used for experimenting with prompts and model behavior before deploying to production use cases.",
    source_location: "app/api/playground/claude/route.ts",
    model: null, // Uses CLAUDE_DEFAULT
    system_prompt: null,
  },
]

for (const config of seedConfigs) {
  await client.query(
    `
    INSERT INTO ai_configurations (use_case, display_name, description, source_location, model, system_prompt)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (use_case) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      source_location = EXCLUDED.source_location,
      updated_at = now()
  `,
    [
      config.use_case,
      config.display_name,
      config.description,
      config.source_location,
      config.model,
      config.system_prompt,
    ]
  )
}

console.log(`Seeded ${seedConfigs.length} AI configurations`)

// ─────────────────────────────────────────────────────────────────────────────
// Updated_at trigger
// ─────────────────────────────────────────────────────────────────────────────
await client.query(`
  CREATE OR REPLACE FUNCTION update_ai_configurations_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS ai_configurations_updated_at ON ai_configurations;
  CREATE TRIGGER ai_configurations_updated_at
    BEFORE UPDATE ON ai_configurations
    FOR EACH ROW
    EXECUTE FUNCTION update_ai_configurations_updated_at();
`)

console.log("Created updated_at trigger")

await client.end()
console.log("\nDone! AI configuration tables are ready.")
