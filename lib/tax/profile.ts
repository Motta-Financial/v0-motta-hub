/**
 * Tax Profile Library
 * 
 * Provides functions for:
 * - Client identification and search (for ALFRED and Hub functions)
 * - Tax profile computation and caching
 * - Document tracking
 * - AI-ready summaries
 */

import { createAdminClient } from "@/lib/supabase/server"

// ============================================================================
// Types
// ============================================================================

export type ClientFingerprint = {
  proconnectClientId: string
  displayName: string | null
  firstName: string | null
  lastName: string | null
  businessName: string | null
  ssnLast4: string | null
  ein: string | null
  primaryEmail: string | null
  phonePrimary: string | null
  phoneLast4: string | null
  city: string | null
  state: string | null
  clientType: "PERSON" | "ORGANIZATION"
  spouseFirstName: string | null
  spouseLastName: string | null
  legacyMottaClientId: string | null
  karbonContactKey: string | null
  hubContactId: string | null
  isActive: boolean
}

export type TaxProfileSummary = {
  proconnectClientId: string
  totalReturns: number
  taxYearsFiled: number[]
  firstYearFiled: number | null
  lastYearFiled: number | null
  consecutiveYears: number
  primaryFilingStatus: string | null
  primaryReturnType: string | null
  hasScheduleC: boolean
  hasScheduleE: boolean
  hasScheduleF: boolean
  hasForeignAccounts: boolean
  incomeTrend: Record<string, number>
  agiTrend: Record<string, number>
  taxTrend: Record<string, number>
  refundTrend: Record<string, number>
  latestTotalIncome: number | null
  latestAgi: number | null
  latestTaxableIncome: number | null
  latestTotalTax: number | null
  latestEffectiveRate: number | null
  latestRefundOrOwed: number | null
  primaryPreparerName: string | null
  preparerHistory: string[]
  documentsOnFile: number
  pendingDocuments: number
  lastDocumentReceived: string | null
  profileCompleteness: number
  needsAttention: boolean
  attentionReasons: string[]
  aiSummary: string | null
  aiKeywords: string[]
}

export type TaxDocument = {
  id: string
  proconnectClientId: string
  taxYear: number
  documentType: string
  documentSubtype: string | null
  issuerName: string | null
  issuerEin: string | null
  reportedAmount: number | null
  status: "pending" | "received" | "entered" | "verified" | "issue"
  enteredBy: string | null
  enteredAt: string | null
  verifiedBy: string | null
  verifiedAt: string | null
  blobUrl: string | null
  fileName: string | null
  notes: string | null
  createdAt: string
}

export type SearchResult = {
  proconnectClientId: string
  displayName: string | null
  firstName: string | null
  lastName: string | null
  businessName: string | null
  primaryEmail: string | null
  phoneLast4: string | null
  city: string | null
  state: string | null
  clientType: string
  totalReturns: number | null
  lastYearFiled: number | null
  primaryFilingStatus: string | null
  aiSummary: string | null
  matchScore: number
  matchedOn: string[]
}

// ============================================================================
// Client Search - For ALFRED and Hub functions
// ============================================================================

/**
 * Search for tax clients across all identifiers
 * Supports: name, email, phone (last 4 or 7), SSN last 4, legacy ID
 */
