import { type NextRequest, NextResponse } from "next/server"
import { getKarbonCredentials, karbonFetchAll, karbonFetch } from "@/lib/karbon-api"
import { createClient } from "@supabase/supabase-js"

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Maps a Karbon Invoice to the karbon_invoices Supabase table.
 * Karbon API: GET /v3/Invoices with OData filters
 */
function mapKarbonInvoiceToSupabase(invoice: any) {
  return {
    karbon_invoice_key: invoice.InvoiceKey,
    invoice_number: invoice.InvoiceNumber || null,
    karbon_work_item_key: invoice.WorkItemKey || null,
    work_item_title: invoice.WorkItemTitle || null,
    client_key: invoice.ClientKey || null,
    client_name: invoice.ClientName || null,
    amount: invoice.Amount || null,
    tax: invoice.Tax || null,
    total_amount: invoice.TotalAmount || invoice.Amount || null,
    currency: invoice.Currency || "USD",
    status: invoice.Status || null,
    issued_date: invoice.IssuedDate ? invoice.IssuedDate.split("T")[0] : null,
    due_date: invoice.DueDate ? invoice.DueDate.split("T")[0] : null,
    paid_date: invoice.PaidDate ? invoice.PaidDate.split("T")[0] : null,
    line_items: invoice.LineItems || null,
    karbon_url: invoice.InvoiceKey
      ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/${invoice.InvoiceKey}`
      : null,
    karbon_created_at: invoice.CreatedDate || null,
    karbon_modified_at: invoice.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * GET /api/karbon/invoices
 * Fetch invoices from Karbon with optional filtering and Supabase sync
 */
export async function GET(request: NextRequest) {
  const credentials = getKarbonCredentials()

  if (!credentials) {
    return NextResponse.json({ error: "Karbon API credentials not configured" }, { status: 401 })
  }

  try {
    const searchParams = request.nextUrl.searchParams
    const clientKey = searchParams.get("clientKey")
    const workItemKey = searchParams.get("workItemKey")
    const status = searchParams.get("status")
    const issuedAfter = searchParams.get("issuedAfter")
    const issuedBefore = searchParams.get("issuedBefore")
    const top = searchParams.get("top")
    const importToSupabase = searchParams.get("import") === "true"
    const incrementalSync = searchParams.get("incremental") === "true"
    const fromSupabase = searchParams.get("source") === "supabase"

    // Return cached invoices from Supabase
    if (fromSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        return NextResponse.json({ error: "Supabase not configured" }, { status: 500 })
      }

      let query = supabase.from("karbon_invoices").select("*").order("issued_date", { ascending: false })

      if (clientKey) query = query.eq("client_key", clientKey)
      if (workItemKey) query = query.eq("karbon_work_item_key", workItemKey)
      if (status) query = query.eq("status", status)
      if (top) query = query.limit(Number.parseInt(top, 10))

      const { data, error } = await query

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({
        invoices: data || [],
        count: data?.length || 0,
        source: "supabase",
      })
    }

    const filters: string[] = []

    if (clientKey) {
      filters.push(`ClientKey eq '${clientKey}'`)
    }

    if (workItemKey) {
      filters.push(`WorkItemKey eq '${workItemKey}'`)
    }

    if (status) {
      filters.push(`Status eq '${status}'`)
    }

    if (issuedAfter) {
      filters.push(`IssuedDate ge ${issuedAfter}`)
    }

    if (issuedBefore) {
      filters.push(`IssuedDate le ${issuedBefore}`)
    }

    const queryOptions: any = {
      count: true,
      orderby: "IssuedDate desc",
    }

    // Get last sync timestamp for incremental sync
    let lastSyncTimestamp: string | null = null
    if (incrementalSync && importToSupabase) {
      const supabase = getSupabaseClient()
      if (supabase) {
        const { data: lastSync } = await supabase
          .from("karbon_invoices")
          .select("karbon_modified_at")
          .not("karbon_modified_at", "is", null)
          .order("karbon_modified_at", { ascending: false })
          .limit(1)
          .maybeSingle()

        if (lastSync?.karbon_modified_at) {
          lastSyncTimestamp = lastSync.karbon_modified_at
          filters.push(`LastModifiedDateTime gt ${lastSyncTimestamp}`)
        }
      }
    }

    if (filters.length > 0) {
      queryOptions.filter = filters.join(" and ")
    }

    if (top) {
      queryOptions.top = Number.parseInt(top, 10)
    }

    const { data: invoices, error, totalCount } = await karbonFetchAll<any>("/Invoices", credentials, queryOptions)

    if (error) {
      return NextResponse.json({ error: `Karbon API error: ${error}` }, { status: 500 })
    }

    let importResult = null
    if (importToSupabase) {
      const supabase = getSupabaseClient()
      if (!supabase) {
        importResult = { error: "Supabase not configured" }
      } else {
        let synced = 0
        let errors = 0
        const errorDetails: string[] = []

        const batchSize = 50
        for (let i = 0; i < invoices.length; i += batchSize) {
          const batch = invoices.slice(i, i + batchSize)
          const mappedBatch = batch.map((invoice: any) => ({
            ...mapKarbonInvoiceToSupabase(invoice),
            created_at: new Date().toISOString(),
          }))

          const { error: upsertError } = await supabase.from("karbon_invoices").upsert(mappedBatch, {
            onConflict: "karbon_invoice_key",
            ignoreDuplicates: false,
          })

          if (upsertError) {
            errors += batch.length
            errorDetails.push(upsertError.message)
          } else {
            synced += batch.length
          }
        }

        importResult = {
          success: errors === 0,
          synced,
          errors,
          incrementalSync,
          lastSyncTimestamp,
          errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 5) : undefined,
        }
      }
    }

    const mappedInvoices = invoices.map((invoice: any) => ({
      InvoiceKey: invoice.InvoiceKey,
      InvoiceNumber: invoice.InvoiceNumber,
      Amount: invoice.Amount,
      Tax: invoice.Tax,
      TotalAmount: invoice.TotalAmount || invoice.Amount,
      Currency: invoice.Currency,
      Status: invoice.Status,
      IssuedDate: invoice.IssuedDate,
      DueDate: invoice.DueDate,
      PaidDate: invoice.PaidDate,
      Client: invoice.ClientName
        ? { ClientKey: invoice.ClientKey, ClientName: invoice.ClientName }
        : null,
      WorkItem: invoice.WorkItemKey
        ? { WorkItemKey: invoice.WorkItemKey, Title: invoice.WorkItemTitle }
        : null,
      LineItems: invoice.LineItems,
      CreatedDate: invoice.CreatedDate,
      ModifiedDate: invoice.LastModifiedDateTime,
    }))

    // Summary stats
    const totalAmount = mappedInvoices.reduce((sum: number, i: any) => sum + (i.TotalAmount || 0), 0)
    const paidAmount = mappedInvoices
      .filter((i: any) => i.Status === "Paid")
      .reduce((sum: number, i: any) => sum + (i.TotalAmount || 0), 0)
    const outstandingAmount = mappedInvoices
      .filter((i: any) => i.Status !== "Paid" && i.Status !== "Void")
      .reduce((sum: number, i: any) => sum + (i.TotalAmount || 0), 0)

    return NextResponse.json({
      invoices: mappedInvoices,
      count: mappedInvoices.length,
      totalCount: totalCount || mappedInvoices.length,
      summary: {
        totalAmount,
        paidAmount,
        outstandingAmount,
        invoiceCount: mappedInvoices.length,
      },
      importResult,
    })
  } catch (error) {
    console.error("[v0] Error fetching Karbon invoices:", error)
    return NextResponse.json(
      { error: "Failed to fetch invoices", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
