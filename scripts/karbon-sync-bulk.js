/**
 * Karbon -> Supabase Sync: All Bulk Entities
 * 
 * Fixed for actual Karbon API response shapes:
 *   - Users: {Id, Name, EmailAddress} (not UserKey/FirstName/LastName)
 *   - Contacts: {ContactKey, FullName, ...} (no $expand in list)
 *   - Organizations: {OrganizationKey, OrganizationName, ...}
 *   - etc.
 */

const BASE = "https://api.karbonhq.com/v3"
const AK = process.env.KARBON_ACCESS_KEY
const BT = process.env.KARBON_BEARER_TOKEN
const SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!AK || !BT || !SB_URL || !SB_KEY) { console.error("Missing env vars"); process.exit(1) }

async function kFetch(url) {
  const u = url.startsWith("http") ? url : `${BASE}${url}`
  const r = await fetch(u, { headers: { Authorization: `Bearer ${BT}`, AccessKey: AK, Accept: "application/json" } })
  if (!r.ok) { const t = await r.text().catch(()=>""); throw new Error(`${r.status} ${u.substring(0,80)}: ${t.substring(0,200)}`) }
  return r.json()
}

async function kFetchAll(endpoint) {
  const all = []
  let url = `${BASE}${endpoint}`, pg = 1
  while (url) {
    const d = await kFetch(url)
    const items = d.value || d || []
    if (Array.isArray(items)) all.push(...items)
    url = d["@odata.nextLink"] || d["odata.nextLink"] || null
    if (pg % 5 === 0) console.log(`  ... ${all.length} items (page ${pg})`)
    pg++
    if (pg > 500) break
  }
  return all
}

async function sbUpsert(table, data) {
  if (!data || !data.length) return { synced: 0, errors: 0 }
  let synced = 0, errors = 0
  for (let i = 0; i < data.length; i += 50) {
    const batch = data.slice(i, i + 50)
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    })
    if (r.ok) { synced += batch.length }
    else {
      const t = await r.text().catch(()=>"")
      console.error(`  ERR ${table} batch ${Math.floor(i/50)+1}: ${r.status} ${t.substring(0,400)}`)
      errors += batch.length
    }
  }
  return { synced, errors }
}