export async function searchTaxClients(
  query: string,
  options: {
    limit?: number
    activeOnly?: boolean
    includeAiSummary?: boolean
  } = {}
): Promise<SearchResult[]> {
  const { limit = 10, activeOnly = true, includeAiSummary = true } = options
  const supabase = createAdminClient()
  
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []
  
  // Determine query type for optimized search
  const isPhone = /^\d{4,10}$/.test(normalizedQuery)
  const isEmail = normalizedQuery.includes("@")
  const isSsn4 = /^\d{4}$/.test(normalizedQuery)
  const isLegacyId = /^[A-Z]{2}_/.test(query.toUpperCase())
  
  // Build search conditions
  const results: SearchResult[] = []
  const matchedIds = new Set<string>()
  
  // 1. Exact matches first (fastest, highest confidence)
  if (isLegacyId) {
    const { data } = await supabase
      .from("tax_clients_searchable")
      .select("*")
      .ilike("legacy_motta_client_id", query.toUpperCase())
      .limit(limit)
    
    for (const row of data || []) {
      if (!matchedIds.has(row.proconnect_client_id)) {
        matchedIds.add(row.proconnect_client_id)
        results.push(mapSearchResult(row, 100, ["legacy_id"]))
      }
    }
  }
  
  if (isPhone && normalizedQuery.length === 4) {
    const { data } = await supabase
      .from("tax_clients_searchable")
      .select("*")
      .eq("phone_last4", normalizedQuery)
      .limit(limit)
    
    for (const row of data || []) {
      if (!matchedIds.has(row.proconnect_client_id)) {
        matchedIds.add(row.proconnect_client_id)
        results.push(mapSearchResult(row, 90, ["phone_last4"]))
      }
    }
  }
  
  if (isSsn4) {
    const { data } = await supabase
      .from("tax_clients_searchable")
      .select("*")
      .eq("ssn_last4", normalizedQuery)
      .limit(limit)
    
    for (const row of data || []) {
      if (!matchedIds.has(row.proconnect_client_id)) {
        matchedIds.add(row.proconnect_client_id)
        results.push(mapSearchResult(row, 95, ["ssn_last4"]))
      }
    }
  }
  
  if (isEmail) {
    const { data } = await supabase
      .from("tax_clients_searchable")
      .select("*")
      .eq("search_email", normalizedQuery)
      .limit(limit)
    
    for (const row of data || []) {
      if (!matchedIds.has(row.proconnect_client_id)) {
        matchedIds.add(row.proconnect_client_id)
        results.push(mapSearchResult(row, 100, ["email"]))
      }
    }
  }
  
  // 2. Fuzzy name search (uses trigram index)
  if (results.length < limit && !isPhone && !isSsn4) {
    const { data } = await supabase
      .from("tax_clients_searchable")
      .select("*")
      .textSearch("search_name", normalizedQuery.split(/\s+/).join(" & "), {
        type: "websearch",
      })
      .limit(limit - results.length)
    
    for (const row of data || []) {
      if (!matchedIds.has(row.proconnect_client_id)) {
        matchedIds.add(row.proconnect_client_id)
        results.push(mapSearchResult(row, 70, ["name"]))
      }
    }
    
    // Also try ILIKE for partial matches
    if (results.length < limit) {
      const { data: ilikeData } = await supabase
        .from("tax_clients_searchable")
        .select("*")
        .or(`display_name.ilike.%${normalizedQuery}%,first_name.ilike.%${normalizedQuery}%,last_name.ilike.%${normalizedQuery}%,business_name.ilike.%${normalizedQuery}%`)
        .limit(limit - results.length)
      
      for (const row of ilikeData || []) {
        if (!matchedIds.has(row.proconnect_client_id)) {
          matchedIds.add(row.proconnect_client_id)
          results.push(mapSearchResult(row, 60, ["name_partial"]))
        }
      }
    }
  }
  
  // Sort by match score descending
  results.sort((a, b) => b.matchScore - a.matchScore)
  
  return results.slice(0, limit)
}

function mapSearchResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any,
  score: number,
  matchedOn: string[]
): SearchResult {
  return {
    proconnectClientId: row.proconnect_client_id,
    displayName: row.display_name,
    firstName: row.first_name,
    lastName: row.last_name,
    businessName: row.business_name,
    primaryEmail: row.primary_email,
    phoneLast4: row.phone_last4,
    city: row.city,
    state: row.state,
    clientType: row.client_type,
    totalReturns: row.total_returns,
    lastYearFiled: row.last_year_filed,
    primaryFilingStatus: row.primary_filing_status,
    aiSummary: row.ai_summary,
    matchScore: score,
    matchedOn,
  }
}

// ============================================================================
// Profile Computation
// ============================================================================

/**
 * Compute and cache the tax profile summary for a client
 * Call this after syncing engagements or receiving new documents
 */
