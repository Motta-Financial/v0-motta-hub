/**
 * Comprehensive Karbon -> Supabase Sync Script
 * 
 * Fetches ALL entities from Karbon API and upserts them into Supabase.
 * Runs as a standalone Node.js script with direct API calls.
 * 
 * Sync order (dependency-safe):
 *   1. Team Members (users) - no dependencies
 *   2. Work Statuses - no dependencies  
 *   3. Contacts - no dependencies
 *   4. Organizations - no dependencies
 *   5. Client Groups - depends on contacts/orgs
 *   6. Work Items - depends on contacts/orgs/users
 *   7. Tasks - depends on work items
 *   8. Timesheets - depends on work items/users
 *   9. Invoices - depends on work items/clients
 */

import { createClient } from "@supabase/supabase-js"

const KARBON_BASE_URL = "https://api.karbonhq.com/v3"

const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!KARBON_ACCESS_KEY || !KARBON_BEARER_TOKEN) {
  console.error("Missing KARBON_ACCESS_KEY or KARBON_BEARER_TOKEN")
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ─── Karbon API Helper ───────────────────────────────────────────────────────

async function karbonFetchAll(endpoint, queryParams = "") {
  const allItems = []
  let url = `${KARBON_BASE_URL}${endpoint}${queryParams ? (endpoint.includes("?") ? "&" : "?") + queryParams : ""}`
  let page = 0

  while (url && page < 100) {
    page++
    try {
      const res = await fetch(url, {
        headers: {
          AccessKey: KARBON_ACCESS_KEY,
          Authorization: `Bearer ${KARBON_BEARER_TOKEN}`,
          "Content-Type": "application/json",
        },
      })

      if (!res.ok) {
        if (res.status === 404) break
        console.log(`[v0] API error ${res.status} on ${endpoint}: ${res.statusText}`)
        break
      }

      const data = await res.json()
      const items = data.value || (Array.isArray(data) ? data : [data])
      allItems.push(...items)

      url = data["@odata.nextLink"] || null
      if (page % 5 === 0) console.log(`[v0]   ... page ${page}, ${allItems.length} records so far`)
    } catch (err) {
      console.log(`[v0] Fetch error on page ${page}: ${err}`)
      break
    }
  }
  return allItems
}

// ─── Upsert Helper ───────────────────────────────────────────────────────────

async function upsertBatch(table, data, conflictKey, batchSize = 200) {
  let synced = 0
  let errors = 0

  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize)
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict: conflictKey, ignoreDuplicates: false })

    if (error) {
      console.log(`[v0]   Batch error on ${table} (${i}-${i + batch.length}): ${error.message}`)
      // Try one-by-one to salvage what we can
      for (const row of batch) {
        const { error: singleError } = await supabase
          .from(table)
          .upsert(row, { onConflict: conflictKey, ignoreDuplicates: false })
        if (singleError) {
          errors++
        } else {
          synced++
        }
      }
    } else {
      synced += batch.length
    }
  }
  return { synced, errors }
}

// ─── Entity Mappers ──────────────────────────────────────────────────────────

