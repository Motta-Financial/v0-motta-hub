/**
 * One-time migration script: Import AirTable Debriefs to Supabase
 * 
 * Run with:
 * node --env-file-if-exists=/vercel/share/.env.project scripts/import_airtable_debriefs.js
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Teammate name -> team_member_id mapping
const TEAMMATE_MAP = {
  'Dat Le': '21969201-a354-4f43-b4e8-0a348c0ecb27',
  'Mark Dwyer': '503705e4-25ee-4fc5-8c02-33005737be57',
  'Caroline Buckley': '4836336c-66c7-48fb-93aa-70e1e82a9c5c',
  'Andrew Gianares': 'b1945d12-8e60-4489-8f1a-4c5a55c802c0',
  'Matthew Pereira': '910afa82-3f61-4f6f-a9a6-ceec31f0c691',
};

// Parse CSV with proper quote handling
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' && !inQuotes) {
      row.push(field.trim());
      if (row.some(f => f)) rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r' && !inQuotes) {
      // Skip
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.trim());
    if (row.some(f => f)) rows.push(row);
  }
  return rows;
}

// Parse date from M/D/YYYY to YYYY-MM-DD
function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [month, day, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function main() {
  console.log('Reading CSV...');
  const csv = fs.readFileSync('scripts/temp_debriefs_import.csv', 'utf-8');
  const rows = parseCSV(csv);
  const headers = rows[0];
  const data = rows.slice(1);
  
  console.log(`Found ${data.length} rows to import`);
  console.log('Headers:', headers);
  
  // Column indices
  const urlIdx = headers.indexOf('Karbon Work Item URL');
  const teammateIdx = headers.indexOf('Teammate');
  const dateIdx = headers.indexOf('Date');
  const typeIdx = headers.indexOf('Meeting Type');
  const clientKeyIdx = headers.indexOf('Karbon Client Number');
  const notesIdx = headers.indexOf('MEETING NOTES');
  const pricingIdx = headers.indexOf('PRICING ADJUSTMENTS');
  
  const toInsert = [];
  const flagged = [];
  
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rowNum = i + 2; // 1-based + header
    
    const url = row[urlIdx] || null;
    const teammate = row[teammateIdx] || '';
    const dateStr = row[dateIdx] || '';
    // Airtable's "Prospect/Client" rows are just regular meetings — collapse
    // to "meeting" so the importer stays consistent with the rest of the
    // debriefs (Calendly bridge, Zoom triage, manual Hub debriefs).
    const rawMeetingType = row[typeIdx] || null;
    const meetingType =
      rawMeetingType && /^prospect\s*\/\s*client$/i.test(rawMeetingType.trim())
        ? 'meeting'
        : rawMeetingType;
    const clientKey = row[clientKeyIdx] || null;
    const meetingNotes = row[notesIdx] || '';
    const pricingAdj = row[pricingIdx] || '';
    
    // Combine notes with pricing adjustments
    let notes = meetingNotes;
    if (pricingAdj) {
      notes = notes 
        ? `${notes}\n\n---\nPRICING ADJUSTMENTS:\n${pricingAdj}`
        : `PRICING ADJUSTMENTS:\n${pricingAdj}`;
    }
    
    // Parse date
    const debriefDate = parseDate(dateStr);
    
    // Lookup teammate
    const teamMemberId = TEAMMATE_MAP[teammate] || null;
    
    // Flag rows with missing required fields
    if (!debriefDate || !notes) {
      flagged.push({
        rowNum,
        reason: !debriefDate ? 'Missing Date' : 'Missing MEETING NOTES',
        url,
        teammate,
        dateStr,
        meetingType,
        clientKey,
      });
      continue;
    }
    
    toInsert.push({
      karbon_work_url: url,
      team_member_id: teamMemberId,
      debrief_date: debriefDate,
      debrief_type: meetingType,
      karbon_client_key: clientKey,
      notes: notes,
      status: 'completed',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  
  console.log(`\nReady to insert: ${toInsert.length} rows`);
  console.log(`Flagged for review: ${flagged.length} rows`);
  
  if (flagged.length > 0) {
    console.log('\n=== FLAGGED ROWS ===');
    for (const f of flagged) {
      console.log(`Row ${f.rowNum}: ${f.reason}`);
      console.log(`  URL: ${f.url}`);
      console.log(`  Teammate: ${f.teammate}`);
      console.log(`  Date: ${f.dateStr}`);
      console.log(`  Type: ${f.meetingType}`);
      console.log(`  Client: ${f.clientKey}`);
      console.log('');
    }
  }
  
  // Insert in batches of 50
  const BATCH_SIZE = 50;
  let inserted = 0;
  let errors = 0;
  
  console.log('\nInserting into Supabase...');
  
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    
    const { data: result, error } = await supabase
      .from('debriefs')
      .insert(batch)
      .select('id');
    
    if (error) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errors += batch.length;
    } else {
      inserted += result?.length || batch.length;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${result?.length || batch.length} rows`);
    }
  }
  
  console.log('\n=== IMPORT COMPLETE ===');
  console.log(`Inserted: ${inserted}`);
  console.log(`Errors: ${errors}`);
  console.log(`Flagged (skipped): ${flagged.length}`);
}

main().catch(console.error);
