import { createClient } from "@supabase/supabase-js"
import * as fs from "fs"
import * as path from "path"

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// CSV parsing function that handles quoted fields with commas and newlines
function parseCSV(csvContent: string): string[][] {
  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ""
  let inQuotes = false

  for (let i = 0; i < csvContent.length; i++) {
    const char = csvContent[i]
    const nextChar = csvContent[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"'
        i++
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      currentRow.push(currentField)
      currentField = ""
    } else if (char === "\n" && !inQuotes) {
      currentRow.push(currentField)
      if (currentRow.length > 1) {
        rows.push(currentRow)
      }
      currentRow = []
      currentField = ""
    } else if (char === "\r" && !inQuotes) {
      // Skip carriage returns
    } else {
      currentField += char
    }
  }

  // Add last field and row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField)
    if (currentRow.length > 1) {
      rows.push(currentRow)
    }
  }

  return rows
}

// Parse date from JotForm format "Sep 26, 2025" to "2025-09-26"
function parseDate(dateStr: string): string | null {
  if (!dateStr || dateStr.trim() === "") return null

  const months: { [key: string]: string } = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  }

  const match = dateStr.match(/^(\w+)\s+(\d+),\s+(\d+)$/)
  if (match) {
    const [, month, day, year] = match
    const monthNum = months[month]
    if (monthNum) {
      return `${year}-${monthNum}-${day.padStart(2, "0")}`
    }
  }
  return null
}

async function importDebriefs() {
  console.log("[v0] Starting JotForm debriefs import...")

  // Read the CSV file
  const csvPath = path.join(
    process.cwd(),
    "user_read_only_context/text_attachments/JOTFORM_DEBRIEFS_1.2.2026-4dkdP.csv",
  )
  const csvContent = fs.readFileSync(csvPath, "utf-8")

  console.log("[v0] CSV file read, parsing...")

  const rows = parseCSV(csvContent)
  console.log(`[v0] Parsed ${rows.length} rows (including header)`)

  const headers = rows[0]
  console.log("[v0] Headers count:", headers.length)

  // Find column indices - the key columns are near the end
  // Based on the CSV structure:
  // - Submission Date is column 0
  // - Meeting Type is column 1
  // - The last few columns contain the debrief info

  const debriefs: {
    debrief_date: string | null
    debrief_type: string
    notes: string
    contact_name: string
    karbon_contact_url: string | null
    karbon_client_key: string | null
  }[] = []

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 10) continue

    const submissionDate = parseDate(row[0])
    const meetingType = row[1] || "Prospect/Client"

    // Find the notes and contact info - they're in the last columns
    // Looking at the structure, the pattern seems to be:
    // karbon_client_key, empty, contact_name, notes, karbon_url

    // Work backwards from end to find non-empty values
    let notes = ""
    let contactName = ""
    let karbonClientKey = ""
    let karbonUrl = ""

    // The CSV has many columns, the relevant ones are near the end
    // Let's look for patterns in the last 20 columns
    const lastCols = row.slice(-30)

    for (let j = lastCols.length - 1; j >= 0; j--) {
      const val = lastCols[j]?.trim() || ""

      // Skip empty values and numbers
      if (!val || val === "0" || val === "N/A" || val === "n/a") continue

      // Detect URLs
      if (val.includes("karbonhq.com") || val.includes("app2.karbon")) {
        if (!karbonUrl) karbonUrl = val
        continue
      }

      // Detect client keys (format: XX_NAME_NAME_####)
      if (/^[A-Z]{2}_[A-Z_]+_\d{4}$/.test(val) || /^[A-Z0-9]{10,}$/.test(val)) {
        if (!karbonClientKey) karbonClientKey = val
        continue
      }

      // Detect contact names (short, contains space or is a known name)
      const knownContacts = [
        "Dat Le",
        "Mark Dwyer",
        "Caroline Buckley",
        "Andrew Gianares",
        "Other",
        "Matt Laporte",
        "Grace Shi",
        "Brian O'Brien",
      ]
      if (knownContacts.some((n) => val === n)) {
        if (!contactName) contactName = val
        continue
      }

      // Long text is likely notes
      if (val.length > 100 && !notes) {
        notes = val
      }
    }

    // Only add if we have notes or meaningful content
    if (notes && submissionDate) {
      debriefs.push({
        debrief_date: submissionDate,
        debrief_type: meetingType,
        notes: notes.substring(0, 10000), // Truncate very long notes
        contact_name: contactName || "Unknown",
        karbon_contact_url: karbonUrl || null,
        karbon_client_key: karbonClientKey || null,
      })
    }
  }

  console.log(`[v0] Found ${debriefs.length} debriefs to import`)

  // First, get current count
  const { count: beforeCount } = await supabase.from("debriefs").select("*", { count: "exact", head: true })
  console.log(`[v0] Current debriefs count: ${beforeCount}`)

  // Insert in batches of 50
  const batchSize = 50
  let inserted = 0

  for (let i = 0; i < debriefs.length; i += batchSize) {
    const batch = debriefs.slice(i, i + batchSize)

    const { error } = await supabase.from("debriefs").insert(batch)

    if (error) {
      console.error(`[v0] Error inserting batch ${i / batchSize + 1}:`, error.message)
    } else {
      inserted += batch.length
      console.log(`[v0] Inserted batch ${i / batchSize + 1} (${inserted}/${debriefs.length})`)
    }
  }

  // Get final count
  const { count: afterCount } = await supabase.from("debriefs").select("*", { count: "exact", head: true })
  console.log(`[v0] Import complete! Final debriefs count: ${afterCount}`)
  console.log(`[v0] New records added: ${(afterCount || 0) - (beforeCount || 0)}`)
}

importDebriefs().catch(console.error)
