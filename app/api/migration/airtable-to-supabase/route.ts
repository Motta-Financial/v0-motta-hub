import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Helper to convert Airtable field name to Supabase column name
function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s\-/&]+/g, "_")
    .replace(/[^\w_]/g, "")
    .toLowerCase()
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tableName, records, fieldNames } = body

    if (!tableName || !records || !Array.isArray(records)) {
      return NextResponse.json({ error: "Missing required fields: tableName, records" }, { status: 400 })
    }

    const supabase = await createClient()
    const supabaseTableName = toSnakeCase(tableName)

    const columnDefs = [
      "id uuid primary key default gen_random_uuid()",
      "airtable_id text unique",
      "created_at timestamp with time zone default now()",
      "updated_at timestamp with time zone default now()",
      ...(fieldNames || []).map((field: string) => `${toSnakeCase(field)} text`),
    ].join(",\n  ")

    const createTableSQL = `
-- Run this SQL in Supabase SQL Editor if table doesn't exist
CREATE TABLE IF NOT EXISTS ${supabaseTableName} (
  ${columnDefs}
);

-- Enable Row Level Security
ALTER TABLE ${supabaseTableName} ENABLE ROW LEVEL SECURITY;

-- Create policy to allow all operations (adjust as needed)
CREATE POLICY "Allow all operations" ON ${supabaseTableName}
  FOR ALL USING (true) WITH CHECK (true);
`

    // Transform records for insertion
    const transformedRecords = records.map((record: any) => {
      const transformed: Record<string, any> = {
        airtable_id: record.id,
        created_at: record.createdTime || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      // Map each field from Airtable to Supabase column name
      Object.entries(record.fields || {}).forEach(([fieldName, value]) => {
        const columnName = toSnakeCase(fieldName)
        // Handle special types - convert everything to text for simplicity
        if (Array.isArray(value)) {
          transformed[columnName] = JSON.stringify(value)
        } else if (typeof value === "object" && value !== null) {
          transformed[columnName] = JSON.stringify(value)
        } else if (value !== null && value !== undefined) {
          transformed[columnName] = String(value)
        } else {
          transformed[columnName] = null
        }
      })

      return transformed
    })

    // Try to insert records in batches
    const batchSize = 100
    let insertedCount = 0
    const errors: string[] = []

    for (let i = 0; i < transformedRecords.length; i += batchSize) {
      const batch = transformedRecords.slice(i, i + batchSize)
      const { error: insertError, data } = await supabase.from(supabaseTableName).upsert(batch, {
        onConflict: "airtable_id",
        ignoreDuplicates: false,
      })

      if (insertError) {
        console.error("[v0] Insert error for batch:", insertError)
        if (insertError.message.includes("relation") && insertError.message.includes("does not exist")) {
          return NextResponse.json({
            success: false,
            error: `Table "${supabaseTableName}" does not exist in Supabase.`,
            createTableSQL,
            supabaseTableName,
            message: "Please run the SQL script below in your Supabase SQL Editor to create the table, then try again.",
          })
        }
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${insertError.message}`)
      } else {
        insertedCount += batch.length
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      supabaseTableName,
      totalRecords: records.length,
      insertedCount,
      errors: errors.length > 0 ? errors : undefined,
      createTableSQL,
    })
  } catch (error) {
    console.error("[v0] Migration error:", error)
    return NextResponse.json({ error: "Migration failed", details: String(error) }, { status: 500 })
  }
}