export async function computeTaxProfile(proconnectClientId: string): Promise<TaxProfileSummary | null> {
  const supabase = createAdminClient()
  
  // Fetch all engagements for this client
  const { data: engagements, error: engError } = await supabase
    .from("proconnect_engagements_enriched")
    .select("*")
    .eq("proconnect_client_id", proconnectClientId)
    .order("tax_year", { ascending: false })
  
  if (engError || !engagements) {
    console.error("[v0] Failed to fetch engagements:", engError)
    return null
  }
  
  // Fetch client info
  const { data: client } = await supabase
    .from("proconnect_clients")
    .select("*")
    .eq("proconnect_client_id", proconnectClientId)
    .single()
  
  // Fetch documents
  const { data: documents } = await supabase
    .from("tax_documents")
    .select("*")
    .eq("proconnect_client_id", proconnectClientId)
  
  // Compute metrics
  const taxYears = [...new Set(engagements.map(e => e.tax_year).filter(Boolean) as number[])].sort((a, b) => b - a)
  const returnTypes = engagements.map(e => e.return_type).filter(Boolean)
  const filingStatuses = engagements.map(e => e.filing_status).filter(Boolean)
  
  // Count consecutive years from most recent
  let consecutiveYears = 0
  for (let i = 0; i < taxYears.length; i++) {
    if (i === 0 || taxYears[i] === taxYears[i - 1] - 1) {
      consecutiveYears++
    } else {
      break
    }
  }
  
  // Build trends (last 3 years)
  const incomeTrend: Record<string, number> = {}
  const agiTrend: Record<string, number> = {}
  const taxTrend: Record<string, number> = {}
  const refundTrend: Record<string, number> = {}
  
  for (const eng of engagements.slice(0, 3)) {
    const year = eng.tax_year?.toString()
    if (!year) continue
    const rawJson = eng.raw_json as Record<string, unknown> | null
    if (rawJson?.totalIncome) incomeTrend[year] = rawJson.totalIncome as number
    if (rawJson?.agi) agiTrend[year] = rawJson.agi as number
    if (rawJson?.totalTax) taxTrend[year] = rawJson.totalTax as number
    if (rawJson?.refundAmount) refundTrend[year] = rawJson.refundAmount as number
  }
  
  // Latest year metrics
  const latest = engagements[0]
  const latestRaw = latest?.raw_json as Record<string, unknown> | null
  
  // Preparer analysis
  const preparerCounts: Record<string, number> = {}
  for (const eng of engagements) {
    if (eng.preparer_name) {
      preparerCounts[eng.preparer_name] = (preparerCounts[eng.preparer_name] || 0) + 1
    }
  }
  const primaryPreparer = Object.entries(preparerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null
  
  // Document stats
  const docsOnFile = (documents || []).filter(d => d.status !== "pending").length
  const pendingDocs = (documents || []).filter(d => d.status === "pending").length
  const lastDoc = (documents || []).sort((a, b) => 
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]
  
  // Profile completeness score
  let completeness = 0
  if (client?.display_name || client?.first_name) completeness += 20
  if (client?.email) completeness += 15
  if (client?.phone) completeness += 10
  if (client?.tax_id) completeness += 20
  if (engagements.length > 0) completeness += 20
  if (taxYears.length >= 2) completeness += 15
  
  // Attention reasons
  const attentionReasons: string[] = []
  if (!client?.email) attentionReasons.push("Missing email")
  if (!client?.phone) attentionReasons.push("Missing phone")
  if (pendingDocs > 0) attentionReasons.push(`${pendingDocs} pending documents`)
  if (taxYears.length > 0 && taxYears[0] < new Date().getFullYear() - 1) {
    attentionReasons.push("No recent tax return")
  }
  
  // Generate AI summary
  const aiSummary = generateAiSummary(client, engagements, taxYears, primaryPreparer)
  
  // Generate keywords for search
  const aiKeywords = generateKeywords(client, engagements, returnTypes)
  
  const summary: TaxProfileSummary = {
    proconnectClientId,
    totalReturns: engagements.length,
    taxYearsFiled: taxYears,
    firstYearFiled: taxYears[taxYears.length - 1] || null,
    lastYearFiled: taxYears[0] || null,
    consecutiveYears,
    primaryFilingStatus: mode(filingStatuses) || null,
    primaryReturnType: mode(returnTypes) || null,
    hasScheduleC: engagements.some(e => e.has_schedule_c),
    hasScheduleE: engagements.some(e => e.has_schedule_e),
    hasScheduleF: engagements.some(e => e.has_schedule_f),
    hasForeignAccounts: engagements.some(e => e.has_fbar),
    incomeTrend,
    agiTrend,
    taxTrend,
    refundTrend,
    latestTotalIncome: latestRaw?.totalIncome as number | null,
    latestAgi: latestRaw?.agi as number | null,
    latestTaxableIncome: latestRaw?.taxableIncome as number | null,
    latestTotalTax: latestRaw?.totalTax as number | null,
    latestEffectiveRate: latestRaw?.effectiveRate as number | null,
    latestRefundOrOwed: (latestRaw?.refundAmount as number) || -(latestRaw?.amountOwed as number) || null,
    primaryPreparerName: primaryPreparer,
    preparerHistory: Object.keys(preparerCounts),
    documentsOnFile: docsOnFile,
    pendingDocuments: pendingDocs,
    lastDocumentReceived: lastDoc?.created_at || null,
    profileCompleteness: Math.min(100, completeness),
    needsAttention: attentionReasons.length > 0,
    attentionReasons,
    aiSummary,
    aiKeywords,
  }
  
  // Upsert to cache table
  await supabase
    .from("tax_profile_summaries")
    .upsert({
      proconnect_client_id: proconnectClientId,
      total_returns: summary.totalReturns,
      tax_years_filed: summary.taxYearsFiled,
      first_year_filed: summary.firstYearFiled,
      last_year_filed: summary.lastYearFiled,
      consecutive_years: summary.consecutiveYears,
      primary_filing_status: summary.primaryFilingStatus,
      primary_return_type: summary.primaryReturnType,
      has_schedule_c: summary.hasScheduleC,
      has_schedule_e: summary.hasScheduleE,
      has_schedule_f: summary.hasScheduleF,
      has_foreign_accounts: summary.hasForeignAccounts,
      income_trend: summary.incomeTrend,
      agi_trend: summary.agiTrend,
      tax_trend: summary.taxTrend,
      refund_trend: summary.refundTrend,
      latest_total_income: summary.latestTotalIncome,
      latest_agi: summary.latestAgi,
      latest_taxable_income: summary.latestTaxableIncome,
      latest_total_tax: summary.latestTotalTax,
      latest_effective_rate: summary.latestEffectiveRate,
      latest_refund_or_owed: summary.latestRefundOrOwed,
      primary_preparer_name: summary.primaryPreparerName,
      preparer_history: summary.preparerHistory,
      documents_on_file: summary.documentsOnFile,
      pending_documents: summary.pendingDocuments,
      last_document_received: summary.lastDocumentReceived,
      profile_completeness: summary.profileCompleteness,
      needs_attention: summary.needsAttention,
      attention_reasons: summary.attentionReasons,
      ai_summary: summary.aiSummary,
      ai_keywords: summary.aiKeywords,
    }, { onConflict: "proconnect_client_id" })
  
  return summary
}

// ============================================================================
// Helper Functions
// ============================================================================

function mode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined
  const counts = new Map<T, number>()
  for (const item of arr) {
    counts.set(item, (counts.get(item) || 0) + 1)
  }
  let maxItem: T | undefined
  let maxCount = 0
  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count
      maxItem = item
    }
  }
  return maxItem
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateAiSummary(client: any, engagements: any[], taxYears: number[], preparer: string | null): string {
  const name = client?.display_name || client?.first_name || "Client"
  const type = client?.client_type === "PERSON" ? "individual" : "business"
  const yearsStr = taxYears.length > 0 
    ? `filing since ${taxYears[taxYears.length - 1]}` 
    : "no returns on file"
  const returns = engagements.length
  const preparerStr = preparer ? `, primarily prepared by ${preparer}` : ""
  
  return `${name} is an ${type} tax client${preparerStr}. ${returns} return(s) on file, ${yearsStr}.`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateKeywords(client: any, engagements: any[], returnTypes: string[]): string[] {
  const keywords: string[] = []
  
  // Name parts
  if (client?.first_name) keywords.push(client.first_name.toLowerCase())
  if (client?.last_name) keywords.push(client.last_name.toLowerCase())
  if (client?.business_name) keywords.push(...client.business_name.toLowerCase().split(/\s+/))
  
  // Return types
  for (const rt of new Set(returnTypes)) {
    keywords.push(rt.toLowerCase())
    if (rt === "1040" || rt === "IND") keywords.push("individual", "personal")
    if (rt === "1120" || rt === "CORP") keywords.push("corporation", "c-corp")
    if (rt === "1120S" || rt === "SCORP") keywords.push("s-corp", "s-corporation")
    if (rt === "1065" || rt === "PART") keywords.push("partnership")
    if (rt === "990") keywords.push("nonprofit", "exempt")
  }
  
  // Schedules
  if (engagements.some(e => e.has_schedule_c)) keywords.push("self-employed", "schedule c", "sole proprietor")
  if (engagements.some(e => e.has_schedule_e)) keywords.push("rental", "schedule e", "royalties")
  if (engagements.some(e => e.has_schedule_f)) keywords.push("farm", "agriculture", "schedule f")
  if (engagements.some(e => e.has_fbar)) keywords.push("fbar", "foreign", "international")
  
  // Location
  if (client?.state) keywords.push(client.state.toLowerCase())
  if (client?.city) keywords.push(client.city.toLowerCase())
  
  return [...new Set(keywords)]
}

// ============================================================================
// Document Management
// ============================================================================

export async function addTaxDocument(doc: Omit<TaxDocument, "id" | "createdAt">): Promise<TaxDocument | null> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from("tax_documents")
    .insert({
      proconnect_client_id: doc.proconnectClientId,
      tax_year: doc.taxYear,
      document_type: doc.documentType,
      document_subtype: doc.documentSubtype,
      issuer_name: doc.issuerName,
      issuer_ein: doc.issuerEin,
      reported_amount: doc.reportedAmount,
      status: doc.status,
      entered_by: doc.enteredBy,
      entered_at: doc.enteredAt,
      verified_by: doc.verifiedBy,
      verified_at: doc.verifiedAt,
      blob_url: doc.blobUrl,
      file_name: doc.fileName,
      notes: doc.notes,
    })
    .select()
    .single()
  
  if (error) {
    console.error("[v0] Failed to add document:", error)
    return null
  }
  
  // Recompute profile summary
  await computeTaxProfile(doc.proconnectClientId)
  
  return data as TaxDocument
}

