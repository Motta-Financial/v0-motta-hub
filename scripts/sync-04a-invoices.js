import fetch from "node-fetch"

const KARBON_BASE = "https://api.karbonhq.com/v3"
const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function karbonFetch(url) {
  const res = await fetch(url, {
    headers: {
      "Authorization": "Bearer " + KARBON_BEARER_TOKEN,
      "AccessKey": KARBON_ACCESS_KEY,
      "Accept": "application/json",
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error("Karbon " + res.status + ": " + text.substring(0, 200))
  }
  return res.json()
}

async function karbonFetchAll(endpoint) {
  const all = []
  let url = KARBON_BASE + endpoint
  while (url) {
    const data = await karbonFetch(url)
    const items = data.value || data || []
    if (Array.isArray(items)) all.push(...items)
    else if (Array.isArray(data)) { all.push(...data); break }
    url = data["@odata.nextLink"] || null
  }
  return all
}

async function supabaseUpsert(table, records, conflictCol) {
  if (!records.length) return { ok: 0, err: 0 }
  let ok = 0, err = 0
  for (let i = 0; i < records.length; i += 100) {
    const batch = records.slice(i, i + 100)
    const url = SUPABASE_URL + "/rest/v1/" + table + "?on_conflict=" + conflictCol
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    })
    if (res.ok) { ok += batch.length }
    else {
      const t = await res.text()
      console.log("  Batch error (" + table + "): " + t.substring(0, 300))
      err += batch.length
    }
  }
  return { ok, err }
}

async function main() {
  console.log("=== SYNC INVOICES ===")
  try {
    const invoices = await karbonFetchAll("/Invoices")
    console.log("Fetched " + invoices.length + " invoices from Karbon")

    const mapped = invoices.map(function(inv) {
      return {
        karbon_invoice_key: inv.InvoiceKey || inv.InvoiceNumber,
        invoice_number: inv.InvoiceNumber || null,
        karbon_work_item_key: inv.WorkItemKey || null,
        work_item_title: inv.WorkItemTitle || null,
        client_key: inv.ClientKey || null,
        client_name: inv.ClientName || null,
        amount: inv.SubTotal || inv.Subtotal || inv.Amount || null,
        tax: inv.Tax || inv.TaxAmount || null,
        total_amount: inv.TotalAmount || inv.Total || null,
        currency: inv.Currency || "USD",
        status: inv.Status || null,
        issued_date: inv.InvoiceDate || inv.IssuedDate || null,
        due_date: inv.DueDate || null,
        paid_date: inv.PaidDate || null,
        line_items: inv.LineItems || null,
        karbon_url: inv.InvoiceKey ? "https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/" + inv.InvoiceKey : null,
        karbon_created_at: inv.CreatedDate || null,
        karbon_modified_at: inv.LastModifiedDateTime || null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    })

    const result = await supabaseUpsert("karbon_invoices", mapped, "karbon_invoice_key")
    console.log("Invoices: " + result.ok + " synced, " + result.err + " errors")
  } catch (e) {
    console.log("Invoices error: " + e.message)
  }
  console.log("=== DONE ===")
}

main()