function mapUser(user: any) {
  const firstName = user.FirstName || ""
  const lastName = user.LastName || ""
  const fullName = user.FullName || `${firstName} ${lastName}`.trim() || user.EmailAddress || "Unknown"
  const userKey = user.UserKey || user.MemberKey

  return {
    karbon_user_key: userKey,
    first_name: firstName || null,
    last_name: lastName || null,
    full_name: fullName,
    email: user.EmailAddress || user.Email || null,
    title: user.Title || user.JobTitle || null,
    role: user.Role || user.UserRole || null,
    department: user.Department || null,
    phone_number: user.PhoneNumber || user.WorkPhone || null,
    mobile_number: user.MobileNumber || user.Mobile || null,
    avatar_url: user.AvatarUrl || user.ProfileImageUrl || null,
    timezone: user.TimeZone || user.Timezone || null,
    start_date: user.StartDate ? user.StartDate.split("T")[0] : null,
    is_active: user.IsActive !== false,
    karbon_url: userKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/team/${userKey}` : null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapWorkStatus(status: any, index: number) {
  const isInactive = status.PrimaryStatusName?.toLowerCase().includes("completed") ||
    status.PrimaryStatusName?.toLowerCase().includes("cancelled")
  const statusName = status.SecondaryStatusName
    ? `${status.PrimaryStatusName} - ${status.SecondaryStatusName}`
    : status.PrimaryStatusName || `Status ${index}`

  return {
    karbon_status_key: status.WorkStatusKey,
    name: statusName,
    description: status.SecondaryStatusName || null,
    status_type: status.PrimaryStatusName || null,
    primary_status_name: status.PrimaryStatusName || null,
    secondary_status_name: status.SecondaryStatusName || null,
    work_type_keys: status.WorkTypeKeys || null,
    display_order: index,
    is_active: !isInactive,
    is_default_filter: !isInactive,
    updated_at: new Date().toISOString(),
  }
}

function mapContact(c: any) {
  const bc = (Array.isArray(c.BusinessCards) ? c.BusinessCards : []).find((x: any) => x.IsPrimaryCard) || (c.BusinessCards || [])[0] || {}
  const acct = c.AccountingDetail || {}
  const addrs = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const pa = addrs.find((a: any) => a.Label === "Physical") || addrs[0] || {}
  const ma = addrs.find((a: any) => a.Label === "Mailing") || {}
  const phones = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const emails = bc.EmailAddresses || []
  const regNums = acct.RegistrationNumbers || {}
  const regArr = Array.isArray(regNums) ? regNums : regNums.Type ? [regNums] : []
  let ein: string | null = null, ssnLast4: string | null = null
  regArr.forEach((r: any) => {
    if (r.Type?.includes("EIN") || r.Type?.includes("Employer")) ein = r.RegistrationNumber
    if (r.Type?.includes("SSN") || r.Type?.includes("Social")) ssnLast4 = r.RegistrationNumber?.slice(-4) || null
  })

  return {
    karbon_contact_key: c.ContactKey,
    first_name: c.FirstName || null,
    last_name: c.LastName || null,
    middle_name: c.MiddleName || null,
    preferred_name: c.PreferredName || null,
    salutation: c.Salutation || null,
    suffix: c.Suffix || null,
    prefix: c.Prefix || null,
    full_name: c.FullName || [c.FirstName, c.MiddleName, c.LastName].filter(Boolean).join(" ") || null,
    contact_type: c.ContactType || "Individual",
    entity_type: acct.EntityType || "Individual",
    status: c.Status || "Active",
    restriction_level: c.RestrictionLevel || null,
    is_prospect: c.ContactType === "Prospect",
    avatar_url: c.AvatarUrl || null,
    primary_email: c.EmailAddress || (Array.isArray(emails) ? emails[0] : emails) || null,
    secondary_email: Array.isArray(emails) && emails.length > 1 ? emails[1] : null,
    phone_primary: c.PhoneNumber || (phones[0]?.Number ? String(phones[0].Number) : null),
    phone_mobile: phones.find((p: any) => p.Label === "Mobile")?.Number ? String(phones.find((p: any) => p.Label === "Mobile").Number) : null,
    phone_work: phones.find((p: any) => p.Label === "Work")?.Number ? String(phones.find((p: any) => p.Label === "Work").Number) : null,
    phone_fax: phones.find((p: any) => p.Label === "Fax")?.Number ? String(phones.find((p: any) => p.Label === "Fax").Number) : null,
    address_line1: pa.AddressLines || pa.Street || null,
    address_line2: pa.AddressLine2 || null,
    city: pa.City || null,
    state: pa.StateProvinceCounty || pa.State || null,
    zip_code: pa.ZipCode || pa.PostalCode || null,
    country: pa.CountryCode || pa.Country || null,
    mailing_address_line1: ma.AddressLines || ma.Street || null,
    mailing_address_line2: ma.AddressLine2 || null,
    mailing_city: ma.City || null,
    mailing_state: ma.StateProvinceCounty || ma.State || null,
    mailing_zip_code: ma.ZipCode || ma.PostalCode || null,
    mailing_country: ma.CountryCode || ma.Country || null,
    date_of_birth: acct.BirthDate ? acct.BirthDate.split("T")[0] : null,
    ein, ssn_last_four: ssnLast4,
    occupation: c.Occupation || acct.Occupation || null,
    employer: c.Employer || null,
    source: c.Source || null,
    referred_by: c.ReferredBy || null,
    linkedin_url: bc.LinkedInLink || null,
    twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    tax_provider_key: acct.TaxProvider?.OrganizationKey || null,
    tax_provider_name: acct.TaxProvider?.Name || null,
    legal_firm_key: acct.LegalFirm?.OrganizationKey || null,
    legal_firm_name: acct.LegalFirm?.Name || null,
    client_owner_key: c.ClientOwnerKey || null,
    client_manager_key: c.ClientManagerKey || null,
    client_partner_key: c.ClientPartnerKey || null,
    user_defined_identifier: c.UserDefinedIdentifier || null,
    registration_numbers: regNums,
    business_cards: Array.isArray(c.BusinessCards) ? c.BusinessCards : [],
    accounting_detail: acct,
    assigned_team_members: c.AssignedTeamMembers || [],
    tags: c.Tags || [],
    notes: acct.Notes?.Body || c.Notes || null,
    custom_fields: c.CustomFields || {},
    contact_preference: c.ContactPreference || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${c.ContactKey}`,
    karbon_contact_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${c.ContactKey}`,
    karbon_created_at: c.CreatedDateTime || null,
    karbon_modified_at: c.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapOrganization(org: any) {
  const bc = (Array.isArray(org.BusinessCards) ? org.BusinessCards : []).find((x: any) => x.IsPrimaryCard) || (org.BusinessCards || [])[0] || {}
  const acct = org.AccountingDetail || {}
  const addrs = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const pa = addrs.find((a: any) => a.Label === "Physical") || addrs[0] || {}
  const phones = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const emails = bc.EmailAddresses || []
  const regNums = acct.RegistrationNumbers || {}
  const regArr = Array.isArray(regNums) ? regNums : regNums.Type ? [regNums] : []
  let ein: string | null = null
  regArr.forEach((r: any) => {
    if (r.Type?.includes("EIN") || r.Type?.includes("Employer")) ein = r.RegistrationNumber
  })

  const entityType = acct.EntityType || (org.ContactType === "Organization" ? "Organization" : org.ContactType || "Organization")

  return {
    karbon_organization_key: org.OrganizationKey,
    name: org.OrganizationName || org.Name || `Organization ${org.OrganizationKey}`,
    full_name: org.FullName || org.OrganizationName || org.Name || null,
    legal_name: org.LegalName || null,
    trading_name: org.TradingName || null,
    description: org.Description || null,
    entity_type: entityType,
    contact_type: org.ContactType || null,
    restriction_level: org.RestrictionLevel || null,
    user_defined_identifier: org.UserDefinedIdentifier || null,
    industry: org.Industry || null,
    line_of_business: org.LineOfBusiness || null,
    primary_email: org.EmailAddress || (Array.isArray(emails) ? emails[0] : emails) || null,
    phone: org.PhoneNumber || (phones[0]?.Number ? String(phones[0].Number) : null),
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    address_line1: pa.AddressLines || pa.Street || null,
    address_line2: pa.AddressLine2 || null,
    city: pa.City || null,
    state: pa.StateProvinceCounty || pa.State || null,
    zip_code: pa.ZipCode || pa.PostalCode || null,
    country: pa.CountryCode || pa.Country || null,
    linkedin_url: bc.LinkedInLink || null,
    twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    ein,
    gst_number: regArr.find((r: any) => r.Type?.includes("GST"))?.RegistrationNumber || null,
    gst_registered: !!regArr.find((r: any) => r.Type?.includes("GST")),
    business_number: regArr.find((r: any) => r.Type?.includes("Business"))?.RegistrationNumber || null,
    tax_number: regArr.find((r: any) => r.Type?.includes("Tax") && !r.Type?.includes("Sales"))?.RegistrationNumber || null,
    fiscal_year_end_month: acct.FiscalYearEndMonth || null,
    fiscal_year_end_day: acct.FiscalYearEndDay || null,
    base_currency: acct.BaseCurrency || null,
    tax_country_code: acct.TaxCountryCode || null,
    pays_tax: acct.PaysTax ?? null,
    is_vat_registered: acct.IsVATRegistered ?? null,
    client_owner_key: org.ClientOwnerKey || null,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    business_cards: Array.isArray(org.BusinessCards) ? org.BusinessCards : [],
    assigned_team_members: org.AssignedTeamMembers || [],
    custom_fields: org.CustomFieldValues || org.CustomFields || {},
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${org.OrganizationKey}`,
    karbon_created_at: org.CreatedDateTime || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapClientGroup(g: any) {
  return {
    karbon_client_group_key: g.ClientGroupKey,
    name: g.FullName || g.Name || `Group ${g.ClientGroupKey}`,
    description: g.EntityDescription || g.Description || null,
    group_type: g.ContactType || g.GroupType || null,
    contact_type: g.ContactType || null,
    primary_contact_key: g.PrimaryContactKey || null,
    primary_contact_name: g.PrimaryContactName || null,
    client_owner_key: g.ClientOwner || null,
    client_owner_name: g.ClientOwnerName || null,
    client_manager_key: g.ClientManager || null,
    client_manager_name: g.ClientManagerName || null,
    members: g.Members || [],
    restriction_level: g.RestrictionLevel || "Public",
    user_defined_identifier: g.UserDefinedIdentifier || null,
    entity_description: g.EntityDescription || null,
    karbon_url: g.ClientGroupKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/${g.ClientGroupKey}` : null,
    karbon_created_at: g.CreatedDate || null,
    karbon_modified_at: g.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function parseTaxYear(item: any): number | null {
  if (item.TaxYear) return item.TaxYear
  if (item.YearEnd) {
    const yr = new Date(item.YearEnd).getFullYear()
    if (yr > 2000 && yr < 2100) return yr
  }
  if (item.Title) {
    const m = item.Title.match(/\b(20\d{2})\b/)
    if (m) return parseInt(m[1], 10)
  }
  return null
}

function mapWorkItem(item: any) {
  const fee = item.FeeSettings || {}
  return {
    karbon_work_item_key: item.WorkItemKey,
    karbon_client_key: item.ClientKey || null,
    client_type: item.ClientType || null,
    client_name: item.ClientName || null,
    client_owner_key: item.ClientOwnerKey || null,
    client_owner_name: item.ClientOwnerName || null,
    client_group_key: item.RelatedClientGroupKey || item.ClientGroupKey || null,
    client_group_name: item.RelatedClientGroupName || null,
    assignee_key: item.AssigneeKey || null,
    assignee_name: item.AssigneeName || null,
    client_manager_key: item.ClientManagerKey || null,
    client_manager_name: item.ClientManagerName || null,
    client_partner_key: item.ClientPartnerKey || null,
    client_partner_name: item.ClientPartnerName || null,
    title: item.Title || null,
    description: item.Description || null,
    work_type: item.WorkType || null,
    workflow_status: item.WorkStatus || null,
    status: item.PrimaryStatus || null,
    status_code: item.SecondaryStatus || null,
    primary_status: item.PrimaryStatus || null,
    secondary_status: item.SecondaryStatus || null,
    work_status_key: item.WorkStatusKey || null,
    user_defined_identifier: item.UserDefinedIdentifier || null,
    start_date: item.StartDate ? item.StartDate.split("T")[0] : null,
    due_date: item.DueDate ? item.DueDate.split("T")[0] : null,
    completed_date: item.CompletedDate ? item.CompletedDate.split("T")[0] : null,
    year_end: item.YearEnd ? item.YearEnd.split("T")[0] : null,
    tax_year: parseTaxYear(item),
    period_start: item.PeriodStart ? item.PeriodStart.split("T")[0] : null,
    period_end: item.PeriodEnd ? item.PeriodEnd.split("T")[0] : null,
    internal_due_date: item.InternalDueDate ? item.InternalDueDate.split("T")[0] : null,
    regulatory_deadline: item.RegulatoryDeadline ? item.RegulatoryDeadline.split("T")[0] : null,
    client_deadline: item.ClientDeadline ? item.ClientDeadline.split("T")[0] : null,
    extension_date: item.ExtensionDate ? item.ExtensionDate.split("T")[0] : null,
    work_template_key: item.WorkTemplateKey || null,
    work_template_name: item.WorkTemplateTitle || item.WorkTemplateTile || null,
    fee_type: fee.FeeType || null,
    estimated_fee: fee.FeeValue || null,
    fixed_fee_amount: fee.FeeType === "Fixed" ? fee.FeeValue : null,
    hourly_rate: fee.FeeType === "Hourly" ? fee.FeeValue : null,
    estimated_minutes: item.EstimatedBudgetMinutes || null,
    actual_minutes: item.ActualBudget || null,
    billable_minutes: item.BillableTime || null,
    budget_minutes: item.Budget?.BudgetedHours ? Math.round(item.Budget.BudgetedHours * 60) : null,
    budget_hours: item.Budget?.BudgetedHours || null,
    budget_amount: item.Budget?.BudgetedAmount || null,
    actual_hours: item.ActualHours || null,
    actual_amount: item.ActualAmount || null,
    actual_fee: item.ActualFee || null,
    todo_count: item.TodoCount || 0,
    completed_todo_count: item.CompletedTodoCount || 0,
    has_blocking_todos: item.HasBlockingTodos || false,
    priority: item.Priority || "Normal",
    tags: item.Tags || [],
    is_recurring: item.IsRecurring ?? false,
    is_billable: item.IsBillable ?? true,
    is_internal: item.IsInternal ?? false,
    notes: item.Notes || null,
    custom_fields: item.CustomFields || {},
    related_work_keys: item.RelatedWorkKeys || [],
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/work/${item.WorkItemKey}`,
    karbon_created_at: item.CreatedDate || item.CreatedDateTime || null,
    karbon_modified_at: item.LastModifiedDateTime || item.ModifiedDate || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapTask(task: any) {
  const taskKey = task.IntegrationTaskKey || task.TaskKey || task.Key
  return {
    karbon_task_key: taskKey,
    task_definition_key: task.TaskDefinitionKey || null,
    title: task.Data?.Title || task.Title || null,
    description: task.Data?.Description || task.Description || null,
    status: task.Status || null,
    priority: task.Data?.Priority || task.Priority || "Normal",
    due_date: task.Data?.DueDate ? task.Data.DueDate.split("T")[0] : (task.DueDate ? task.DueDate.split("T")[0] : null),
    completed_date: task.Data?.CompletedDate ? task.Data.CompletedDate.split("T")[0] : (task.CompletedDate ? task.CompletedDate.split("T")[0] : null),
    assignee_key: task.Data?.AssigneeKey || task.AssigneeKey || null,
    assignee_name: task.Data?.AssigneeName || task.AssigneeName || null,
    assignee_email: task.Data?.AssigneeEmailAddress || task.AssigneeEmailAddress || null,
    karbon_work_item_key: task.WorkItemKey || null,
    karbon_contact_key: task.WorkItemClientKey || task.ContactKey || null,
    is_blocking: task.Data?.IsBlocking || false,
    estimated_minutes: task.Data?.EstimatedMinutes || null,
    actual_minutes: task.Data?.ActualMinutes || null,
    task_data: task.Data || null,
    karbon_url: taskKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/tasks/${taskKey}` : null,
    karbon_created_at: task.CreatedAt || task.CreatedDate || null,
    karbon_modified_at: task.UpdatedAt || task.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapTimesheet(entry: any, parent: any, idx: number) {
  const userKey = entry.UserKey || parent?.UserKey || null
  const userName = entry.UserName || parent?.UserName || null
  const entryDate = entry.Date ? entry.Date.split("T")[0] : "nodate"
  const tsKey = entry.TimeEntryKey || entry.TimesheetKey ||
    `${parent?.TimesheetKey || "ts"}-${entryDate}-${entry.WorkItemKey || "nowi"}-${idx}`

  return {
    karbon_timesheet_key: tsKey,
    date: entry.Date ? entry.Date.split("T")[0] : (parent?.StartDate ? parent.StartDate.split("T")[0] : null),
    minutes: entry.Minutes || 0,
    description: entry.TaskTypeName || entry.Description || null,
    is_billable: entry.IsBillable ?? true,
    billing_status: entry.BillingStatus || parent?.Status || null,
    hourly_rate: entry.HourlyRate || null,
    billed_amount: entry.HourlyRate && entry.Minutes ? ((entry.HourlyRate * entry.Minutes) / 60) : null,
    user_key: userKey,
    user_name: userName,
    karbon_work_item_key: entry.WorkItemKey || null,
    work_item_title: entry.WorkItemTitle || null,
    client_key: entry.ClientKey || null,
    client_name: entry.ClientName || null,
    task_key: entry.TaskTypeKey || entry.TaskKey || null,
    role_name: entry.RoleName || null,
    task_type_name: entry.TaskTypeName || null,
    timesheet_status: parent?.Status || entry.Status || null,
    karbon_url: parent?.TimesheetKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/${parent.TimesheetKey}` : null,
    karbon_created_at: parent?.StartDate || entry.CreatedDate || null,
    karbon_modified_at: parent?.EndDate || entry.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapInvoice(inv: any) {
  return {
    karbon_invoice_key: inv.InvoiceKey || inv.InvoiceNumber,
    invoice_number: inv.InvoiceNumber || null,
    invoice_date: inv.InvoiceDate ? inv.InvoiceDate.split("T")[0] : null,
    due_date: inv.DueDate ? inv.DueDate.split("T")[0] : null,
    status: inv.Status || null,
    total_amount: inv.TotalAmount || inv.Amount || 0,
    tax_amount: inv.TaxAmount || 0,
    subtotal: inv.SubTotal || inv.Subtotal || 0,
    amount_paid: inv.AmountPaid || 0,
    amount_due: inv.AmountDue || (inv.TotalAmount || 0) - (inv.AmountPaid || 0),
    currency: inv.Currency || "USD",
    client_name: inv.ClientName || null,
    client_key: inv.ClientKey || null,
    karbon_work_item_key: inv.WorkItemKey || null,
    work_item_title: inv.WorkItemTitle || null,
    line_items: inv.LineItems || null,
    payment_date: inv.PaymentDate ? inv.PaymentDate.split("T")[0] : null,
    payment_method: inv.PaymentMethod || null,
    notes: inv.Notes || null,
    karbon_url: inv.InvoiceKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/${inv.InvoiceKey}` : null,
    karbon_created_at: inv.CreatedDate || null,
    karbon_modified_at: inv.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

// ─── Main Sync Function ─────────────────────────────────────────────────────

async function main() {
  console.log("=== Comprehensive Karbon -> Supabase Sync ===")
  console.log(`Started at: ${new Date().toISOString()}`)
  console.log("")

  const overallStart = Date.now()
  const results: Record<string, { fetched: number; synced: number; errors: number; duration: string }> = {}

  // Create sync_log entry
  const { data: logEntry } = await supabase
    .from("sync_log")
    .insert({
      sync_type: "full",
      sync_direction: "karbon_to_supabase",
      status: "running",
      is_manual: true,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single()
  const syncLogId = logEntry?.id

  // ─── 1. Team Members ──────────────────────────────────────────────
  console.log("[1/9] Syncing Team Members (Users)...")
  let t = Date.now()
  const users = await karbonFetchAll("/Users")
  console.log(`[v0]   Fetched ${users.length} users from Karbon`)
  if (users.length > 0) {
    const mapped = users.map(mapUser)
    const r = await upsertBatch("team_members", mapped, "karbon_user_key")
    results.users = { fetched: users.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.users = { fetched: 0, synced: 0, errors: 0, duration: "0s" }
  }

  // ─── 2. Work Statuses ─────────────────────────────────────────────
  console.log("\n[2/9] Syncing Work Statuses...")
  t = Date.now()
  const statuses = await karbonFetchAll("/TenantSettings")
  let statusCount = 0
  if (statuses.length > 0) {
    // TenantSettings returns a single object with WorkStatuses array
    const workStatuses = statuses[0]?.WorkStatuses || statuses[0]?.value || []
    const statusArr = Array.isArray(workStatuses) ? workStatuses : []
    if (statusArr.length > 0) {
      const mapped = statusArr.map((s: any, i: number) => mapWorkStatus(s, i))
      const r = await upsertBatch("work_status", mapped, "karbon_status_key")
      statusCount = r.synced
      results.workStatuses = { fetched: statusArr.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
      console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
    }
  }
  if (statusCount === 0) {
    results.workStatuses = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   No work statuses found in TenantSettings`)
  }

  // ─── 3. Contacts ──────────────────────────────────────────────────
  console.log("\n[3/9] Syncing Contacts...")
  t = Date.now()
  const contacts = await karbonFetchAll("/Contacts", "$expand=BusinessCards,AccountingDetail&$count=true&$orderby=FullName asc")
  console.log(`[v0]   Fetched ${contacts.length} contacts from Karbon`)
  if (contacts.length > 0) {
    const mapped = contacts.map(mapContact)
    const r = await upsertBatch("contacts", mapped, "karbon_contact_key")
    results.contacts = { fetched: contacts.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.contacts = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── 4. Organizations ─────────────────────────────────────────────
  console.log("\n[4/9] Syncing Organizations...")
  t = Date.now()
  const orgs = await karbonFetchAll("/Organizations", "$expand=BusinessCards,AccountingDetail&$count=true&$orderby=OrganizationName asc")
  console.log(`[v0]   Fetched ${orgs.length} organizations from Karbon`)
  if (orgs.length > 0) {
    const mapped = orgs.map(mapOrganization)
    const r = await upsertBatch("organizations", mapped, "karbon_organization_key")
    results.organizations = { fetched: orgs.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.organizations = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── 5. Client Groups ─────────────────────────────────────────────
  console.log("\n[5/9] Syncing Client Groups...")
  t = Date.now()
  const groups = await karbonFetchAll("/ClientGroups", "$expand=BusinessCard,ClientTeam&$count=true&$orderby=FullName asc")
  console.log(`[v0]   Fetched ${groups.length} client groups from Karbon`)
  if (groups.length > 0) {
    const mapped = groups.map(mapClientGroup)
    const r = await upsertBatch("client_groups", mapped, "karbon_client_group_key")
    results.clientGroups = { fetched: groups.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.clientGroups = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── 6. Work Items ────────────────────────────────────────────────
  console.log("\n[6/9] Syncing Work Items...")
  t = Date.now()
  const workItems = await karbonFetchAll("/WorkItems", "$count=true&$orderby=Title asc")
  console.log(`[v0]   Fetched ${workItems.length} work items from Karbon`)
  if (workItems.length > 0) {
    const mapped = workItems.map(mapWorkItem)
    const r = await upsertBatch("work_items", mapped, "karbon_work_item_key")
    results.workItems = { fetched: workItems.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.workItems = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── 7. Tasks ─────────────────────────────────────────────────────
  console.log("\n[7/9] Syncing Tasks...")
  t = Date.now()
  const tasks = await karbonFetchAll("/IntegrationTasks", "$count=true")
  console.log(`[v0]   Fetched ${tasks.length} tasks from Karbon`)
  if (tasks.length > 0) {
    const mapped = tasks.map(mapTask)
    const r = await upsertBatch("karbon_tasks", mapped, "karbon_task_key")
    results.tasks = { fetched: tasks.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.tasks = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   No tasks endpoint or no data (this is normal if IntegrationTasks isn't configured)`)
  }

  // ─── 8. Timesheets ────────────────────────────────────────────────
  console.log("\n[8/9] Syncing Timesheets...")
  t = Date.now()
  const weeklyTimesheets = await karbonFetchAll("/Timesheets", "$expand=TimeEntries&$count=true&$orderby=StartDate desc")
  console.log(`[v0]   Fetched ${weeklyTimesheets.length} weekly timesheets from Karbon`)
  const flatEntries: any[] = []
  for (const wts of weeklyTimesheets) {
    if (wts.TimeEntries && Array.isArray(wts.TimeEntries)) {
      wts.TimeEntries.forEach((entry: any, idx: number) => {
        flatEntries.push(mapTimesheet(entry, wts, idx))
      })
    }
  }
  console.log(`[v0]   Flattened to ${flatEntries.length} time entries`)
  if (flatEntries.length > 0) {
    const r = await upsertBatch("karbon_timesheets", flatEntries, "karbon_timesheet_key")
    results.timesheets = { fetched: flatEntries.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.timesheets = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── 9. Invoices ──────────────────────────────────────────────────
  console.log("\n[9/9] Syncing Invoices...")
  t = Date.now()
  const invoices = await karbonFetchAll("/Invoices", "$count=true&$orderby=InvoiceDate desc")
  console.log(`[v0]   Fetched ${invoices.length} invoices from Karbon`)
  if (invoices.length > 0) {
    const mapped = invoices.map(mapInvoice)
    const r = await upsertBatch("karbon_invoices", mapped, "karbon_invoice_key")
    results.invoices = { fetched: invoices.length, ...r, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
    console.log(`[v0]   Synced: ${r.synced}, Errors: ${r.errors}`)
  } else {
    results.invoices = { fetched: 0, synced: 0, errors: 0, duration: `${((Date.now() - t) / 1000).toFixed(1)}s` }
  }

  // ─── Summary ──────────────────────────────────────────────────────
  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(1)
  const totalFetched = Object.values(results).reduce((s, r) => s + r.fetched, 0)
  const totalSynced = Object.values(results).reduce((s, r) => s + r.synced, 0)
  const totalErrors = Object.values(results).reduce((s, r) => s + r.errors, 0)

  console.log("\n=== Sync Complete ===")
  console.log(`Total Duration: ${totalDuration}s`)
  console.log(`Total Fetched: ${totalFetched}`)
  console.log(`Total Synced:  ${totalSynced}`)
  console.log(`Total Errors:  ${totalErrors}`)
  console.log("")
  console.log("Per-entity breakdown:")
  for (const [entity, r] of Object.entries(results)) {
    console.log(`  ${entity.padEnd(15)} Fetched: ${String(r.fetched).padStart(5)} | Synced: ${String(r.synced).padStart(5)} | Errors: ${String(r.errors).padStart(3)} | ${r.duration}`)
  }

  // Update sync_log
  if (syncLogId) {
    await supabase
      .from("sync_log")
      .update({
        status: totalErrors === 0 ? "completed" : "completed_with_errors",
        records_fetched: totalFetched,
        records_created: totalSynced,
        records_failed: totalErrors,
        completed_at: new Date().toISOString(),
        error_message: totalErrors > 0 ? `${totalErrors} records failed` : null,
        error_details: { results },
      })
      .eq("id", syncLogId)
  }

  console.log(`\nSync log ID: ${syncLogId || "N/A"}`)
}

main().catch((err) => {
  console.error("Fatal sync error:", err)
  process.exit(1)
})
