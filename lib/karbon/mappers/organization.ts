/**
 * Pure mapper: Karbon Organization JSON -> Supabase organizations row.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonOrganizationToSupabase(org: any) {
  const businessCards = Array.isArray(org.BusinessCards) ? org.BusinessCards : []
  const primaryCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}

  const postalAddresses = Array.isArray(primaryCard.PostalAddresses) ? primaryCard.PostalAddresses : []
  const primaryAddress =
    postalAddresses.find((a: any) => a.Type === "Physical" || a.Type === "Business" || a.IsPrimary) ||
    postalAddresses[0] ||
    {}

  const phoneNumbers = Array.isArray(primaryCard.PhoneNumbers) ? primaryCard.PhoneNumbers : []
  const workPhone = phoneNumbers.find((p: any) => p.Type === "Work" || p.Type === "Business") || phoneNumbers[0]

  const emailAddresses = Array.isArray(primaryCard.EmailAddresses) ? primaryCard.EmailAddresses : []
  const primaryEmailObj = emailAddresses.find((e: any) => e.IsPrimary) || emailAddresses[0]
  const primaryEmail =
    primaryEmailObj?.Address ||
    primaryEmailObj?.Email ||
    (typeof primaryEmailObj === "string" ? primaryEmailObj : null)

  const webSites = Array.isArray(primaryCard.WebSites) ? primaryCard.WebSites : []
  const primaryWebsite = webSites[0]?.Url || webSites[0]

  const regNumbers = Array.isArray(org.RegistrationNumbers) ? org.RegistrationNumbers : []

  let ein: string | null = null
  let businessNumber: string | null = null
  let taxNumber: string | null = null
  let salesTaxId: string | null = null
  let payrollTaxId: string | null = null
  let unemploymentTaxId: string | null = null
  let stateTaxId: string | null = null
  let gstNumber: string | null = null

  for (const reg of regNumbers) {
    const regNum = reg.RegistrationNumber || reg.Number
    const regType = (reg.Type || "").toLowerCase()
    if (regType.includes("ein") || regType.includes("employer")) ein = regNum
    else if (regType.includes("business number") || regType.includes("abn")) businessNumber = regNum
    else if (
      regType.includes("tax") &&
      !regType.includes("sales") &&
      !regType.includes("payroll") &&
      !regType.includes("state")
    )
      taxNumber = regNum
    else if (regType.includes("sales tax")) salesTaxId = regNum
    else if (regType.includes("payroll")) payrollTaxId = regNum
    else if (regType.includes("unemployment") || regType.includes("suta")) unemploymentTaxId = regNum
    else if (regType.includes("state")) stateTaxId = regNum
    else if (regType.includes("gst")) gstNumber = regNum
  }

  // Karbon's /Organizations list endpoint returns FullName as the canonical
  // organization display name (e.g. "145 High St LLC"). The detail endpoint
  // may also expose OrganizationName / Name on richer payloads, so we keep
  // those as preferred sources before falling back to FullName. The
  // "Organization {key}" placeholder is a last-resort guard against fully
  // empty rows — but we should NEVER use it when FullName is available
  // (otherwise Top Clients shows "Organization 7N3TRbHH6ls").
  const resolvedName: string =
    org.OrganizationName ||
    org.Name ||
    org.FullName ||
    (org.OrganizationKey ? `Organization ${org.OrganizationKey}` : "Unnamed Organization")

  return {
    karbon_organization_key: org.OrganizationKey,
    name: resolvedName,
    full_name: org.FullName || org.OrganizationName || org.Name || null,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,
    entity_type: org.ContactType || org.EntityType || null,
    contact_type: org.ContactType || null,
    restriction_level: org.RestrictionLevel || null,
    user_defined_identifier: org.UserDefinedIdentifier || null,
    industry: org.Industry || null,
    line_of_business: org.LineOfBusiness || null,
    primary_email: typeof primaryEmail === "string" ? primaryEmail : null,
    phone: workPhone?.Number || null,
    website: typeof primaryWebsite === "string" ? primaryWebsite : null,
    address_line1: primaryAddress.AddressLine1 || primaryAddress.Street || null,
    address_line2: primaryAddress.AddressLine2 || null,
    city: primaryAddress.City || null,
    state: primaryAddress.StateProvince || primaryAddress.State || null,
    zip_code: primaryAddress.PostCode || primaryAddress.PostalCode || primaryAddress.ZipCode || null,
    country: primaryAddress.Country || null,
    linkedin_url: primaryCard.LinkedInUrl || primaryCard.LinkedIn || null,
    twitter_handle: primaryCard.TwitterUrl || primaryCard.Twitter || null,
    facebook_url: primaryCard.FacebookUrl || primaryCard.Facebook || null,
    incorporation_state: org.IncorporationState || null,
    incorporation_date: org.IncorporationDate ? String(org.IncorporationDate).split("T")[0] : null,
    fiscal_year_end_month: org.FinancialYearEndMonth || null,
    fiscal_year_end_day: org.FinancialYearEndDay || null,
    annual_revenue: org.AnnualRevenue || null,
    base_currency: org.BaseCurrency || "USD",
    valuation: org.OrganizationValuation || null,
    valuation_date: org.ValuationDate ? String(org.ValuationDate).split("T")[0] : null,
    number_of_employees: org.NumberOfEmployees || null,
    tax_country_code: org.TaxCountryCode || null,
    is_vat_registered: org.IsVATRegistered ?? false,
    pays_tax: org.PaysTax ?? true,
    gst_registered: org.PrepareGST ?? false,
    gst_number: gstNumber || org.GSTNumber || null,
    gst_filing_frequency: org.GstPeriod || null,
    gst_reporting_method: org.GstBasis || null,
    ein,
    business_number: businessNumber,
    tax_number: taxNumber,
    sales_tax_id: salesTaxId,
    payroll_tax_id: payrollTaxId,
    unemployment_tax_id: unemploymentTaxId,
    state_tax_id: stateTaxId,
    tax_provider_key: org.TaxProvider?.OrganizationKey || null,
    tax_provider_name: org.TaxProvider?.Name || null,
    legal_firm_key: org.LegalFirm?.OrganizationKey || null,
    legal_firm_name: org.LegalFirm?.Name || null,
    client_owner_key: org.ClientOwnerKey || null,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    source: org.Source || null,
    referred_by: org.ReferredBy || null,
    business_cards: businessCards.length ? businessCards : null,
    accounting_detail: null,
    assigned_team_members: org.AssignedTeamMembers || null,
    shareholders: org.Shareholders || null,
    directors: org.Directors || null,
    officers: org.Officers || null,
    subsidiaries: org.Subsidiaries || null,
    notes: org.Notes?.Body || null,
    custom_fields: org.CustomFieldValues || null,
    karbon_url: `${KARBON_TENANT_PREFIX}/organizations/${org.OrganizationKey}`,
    karbon_created_at: org.CreatedDateTime || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
