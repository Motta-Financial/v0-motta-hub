import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/server"
import { computeTaxProfile, getClientDocuments } from "@/lib/tax/profile"

/**
 * GET /api/tax/clients/[clientId]/context
 * 
 * Returns a structured context object optimized for ALFRED and AI consumption.
 * Includes all identifiers, tax history, financial summary, and document status.
 * 
 * This endpoint is designed to give ALFRED everything it needs to:
 * 1. Identify and confirm the client
 * 2. Understand their tax situation
 * 3. Know what documents are expected/received
 * 4. Answer questions about their tax history
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  try {
    const supabase = createAdminClient()

    // Fetch client and profile in parallel
    const [clientRes, profile, documents] = await Promise.all([
      supabase
        .from("proconnect_clients")
        .select("*")
        .eq("proconnect_client_id", clientId)
        .single(),
      computeTaxProfile(clientId),
      getClientDocuments(clientId),
    ])

    if (clientRes.error) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 })
    }

    const client = clientRes.data

    // Fetch latest engagements for context. Hub-side identity (Karbon
    // contact key, legacy Motta client id, Hub contact UUID) is NOT
    // resolved here — this endpoint is ProConnect-only by design so
    // ALFRED gets a single, consistent system of record.
    const { data: recentEngagements } = await supabase
      .from("proconnect_engagements_enriched")
      .select("engagement_id, tax_year, return_type, efile_status, preparer_name, user_defined_status_name")
      .eq("proconnect_client_id", clientId)
      .order("tax_year", { ascending: false })
      .limit(10)

    // Build structured context for ALFRED
    const context = {
      // Identification
      identification: {
        proconnectClientId: client.proconnect_client_id,
        displayName: client.display_name,
        firstName: client.first_name,
        lastName: client.last_name,
        businessName: client.business_name,
        clientType: client.client_type,
        isActive: client.client_state === "ACTIVE",
        // Cross-system identity (Karbon, Hub, legacy Motta id) is
        // intentionally absent — /tax/* is ProConnect-only.
        // Contact for verification
        email: client.email,
        phone: client.phone,
        ssnLast4: client.tax_id?.slice(-4) || null,
        location: [client.city, client.state].filter(Boolean).join(", ") || null,
      },

      // Tax profile summary
      taxProfile: profile ? {
        summary: profile.aiSummary,
        keywords: profile.aiKeywords,
        completeness: profile.profileCompleteness,
        needsAttention: profile.needsAttention,
        attentionReasons: profile.attentionReasons,
      } : null,

      // Filing history
      filingHistory: {
        totalReturns: profile?.totalReturns || 0,
        yearsFiled: profile?.taxYearsFiled || [],
        firstYear: profile?.firstYearFiled || null,
        lastYear: profile?.lastYearFiled || null,
        consecutiveYears: profile?.consecutiveYears || 0,
        primaryFilingStatus: profile?.primaryFilingStatus || null,
        primaryReturnType: profile?.primaryReturnType || null,
        // Recent returns for context with full details
        recentReturns: (recentEngagements || []).map(e => ({
          engagementId: e.engagement_id,
          year: e.tax_year,
          type: e.return_type,
          is1040: e.return_type === "1040" || e.return_type === "IND",
          status: e.user_defined_status_name || e.efile_status || "unknown",
          efileStatus: e.efile_status,
          preparer: e.preparer_name,
          // Quick reference URLs
          view1040Url: (e.return_type === "1040" || e.return_type === "IND") 
            ? `/tax/returns/${e.engagement_id}/1040?clientId=${clientId}`
            : null,
        })),
        // Return type breakdown
        returnTypeCounts: (recentEngagements || []).reduce((acc, e) => {
          const type = e.return_type || "Unknown"
          acc[type] = (acc[type] || 0) + 1
          return acc
        }, {} as Record<string, number>),
      },

      // Financial snapshot
      financials: profile ? {
        latestYear: profile.lastYearFiled,
        totalIncome: profile.latestTotalIncome,
        agi: profile.latestAgi,
        taxableIncome: profile.latestTaxableIncome,
        totalTax: profile.latestTotalTax,
        effectiveRate: profile.latestEffectiveRate,
        refundOrOwed: profile.latestRefundOrOwed,
        incomeTrend: profile.incomeTrend,
        // Complexity indicators
        hasScheduleC: profile.hasScheduleC,
        hasScheduleE: profile.hasScheduleE,
        hasScheduleF: profile.hasScheduleF,
        hasForeignAccounts: profile.hasForeignAccounts,
      } : null,

      // Document status
      documents: {
        total: documents.length,
        pending: documents.filter(d => d.status === "pending").length,
        received: documents.filter(d => d.status === "received").length,
        entered: documents.filter(d => d.status === "entered").length,
        verified: documents.filter(d => d.status === "verified").length,
        issues: documents.filter(d => d.status === "issue").length,
        // Pending items for follow-up
        pendingItems: documents
          .filter(d => d.status === "pending")
          .map(d => ({
            type: d.documentType,
            subtype: d.documentSubtype,
            issuer: d.issuerName,
            year: d.taxYear,
          })),
      },

      // Preparer info
      preparers: {
        primary: profile?.primaryPreparerName || null,
        history: profile?.preparerHistory || [],
      },

      // Timestamps
      metadata: {
        clientCreated: client.created_at,
        clientUpdated: client.updated_at,
        profileComputed: new Date().toISOString(),
      },
    }

    return NextResponse.json(context)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
