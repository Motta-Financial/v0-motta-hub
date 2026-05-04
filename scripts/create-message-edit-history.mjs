import pg from "pg"

const rawUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL
if (!rawUrl) {
  console.error("Missing POSTGRES_URL_NON_POOLING / POSTGRES_URL")
  process.exit(1)
}

// Strip sslmode= so we can supply our own ssl config (Supabase uses a
// self-signed cert chain that node's default verify-full rejects).
const connectionString = rawUrl.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "")

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
})
await client.connect()

console.log("[migration] Creating public.message_edit_history ...")

await client.query(`
  CREATE TABLE IF NOT EXISTS public.message_edit_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    previous_content text,
    previous_gif_url text,
    edited_by_id uuid REFERENCES public.team_members(id) ON DELETE SET NULL,
    edited_by_name text NOT NULL,
    edited_by_initials text,
    edited_at timestamptz NOT NULL DEFAULT now()
  );
`)

await client.query(`
  CREATE INDEX IF NOT EXISTS idx_message_edit_history_message_id
    ON public.message_edit_history(message_id, edited_at DESC);
`)

await client.query(`ALTER TABLE public.message_edit_history ENABLE ROW LEVEL SECURITY;`)

await client.query(`DROP POLICY IF EXISTS "message_edit_history_allow_all" ON public.message_edit_history;`)

await client.query(`
  CREATE POLICY "message_edit_history_allow_all"
    ON public.message_edit_history
    FOR ALL
    USING (true)
    WITH CHECK (true);
`)

const verify = await client.query(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'message_edit_history'
  ORDER BY ordinal_position
`)
console.log("[migration] message_edit_history columns:")
console.table(verify.rows)

await client.end()
console.log("[migration] Done.")
