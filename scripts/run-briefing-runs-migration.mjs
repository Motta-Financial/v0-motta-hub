import postgres from 'postgres';

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;

if (!url) {
  console.log('No POSTGRES_URL found');
  process.exit(1);
}

const sql = postgres(url);

try {
  // Create the table
  await sql`
    CREATE TABLE IF NOT EXISTS public.briefing_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE,
      status TEXT NOT NULL DEFAULT 'running',
      recipients_count INTEGER DEFAULT 0,
      emails_sent INTEGER DEFAULT 0,
      emails_failed INTEGER DEFAULT 0,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `;
  console.log('Table briefing_runs created successfully!');

  // Enable RLS
  await sql`ALTER TABLE public.briefing_runs ENABLE ROW LEVEL SECURITY`;
  console.log('RLS enabled');

  // Create policies (ignore errors if they already exist)
  try {
    await sql`
      CREATE POLICY briefing_runs_select_authenticated 
        ON public.briefing_runs FOR SELECT 
        TO authenticated 
        USING (true)
    `;
    console.log('Select policy created');
  } catch (e) {
    if (e.code === '42710') {
      console.log('Select policy already exists');
    } else {
      throw e;
    }
  }

  try {
    await sql`
      CREATE POLICY briefing_runs_all_service 
        ON public.briefing_runs FOR ALL 
        TO service_role 
        USING (true) 
        WITH CHECK (true)
    `;
    console.log('Service role policy created');
  } catch (e) {
    if (e.code === '42710') {
      console.log('Service role policy already exists');
    } else {
      throw e;
    }
  }

  // Verify
  const rows = await sql`SELECT COUNT(*) as count FROM public.briefing_runs`;
  console.log('Verification successful - table has', rows[0].count, 'rows');

  console.log('\nDone! Table briefing_runs is ready.');

} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await sql.end();
}