// ── User mapper (Karbon Users have: Id, Name, EmailAddress) ──
function mapUser(u) {
  const key = u.UserKey || u.MemberKey || u.Id
  const parts = (u.Name || "").split(" ")
  const fn = u.FirstName || parts[0] || ""
  const ln = u.LastName || parts.slice(1).join(" ") || ""
  return {
    karbon_user_key: key,
    first_name: fn || null,
    last_name: ln || null,
    full_name: u.FullName || u.Name || [fn, ln].filter(Boolean).join(" ") || null,
    email: u.EmailAddress || u.Email || null,
    title: u.Title || u.JobTitle || null,
    role: u.Role || u.UserRole || null,
    department: u.Department || null,
    phone_number: u.PhoneNumber || null,
    mobile_number: u.MobileNumber || null,
    avatar_url: u.AvatarUrl || null,
    timezone: u.TimeZone || null,
    start_date: u.StartDate ? u.StartDate.split("T")[0] : null,
    is_active: u.IsActive !== false,
    karbon_url: key ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/team/${key}` : null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapContact(c) {
  const bcs = Array.isArray(c.BusinessCards) ? c.BusinessCards : []
  const bc = bcs.find(b => b.IsPrimaryCard) || bcs[0] || {}
  const acct = c.AccountingDetail || {}
  const addrs = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const addr = addrs.find(a => a.Label === "Physical") || addrs[0] || {}
  const mail = addrs.find(a => a.Label === "Mailing") || {}
  const phs = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const ems = Array.isArray(bc.EmailAddresses) ? bc.EmailAddresses : bc.EmailAddresses ? [bc.EmailAddresses] : []
  const fn = c.FirstName || null, ln = c.LastName || null
  const full = c.FullName || [fn, c.MiddleName, ln].filter(Boolean).join(" ") || null
  const findPh = (label) => { const p = phs.find(x => x.Label === label); return p?.Number ? String(p.Number) : null }
  return {
    karbon_contact_key: c.ContactKey,
    first_name: fn, last_name: ln, middle_name: c.MiddleName || null,
    preferred_name: c.PreferredName || null, salutation: c.Salutation || null,
    suffix: c.Suffix || null, prefix: c.Prefix || null, full_name: full,
    contact_type: c.ContactType || "Individual", entity_type: acct.EntityType || "Individual",
    status: c.Status || "Active", restriction_level: c.RestrictionLevel || null,
    is_prospect: c.ContactType === "Prospect",
    primary_email: c.EmailAddress || ems[0] || null,
    secondary_email: ems.length > 1 ? ems[1] : null,
    phone_primary: c.PhoneNumber || (phs[0]?.Number ? String(phs[0].Number) : null),
    phone_mobile: findPh("Mobile"), phone_work: findPh("Work"), phone_fax: findPh("Fax"),
    address_line1: addr.AddressLines || addr.Street || null, address_line2: addr.AddressLine2 || null,
    city: addr.City || null, state: addr.StateProvinceCounty || addr.State || null,
    zip_code: addr.ZipCode || addr.PostalCode || null, country: addr.CountryCode || addr.Country || null,
    mailing_address_line1: mail.AddressLines || mail.Street || null,
    mailing_address_line2: mail.AddressLine2 || null, mailing_city: mail.City || null,
    mailing_state: mail.StateProvinceCounty || mail.State || null,
    mailing_zip_code: mail.ZipCode || mail.PostalCode || null,
    mailing_country: mail.CountryCode || mail.Country || null,
    date_of_birth: acct.BirthDate ? acct.BirthDate.split("T")[0] : null,
    occupation: c.Occupation || acct.Occupation || null, employer: c.Employer || null,
    source: c.Source || null, referred_by: c.ReferredBy || null,
    linkedin_url: bc.LinkedInLink || null, twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    client_owner_key: c.ClientOwnerKey || null, client_manager_key: c.ClientManagerKey || null,
    client_partner_key: c.ClientPartnerKey || null, user_defined_identifier: c.UserDefinedIdentifier || null,
    business_cards: bcs.length > 0 ? bcs : null,
    accounting_detail: Object.keys(acct).length > 0 ? acct : null,
    assigned_team_members: c.AssignedTeamMembers || [], tags: c.Tags || [],
    notes: acct.Notes?.Body || c.Notes || null, custom_fields: c.CustomFields || {},
    contact_preference: c.ContactPreference || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${c.ContactKey}`,
    karbon_contact_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${c.ContactKey}`,
    karbon_created_at: c.CreatedDateTime || null, karbon_modified_at: c.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

function mapOrg(o) {
  const bcs = Array.isArray(o.BusinessCards) ? o.BusinessCards : []
  const bc = bcs.find(b => b.IsPrimaryCard) || bcs[0] || {}
  const acct = o.AccountingDetail || {}
  const addrs = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const addr = addrs[0] || {}
  const phs = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const ems = Array.isArray(bc.EmailAddresses) ? bc.EmailAddresses : bc.EmailAddresses ? [bc.EmailAddresses] : []
  const etMap = {B:"Business",P:"Partnership",T:"Trust",C:"Corporation",S:"S-Corp",N:"Non-Profit",I:"Individual",O:"Other"}
  return {
    karbon_organization_key: o.OrganizationKey,
    name: o.OrganizationName || o.Name || `Org ${o.OrganizationKey}`,
    full_name: o.FullName || o.OrganizationName || o.Name || null,
    legal_name: o.LegalName || null, trading_name: o.TradingName || null,
    description: o.Description || null, entity_type: etMap[o.EntityType] || o.EntityType || "Business",
    contact_type: o.ContactType || null, restriction_level: o.RestrictionLevel || null,
    user_defined_identifier: o.UserDefinedIdentifier || null,
    industry: o.Industry || null, line_of_business: o.LineOfBusiness || null,
    primary_email: o.EmailAddress || ems[0] || null,
    phone: o.PhoneNumber || (phs[0]?.Number ? String(phs[0].Number) : null),
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    address_line1: addr.AddressLines || addr.Street || null, address_line2: addr.AddressLine2 || null,
    city: addr.City || null, state: addr.StateProvinceCounty || addr.State || null,
    zip_code: addr.ZipCode || addr.PostalCode || null, country: addr.CountryCode || addr.Country || null,
    linkedin_url: bc.LinkedInLink || null, twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    fiscal_year_end_month: acct.FiscalYearEndMonth || null, fiscal_year_end_day: acct.FiscalYearEndDay || null,
    base_currency: acct.BaseCurrency || null, tax_country_code: acct.TaxCountryCode || null,
    pays_tax: acct.PaysTax ?? null,
    client_owner_key: o.ClientOwnerKey || null, client_manager_key: o.ClientManagerKey || null,
    client_partner_key: o.ClientPartnerKey || null, parent_organization_key: o.ParentOrganizationKey || null,
    business_cards: bcs.length > 0 ? bcs : null,
    assigned_team_members: o.AssignedTeamMembers || null, custom_fields: o.CustomFieldValues || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${o.OrganizationKey}`,
    karbon_created_at: o.CreatedDateTime || null, karbon_modified_at: o.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

function mapGroup(g) {
  return {
    karbon_client_group_key: g.ClientGroupKey,
    name: g.FullName || g.Name || `Group ${g.ClientGroupKey}`,
    description: g.EntityDescription || g.Description || null,
    group_type: g.ContactType || g.GroupType || null, contact_type: g.ContactType || null,
    primary_contact_key: g.PrimaryContactKey || null, primary_contact_name: g.PrimaryContactName || null,
    client_owner_key: g.ClientOwner || null, client_owner_name: g.ClientOwnerName || null,
    client_manager_key: g.ClientManager || null, client_manager_name: g.ClientManagerName || null,
    members: g.Members || [], restriction_level: g.RestrictionLevel || "Public",
    user_defined_identifier: g.UserDefinedIdentifier || null, entity_description: g.EntityDescription || null,
    karbon_url: g.ClientGroupKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/${g.ClientGroupKey}` : null,
    karbon_created_at: g.CreatedDate || null, karbon_modified_at: g.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

function mapStatus(s, i) {
  const inactive = (s.PrimaryStatusName||"").toLowerCase().includes("complet") || (s.PrimaryStatusName||"").toLowerCase().includes("cancel")
  return {
    karbon_status_key: s.WorkStatusKey,
    name: [s.PrimaryStatusName, s.SecondaryStatusName].filter(Boolean).join(" - ") || `Status ${i}`,
    description: s.SecondaryStatusName || null, status_type: s.PrimaryStatusName || null,
    primary_status_name: s.PrimaryStatusName || null, secondary_status_name: s.SecondaryStatusName || null,
    work_type_keys: s.WorkTypeKeys || null, display_order: i,
    is_active: !inactive, is_default_filter: !inactive, updated_at: new Date().toISOString(),
  }
}

function parseTaxYear(w) {
  if (w.TaxYear) return w.TaxYear
  if (w.YearEnd) { const y = new Date(w.YearEnd).getFullYear(); if (y>2000&&y<2100) return y }
  if (w.Title) { const m = w.Title.match(/\b(20\d{2})\b/); if (m) return parseInt(m[1],10) }
  return null
}

function mapWorkItem(w) {
  const f = w.FeeSettings || {}
  return {
    karbon_work_item_key: w.WorkItemKey, karbon_client_key: w.ClientKey || null,
    client_type: w.ClientType || null, client_name: w.ClientName || null,
    client_owner_key: w.ClientOwnerKey || null, client_owner_name: w.ClientOwnerName || null,
    client_group_key: w.RelatedClientGroupKey || w.ClientGroupKey || null,
    client_group_name: w.RelatedClientGroupName || null,
    assignee_key: w.AssigneeKey || null, assignee_name: w.AssigneeName || null,
    client_manager_key: w.ClientManagerKey || null, client_manager_name: w.ClientManagerName || null,
    client_partner_key: w.ClientPartnerKey || null, client_partner_name: w.ClientPartnerName || null,
    title: w.Title || null, description: w.Description || null, work_type: w.WorkType || null,
    workflow_status: w.WorkStatus || null, status: w.PrimaryStatus || null,
    status_code: w.SecondaryStatus || null, primary_status: w.PrimaryStatus || null,
    secondary_status: w.SecondaryStatus || null, work_status_key: w.WorkStatusKey || null,
    user_defined_identifier: w.UserDefinedIdentifier || null,
    start_date: w.StartDate ? w.StartDate.split("T")[0] : null,
    due_date: w.DueDate ? w.DueDate.split("T")[0] : null,
    completed_date: w.CompletedDate ? w.CompletedDate.split("T")[0] : null,
    year_end: w.YearEnd ? w.YearEnd.split("T")[0] : null, tax_year: parseTaxYear(w),
    period_start: w.PeriodStart ? w.PeriodStart.split("T")[0] : null,
    period_end: w.PeriodEnd ? w.PeriodEnd.split("T")[0] : null,
    internal_due_date: w.InternalDueDate ? w.InternalDueDate.split("T")[0] : null,
    regulatory_deadline: w.RegulatoryDeadline ? w.RegulatoryDeadline.split("T")[0] : null,
    client_deadline: w.ClientDeadline ? w.ClientDeadline.split("T")[0] : null,
    extension_date: w.ExtensionDate ? w.ExtensionDate.split("T")[0] : null,
    work_template_key: w.WorkTemplateKey || null,
    work_template_name: w.WorkTemplateTitle || w.WorkTemplateTile || null,
    fee_type: f.FeeType || null, estimated_fee: f.FeeValue || null,
    fixed_fee_amount: f.FeeType==="Fixed" ? f.FeeValue : null,
    hourly_rate: f.FeeType==="Hourly" ? f.FeeValue : null,
    estimated_minutes: w.EstimatedBudgetMinutes || null, actual_minutes: w.ActualBudget || null,
    billable_minutes: w.BillableTime || null,
    budget_minutes: w.Budget?.BudgetedHours ? Math.round(w.Budget.BudgetedHours*60) : null,
    budget_hours: w.Budget?.BudgetedHours || null, budget_amount: w.Budget?.BudgetedAmount || null,
    actual_hours: w.ActualHours || null, actual_amount: w.ActualAmount || null, actual_fee: w.ActualFee || null,
    todo_count: w.TodoCount || 0, completed_todo_count: w.CompletedTodoCount || 0,
    has_blocking_todos: w.HasBlockingTodos || false,
    priority: w.Priority || "Normal", tags: w.Tags || [],
    is_recurring: w.IsRecurring ?? false, is_billable: w.IsBillable ?? true, is_internal: w.IsInternal ?? false,
    notes: w.Notes || null, custom_fields: w.CustomFields || {}, related_work_keys: w.RelatedWorkKeys || [],
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/work/${w.WorkItemKey}`,
    karbon_created_at: w.CreatedDate || w.CreatedDateTime || null,
    karbon_modified_at: w.LastModifiedDateTime || w.ModifiedDate || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

function mapTimesheet(e, ts, idx) {
  const k = e.TimeEntryKey || e.TimesheetKey || `${ts?.TimesheetKey||"ts"}-${e.Date?e.Date.split("T")[0]:"nd"}-${e.WorkItemKey||"nw"}-${idx||0}`
  return {
    karbon_timesheet_key: k,
    date: e.Date ? e.Date.split("T")[0] : (ts?.StartDate ? ts.StartDate.split("T")[0] : null),
    minutes: e.Minutes || 0, description: e.TaskTypeName || e.Description || null,
    is_billable: e.IsBillable ?? true, billing_status: e.BillingStatus || ts?.Status || null,
    hourly_rate: e.HourlyRate || null,
    billed_amount: e.HourlyRate && e.Minutes ? ((e.HourlyRate*e.Minutes)/60) : null,
    user_key: e.UserKey || ts?.UserKey || null, user_name: e.UserName || ts?.UserName || null,
    karbon_work_item_key: e.WorkItemKey || null, work_item_title: e.WorkItemTitle || null,
    client_key: e.ClientKey || null, client_name: e.ClientName || null,
    task_key: e.TaskTypeKey || e.TaskKey || null, role_name: e.RoleName || null,
    task_type_name: e.TaskTypeName || null, timesheet_status: ts?.Status || e.Status || null,
    karbon_url: ts?.TimesheetKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/${ts.TimesheetKey}` : null,
    karbon_created_at: ts?.StartDate || e.CreatedDate || null,
    karbon_modified_at: ts?.EndDate || e.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

function mapInvoice(inv) {
  return {
    karbon_invoice_key: inv.InvoiceKey || inv.InvoiceNumber,
    invoice_number: inv.InvoiceNumber || null, client_name: inv.ClientName || null,
    client_key: inv.ClientKey || null, karbon_work_item_key: inv.WorkItemKey || null,
    work_item_title: inv.WorkItemTitle || null, status: inv.Status || null,
    issued_date: inv.InvoiceDate ? inv.InvoiceDate.split("T")[0] : null,
    due_date: inv.DueDate ? inv.DueDate.split("T")[0] : null,
    paid_date: inv.PaidDate ? inv.PaidDate.split("T")[0] : null,
    amount: inv.Amount || inv.SubTotal || null, tax: inv.TaxAmount || inv.Tax || null,
    total_amount: inv.TotalAmount || null, currency: inv.Currency || "USD",
    line_items: inv.LineItems || null,
    karbon_url: inv.InvoiceKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/${inv.InvoiceKey}` : null,
    karbon_created_at: inv.CreatedDate || null, karbon_modified_at: inv.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
}

// ── Main ──
async function main() {
  console.log("=== KARBON -> SUPABASE COMPREHENSIVE SYNC ===")
  console.log(`Started: ${new Date().toISOString()}\n`)
  const R = {}

  // 1. Users - dedupe by key AND email
  try {
    console.log("1/8 Users...")
    const raw = await kFetchAll("/Users")
    console.log(`  Fetched ${raw.length} users. Sample keys: ${raw.length > 0 ? Object.keys(raw[0]).join(",") : "none"}`)
    const seenKeys = new Set(), seenEmails = new Set()
    const deduped = raw.filter(u => {
      const k = u.UserKey || u.MemberKey || u.Id
      const e = (u.EmailAddress || u.Email || "").toLowerCase()
      if (!k || seenKeys.has(k) || (e && seenEmails.has(e))) return false
      seenKeys.add(k); if (e) seenEmails.add(e)
      return true
    })
    console.log(`  Deduped to ${deduped.length} unique users`)
    R.users = await sbUpsert("team_members", deduped.map(mapUser))
    console.log(`  OK: ${R.users.synced} synced, ${R.users.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.users = {synced:0,errors:1} }

  // 2. Contacts
  try {
    console.log("2/8 Contacts...")
    const raw = await kFetchAll("/Contacts")
    console.log(`  Fetched ${raw.length} contacts`)
    R.contacts = await sbUpsert("contacts", raw.map(mapContact))
    console.log(`  OK: ${R.contacts.synced} synced, ${R.contacts.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.contacts = {synced:0,errors:1} }

  // 3. Organizations
  try {
    console.log("3/8 Organizations...")
    const raw = await kFetchAll("/Organizations")
    console.log(`  Fetched ${raw.length} orgs`)
    R.orgs = await sbUpsert("organizations", raw.map(mapOrg))
    console.log(`  OK: ${R.orgs.synced} synced, ${R.orgs.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.orgs = {synced:0,errors:1} }

  // 4. Client Groups
  try {
    console.log("4/8 Client Groups...")
    const raw = await kFetchAll("/ClientGroups")
    console.log(`  Fetched ${raw.length} groups`)
    R.groups = await sbUpsert("client_groups", raw.map(mapGroup))
    console.log(`  OK: ${R.groups.synced} synced, ${R.groups.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.groups = {synced:0,errors:1} }

  // 5. Work Statuses
  try {
    console.log("5/8 Work Statuses...")
    let statuses = []
    try {
      const d = await kFetch(`${BASE}/WorkStatuses`)
      statuses = (d.value || d || []).filter(s => s.WorkStatusKey)
    } catch(e1) {
      console.log(`  /WorkStatuses failed (${e1.message}), trying /TenantSettings...`)
      try {
        const d = await kFetch(`${BASE}/TenantSettings`)
        statuses = (d.WorkStatuses || []).filter(s => s.WorkStatusKey)
      } catch(e2) { console.log(`  TenantSettings also failed: ${e2.message}`) }
    }
    console.log(`  ${statuses.length} valid statuses`)
    R.statuses = statuses.length > 0 ? await sbUpsert("work_status", statuses.map((s,i)=>mapStatus(s,i))) : {synced:0,errors:0}
    console.log(`  OK: ${R.statuses.synced} synced, ${R.statuses.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.statuses = {synced:0,errors:1} }

  // 6. Work Items
  try {
    console.log("6/8 Work Items...")
    const raw = await kFetchAll("/WorkItems")
    console.log(`  Fetched ${raw.length} work items`)
    R.workItems = await sbUpsert("work_items", raw.map(mapWorkItem))
    console.log(`  OK: ${R.workItems.synced} synced, ${R.workItems.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.workItems = {synced:0,errors:1} }

  // 7. Timesheets
  try {
    console.log("7/8 Timesheets...")
    const raw = await kFetchAll("/Timesheets")
    console.log(`  Fetched ${raw.length} weekly timesheets`)
    const entries = []
    for (const ts of raw) {
      if (ts.TimeEntries && Array.isArray(ts.TimeEntries)) {
        ts.TimeEntries.forEach((e,i) => entries.push(mapTimesheet(e, ts, i)))
      } else { entries.push(mapTimesheet(ts, null, 0)) }
    }
    console.log(`  Flattened to ${entries.length} entries`)
    R.timesheets = await sbUpsert("karbon_timesheets", entries.filter(e => e.karbon_timesheet_key))
    console.log(`  OK: ${R.timesheets.synced} synced, ${R.timesheets.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.timesheets = {synced:0,errors:1} }

  // 8. Invoices
  try {
    console.log("8/8 Invoices...")
    const raw = await kFetchAll("/Invoices")
    console.log(`  Fetched ${raw.length} invoices`)
    R.invoices = await sbUpsert("karbon_invoices", raw.map(mapInvoice).filter(i => i.karbon_invoice_key))
    console.log(`  OK: ${R.invoices.synced} synced, ${R.invoices.errors} errors\n`)
  } catch(e) { console.error(`  FAIL: ${e.message}\n`); R.invoices = {synced:0,errors:1} }

  // Summary
  console.log("=== SYNC COMPLETE ===")
  console.log(`Finished: ${new Date().toISOString()}\n`)
  console.log("Entity            | Synced | Errors")
  console.log("------------------|--------|-------")
  for (const [k,v] of Object.entries(R)) console.log(`${k.padEnd(18)}| ${String(v.synced).padEnd(7)}| ${v.errors}`)
  const ts = Object.values(R).reduce((s,r)=>s+r.synced,0)
  const te = Object.values(R).reduce((s,r)=>s+r.errors,0)
  console.log(`${"TOTAL".padEnd(18)}| ${String(ts).padEnd(7)}| ${te}`)
}

main().catch(e => { console.error("FATAL:", e); process.exit(1) })
