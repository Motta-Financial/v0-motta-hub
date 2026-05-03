/**
 * Pure mapper: Karbon Invoice JSON -> Supabase karbon_invoices row.
 *
 * Per the Karbon API spec, the invoice envelope shape varies — most useful
 * top-level fields are coalesced here. The full payload is preserved on the
 * row's `raw_payload` jsonb column if present.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonInvoiceToSupabase(invoice: any) {
  return {
    karbon_invoice_key: invoice.InvoiceKey || invoice.Key,
    invoice_number: invoice.InvoiceNumber || invoice.Number || null,
    karbon_work_item_key: invoice.WorkItemKey || null,
    work_item_title: invoice.WorkItemTitle || null,
    client_key: invoice.ClientKey || null,
    client_name: invoice.ClientName || null,
    amount: invoice.TotalAmount ?? invoice.Amount ?? null,
  }
}

export function buildInvoiceUrl(invoiceKey: string) {
  return `${KARBON_TENANT_PREFIX}/invoices/${invoiceKey}`
}