export async function getClientDocuments(proconnectClientId: string, taxYear?: number): Promise<TaxDocument[]> {
  const supabase = createAdminClient()
  
  let query = supabase
    .from("tax_documents")
    .select("*")
    .eq("proconnect_client_id", proconnectClientId)
    .order("tax_year", { ascending: false })
    .order("document_type")
  
  if (taxYear) {
    query = query.eq("tax_year", taxYear)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error("[v0] Failed to fetch documents:", error)
    return []
  }
  
  return data as TaxDocument[]
}

// ============================================================================
// Fingerprint Sync
// ============================================================================

/**
 * Sync client fingerprint from ProConnect data
 * Call after syncing a client from ProConnect
 */
export async function syncClientFingerprint(proconnectClientId: string): Promise<void> {
  const supabase = createAdminClient()
  
  // Fetch from proconnect_clients
  const { data: client } = await supabase
    .from("proconnect_clients")
    .select("*")
    .eq("proconnect_client_id", proconnectClientId)
    .single()
  
  if (!client) return
  
  // Try to find Hub contact link
  const { data: hubContact } = await supabase
    .from("contacts")
    .select("id, karbon_contact_key, legacy_motta_client_id")
    .or(`email.eq.${client.email},phone.ilike.%${(client.phone || "").slice(-4)}`)
    .maybeSingle()
  
  // Upsert fingerprint
  await supabase.from("tax_client_fingerprints").upsert({
    proconnect_client_id: proconnectClientId,
    display_name: client.display_name,
    first_name: client.first_name,
    last_name: client.last_name,
    business_name: client.business_name,
    ssn_last4: client.tax_id?.slice(-4) || null,
    ein: client.client_type === "ORGANIZATION" ? client.tax_id : null,
    primary_email: client.email,
    phone_primary: client.phone,
    phone_last4: client.phone?.replace(/\D/g, "").slice(-4) || null,
    city: client.city,
    state: client.state,
    zip: client.zip,
    legacy_motta_client_id: hubContact?.legacy_motta_client_id || null,
    karbon_contact_key: hubContact?.karbon_contact_key || null,
    hub_contact_id: hubContact?.id || null,
    client_type: client.client_type,
    is_active: client.client_state === "ACTIVE",
  }, { onConflict: "proconnect_client_id" })
}
