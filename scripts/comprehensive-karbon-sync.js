/**
 * Comprehensive Karbon → Supabase Sync Script
 * 
 * Fetches ALL entities from Karbon API and upserts them into Supabase.
 * Entities synced (in dependency order):
 *   1. Team Members (Users)
 *   2. Contacts
 *   3. Organizations
 *   4. Client Groups
 *   5. Work Statuses
 *   6. Work Items
 *   7. Tasks
 *   8. Timesheets
 *   9. Notes
 *  10. Invoices
 */

const KARBON_BASE_URL = "https://api.karbonhq.com/v3"
const KARBON_ACCESS_KEY = process.env.KARBON_ACCESS_KEY
const KARBON_BEARER_TOKEN = process.env.KARBON_BEARER_TOKEN
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!KARBON_ACCESS_KEY || !KARBON_BEARER_TOKEN) {
  console.error("ERROR: Missing KARBON_ACCESS_KEY or KARBON_BEARER_TOKEN")
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}

// ─── Karbon API Helper ───────────────────────────────────────────────
async function karbonFetch(endpoint) {
  const url = endpoint.startsWith("http") ? endpoint : `${KARBON_BASE_URL}${endpoint}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${KARBON_BEARER_TOKEN}`,
      AccessKey: KARBON_ACCESS_KEY,
      Accept: "application/json",
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Karbon API ${res.status}: ${url} - ${text.substring(0, 200)}`)
  }
  return res.json()
}

async function karbonFetchAll(endpoint, queryParams = "") {
  const allItems = []
  let url = `${KARBON_BASE_URL}${endpoint}${queryParams ? (endpoint.includes("?") ? "&" : "?") + queryParams : ""}`
  let page = 1

  while (url) {
    const data = await karbonFetch(url)
    const items = data.value || data || []
    if (Array.isArray(items)) {
      allItems.push(...items)
    }
    // OData pagination
    url = data["@odata.nextLink"] || data["odata.nextLink"] || null
    if (page % 5 === 0) console.log(`  ... fetched ${allItems.length} items so far (page ${page})`)
    page++
    // Safety valve
    if (page > 500) { console.log("  Safety limit hit at 500 pages"); break }
  }
  return allItems
}

// ─── Supabase REST Helper ────────────────────────────────────────────
async function supabaseUpsert(table, data, conflictKey) {
  if (!data || data.length === 0) return { synced: 0, errors: 0 }
  let synced = 0
  let errors = 0
  const BATCH_SIZE = 100

  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE)
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: `resolution=merge-duplicates,return=minimal`,
      },
      body: JSON.stringify(batch),
    })
    if (res.ok) {
      synced += batch.length
    } else {
      const errText = await res.text().catch(() => "")
      console.error(`  ERROR upserting to ${table} (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${res.status} - ${errText.substring(0, 300)}`)
      errors += batch.length
    }
  }
  return { synced, errors }
}

// ─── Mapper Functions ────────────────────────────────────────────────

function mapUser(user) {
  const firstName = user.FirstName || user.Name?.split(" ")[0] || ""
  const lastName = user.LastName || user.Name?.split(" ").slice(1).join(" ") || ""
  const fullName = user.FullName || [firstName, lastName].filter(Boolean).join(" ") || user.Name || ""
  const userKey = user.UserKey || user.MemberKey
  return {
    karbon_user_key: userKey,
    first_name: firstName || null,
    last_name: lastName || null,
    full_name: fullName || null,
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

function mapContact(contact) {
  const businessCards = Array.isArray(contact.BusinessCards) ? contact.BusinessCards : []
  const bc = businessCards.find(b => b.IsPrimaryCard) || businessCards[0] || {}
  const acct = contact.AccountingDetail || {}
  const addresses = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const primaryAddr = addresses.find(a => a.Label === "Physical") || addresses[0] || {}
  const mailAddr = addresses.find(a => a.Label === "Mailing") || {}
  const phones = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const emails = Array.isArray(bc.EmailAddresses) ? bc.EmailAddresses : bc.EmailAddresses ? [bc.EmailAddresses] : []
  const workPhone = phones.find(p => p.Label === "Work")
  const mobilePhone = phones.find(p => p.Label === "Mobile")
  const faxPhone = phones.find(p => p.Label === "Fax")
  const primaryPhone = phones.find(p => p.Label === "Primary") || phones[0]

  const regNumbers = acct.RegistrationNumbers || {}
  const regArray = Array.isArray(regNumbers) ? regNumbers : regNumbers.Type ? [regNumbers] : []
  let ein = null, ssnLastFour = null
  regArray.forEach(reg => {
    if (reg.Type?.includes("EIN") || reg.Type?.includes("Employer")) ein = reg.RegistrationNumber
    if (reg.Type?.includes("SSN") || reg.Type?.includes("Social Security")) ssnLastFour = reg.RegistrationNumber?.slice(-4) || null
  })

  const firstName = contact.FirstName || null
  const lastName = contact.LastName || null
  const fullName = contact.FullName || [firstName, contact.MiddleName, lastName].filter(Boolean).join(" ") || null

  return {
    karbon_contact_key: contact.ContactKey,
    first_name: firstName,
    last_name: lastName,
    middle_name: contact.MiddleName || null,
    preferred_name: contact.PreferredName || null,
    salutation: contact.Salutation || null,
    suffix: contact.Suffix || null,
    prefix: contact.Prefix || null,
    full_name: fullName,
    contact_type: contact.ContactType || "Individual",
    entity_type: acct.EntityType || "Individual",
    status: contact.Status || "Active",
    restriction_level: contact.RestrictionLevel || null,
    is_prospect: contact.ContactType === "Prospect",
    primary_email: contact.EmailAddress || emails[0] || null,
    secondary_email: emails.length > 1 ? emails[1] : null,
    phone_primary: contact.PhoneNumber || (primaryPhone?.Number ? String(primaryPhone.Number) : null),
    phone_mobile: mobilePhone?.Number ? String(mobilePhone.Number) : null,
    phone_work: workPhone?.Number ? String(workPhone.Number) : null,
    phone_fax: faxPhone?.Number ? String(faxPhone.Number) : null,
    address_line1: primaryAddr.AddressLines || primaryAddr.Street || null,
    address_line2: primaryAddr.AddressLine2 || null,
    city: primaryAddr.City || null,
    state: primaryAddr.StateProvinceCounty || primaryAddr.State || null,
    zip_code: primaryAddr.ZipCode || primaryAddr.PostalCode || null,
    country: primaryAddr.CountryCode || primaryAddr.Country || null,
    mailing_address_line1: mailAddr.AddressLines || mailAddr.Street || null,
    mailing_address_line2: mailAddr.AddressLine2 || null,
    mailing_city: mailAddr.City || null,
    mailing_state: mailAddr.StateProvinceCounty || mailAddr.State || null,
    mailing_zip_code: mailAddr.ZipCode || mailAddr.PostalCode || null,
    mailing_country: mailAddr.CountryCode || mailAddr.Country || null,
    date_of_birth: acct.BirthDate ? acct.BirthDate.split("T")[0] : null,
    ein: ein,
    ssn_last_four: ssnLastFour,
    occupation: contact.Occupation || acct.Occupation || null,
    employer: contact.Employer || null,
    source: contact.Source || null,
    referred_by: contact.ReferredBy || null,
    linkedin_url: bc.LinkedInLink || null,
    twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    client_owner_key: contact.ClientOwnerKey || null,
    client_manager_key: contact.ClientManagerKey || null,
    client_partner_key: contact.ClientPartnerKey || null,
    user_defined_identifier: contact.UserDefinedIdentifier || null,
    registration_numbers: regNumbers,
    business_cards: businessCards,
    accounting_detail: acct,
    assigned_team_members: contact.AssignedTeamMembers || [],
    tags: contact.Tags || [],
    notes: acct.Notes?.Body || contact.Notes || null,
    custom_fields: contact.CustomFields || {},
    contact_preference: contact.ContactPreference || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_contact_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/${contact.ContactKey}`,
    karbon_created_at: contact.CreatedDateTime || null,
    karbon_modified_at: contact.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapOrganization(org) {
  const businessCards = Array.isArray(org.BusinessCards) ? org.BusinessCards : []
  const bc = businessCards.find(b => b.IsPrimaryCard) || businessCards[0] || {}
  const acct = org.AccountingDetail || {}
  const addresses = Array.isArray(bc.Addresses) ? bc.Addresses : bc.Addresses ? [bc.Addresses] : []
  const primaryAddr = addresses[0] || {}
  const phones = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : bc.PhoneNumbers ? [bc.PhoneNumbers] : []
  const emails = Array.isArray(bc.EmailAddresses) ? bc.EmailAddresses : bc.EmailAddresses ? [bc.EmailAddresses] : []

  const entityMap = { B: "Business", P: "Partnership", T: "Trust", C: "Corporation", S: "S-Corp", N: "Non-Profit", I: "Individual", O: "Other" }
  const entityType = entityMap[org.EntityType] || org.EntityType || "Business"

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
    primary_email: org.EmailAddress || emails[0] || null,
    phone: org.PhoneNumber || (phones[0]?.Number ? String(phones[0].Number) : null),
    website: Array.isArray(bc.WebSites) ? bc.WebSites[0] : bc.WebSites || null,
    address_line1: primaryAddr.AddressLines || primaryAddr.Street || null,
    address_line2: primaryAddr.AddressLine2 || null,
    city: primaryAddr.City || null,
    state: primaryAddr.StateProvinceCounty || primaryAddr.State || null,
    zip_code: primaryAddr.ZipCode || primaryAddr.PostalCode || null,
    country: primaryAddr.CountryCode || primaryAddr.Country || null,
    linkedin_url: bc.LinkedInLink || null,
    twitter_handle: bc.TwitterLink || null,
    facebook_url: bc.FacebookLink || null,
    fiscal_year_end_month: acct.FiscalYearEndMonth || null,
    fiscal_year_end_day: acct.FiscalYearEndDay || null,
    base_currency: acct.BaseCurrency || null,
    tax_country_code: acct.TaxCountryCode || null,
    pays_tax: acct.PaysTax ?? null,
    client_owner_key: org.ClientOwnerKey || null,
    client_manager_key: org.ClientManagerKey || null,
    client_partner_key: org.ClientPartnerKey || null,
    parent_organization_key: org.ParentOrganizationKey || null,
    business_cards: businessCards.length > 0 ? businessCards : null,
    assigned_team_members: org.AssignedTeamMembers || null,
    custom_fields: org.CustomFieldValues || null,
    karbon_url: `https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/${org.OrganizationKey}`,
    karbon_created_at: org.CreatedDateTime || null,
    karbon_modified_at: org.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapClientGroup(group) {
  const groupName = group.FullName || group.Name || `Group ${group.ClientGroupKey}`
  return {
    karbon_client_group_key: group.ClientGroupKey,
    name: groupName,
    description: group.EntityDescription || group.Description || null,
    group_type: group.ContactType || group.GroupType || null,
    contact_type: group.ContactType || null,
    primary_contact_key: group.PrimaryContactKey || null,
    primary_contact_name: group.PrimaryContactName || null,
    client_owner_key: group.ClientOwner || null,
    client_owner_name: group.ClientOwnerName || null,
    client_manager_key: group.ClientManager || null,
    client_manager_name: group.ClientManagerName || null,
    members: group.Members || [],
    restriction_level: group.RestrictionLevel || "Public",
    user_defined_identifier: group.UserDefinedIdentifier || null,
    entity_description: group.EntityDescription || null,
    karbon_url: group.ClientGroupKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/client-groups/${group.ClientGroupKey}` : null,
    karbon_created_at: group.CreatedDate || null,
    karbon_modified_at: group.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function parseTaxYear(item) {
  if (item.TaxYear) return item.TaxYear
  if (item.YearEnd) {
    const year = new Date(item.YearEnd).getFullYear()
    if (year > 2000 && year < 2100) return year
  }
  if (item.Title) {
    const match = item.Title.match(/\b(20\d{2})\b/)
    if (match) return parseInt(match[1], 10)
  }
  return null
}

function mapWorkItem(item) {
  const feeSettings = item.FeeSettings || {}
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
    fee_type: feeSettings.FeeType || null,
    estimated_fee: feeSettings.FeeValue || null,
    fixed_fee_amount: feeSettings.FeeType === "Fixed" ? feeSettings.FeeValue : null,
    hourly_rate: feeSettings.FeeType === "Hourly" ? feeSettings.FeeValue : null,
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

function mapTask(task) {
  const taskKey = task.IntegrationTaskKey || task.TaskKey || task.Data?.TaskKey
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

function mapTimesheet(entry, parentTs, entryIndex) {
  const userKey = entry.UserKey || parentTs?.UserKey || null
  const userName = entry.UserName || parentTs?.UserName || null
  const entryDate = entry.Date ? entry.Date.split("T")[0] : "nodate"
  const timesheetKey =
    entry.TimeEntryKey || entry.TimesheetKey ||
    `${parentTs?.TimesheetKey || "ts"}-${entryDate}-${entry.WorkItemKey || "nowi"}-${entryIndex || 0}`
  return {
    karbon_timesheet_key: timesheetKey,
    date: entry.Date ? entry.Date.split("T")[0] : (parentTs?.StartDate ? parentTs.StartDate.split("T")[0] : null),
    minutes: entry.Minutes || 0,
    description: entry.TaskTypeName || entry.Description || null,
    is_billable: entry.IsBillable ?? true,
    billing_status: entry.BillingStatus || parentTs?.Status || null,
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
    timesheet_status: parentTs?.Status || entry.Status || null,
    karbon_url: parentTs?.TimesheetKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/timesheets/${parentTs.TimesheetKey}` : null,
    karbon_created_at: parentTs?.StartDate || entry.CreatedDate || null,
    karbon_modified_at: parentTs?.EndDate || entry.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapNote(note) {
  return {
    karbon_note_key: note.NoteKey,
    subject: note.Subject || null,
    body: note.Body || null,
    note_type: note.NoteType || null,
    is_pinned: note.IsPinned || false,
    author_key: note.AuthorKey || null,
    author_name: note.AuthorName || null,
    assignee_email: note.AssigneeEmailAddress || null,
    due_date: note.DueDate ? note.DueDate.split("T")[0] : null,
    todo_date: note.TodoDate ? note.TodoDate.split("T")[0] : null,
    timelines: note.Timelines || null,
    comments: note.Comments || null,
    karbon_work_item_key: note.WorkItemKey || null,
    work_item_title: note.WorkItemTitle || null,
    karbon_contact_key: note.ContactKey || null,
    contact_name: note.ContactName || null,
    karbon_url: note.NoteKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/notes/${note.NoteKey}` : null,
    karbon_created_at: note.CreatedDate || null,
    karbon_modified_at: note.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapInvoice(invoice) {
  return {
    karbon_invoice_key: invoice.InvoiceKey || invoice.InvoiceNumber,
    invoice_number: invoice.InvoiceNumber || null,
    client_name: invoice.ClientName || null,
    client_key: invoice.ClientKey || null,
    karbon_work_item_key: invoice.WorkItemKey || null,
    work_item_title: invoice.WorkItemTitle || null,
    status: invoice.Status || null,
    invoice_date: invoice.InvoiceDate ? invoice.InvoiceDate.split("T")[0] : null,
    due_date: invoice.DueDate ? invoice.DueDate.split("T")[0] : null,
    paid_date: invoice.PaidDate ? invoice.PaidDate.split("T")[0] : null,
    amount: invoice.TotalAmount || invoice.Amount || null,
    tax_amount: invoice.TaxAmount || null,
    total_amount: invoice.TotalAmount || null,
    outstanding_amount: invoice.OutstandingAmount || null,
    currency: invoice.Currency || "USD",
    line_items: invoice.LineItems || null,
    notes: invoice.Notes || null,
    karbon_url: invoice.InvoiceKey ? `https://app2.karbonhq.com/4mTyp9lLRWTC#/invoices/${invoice.InvoiceKey}` : null,
    karbon_created_at: invoice.CreatedDate || null,
    karbon_modified_at: invoice.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function mapWorkStatus(status, index) {
  const isInactive = (status.PrimaryStatusName || "").toLowerCase().includes("complet") ||
    (status.PrimaryStatusName || "").toLowerCase().includes("cancel")
  const statusName = [status.PrimaryStatusName, status.SecondaryStatusName].filter(Boolean).join(" - ") || `Status ${index}`
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

// ─── Sync Log ────────────────────────────────────────────────────────
async function logSync(entityType, status, recordCount, errorMessage) {
  await supabaseUpsert("sync_log", [{
    entity_type: entityType,
    status: status,
    record_count: recordCount,
    error_message: errorMessage || null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  }], "id")
}

// ─── Main Sync ───────────────────────────────────────────────────────
async function main() {
  console.log("=== COMPREHENSIVE KARBON → SUPABASE SYNC ===")
  console.log(`Started at: ${new Date().toISOString()}\n`)

  const results = {}

  // 1. Team Members
  try {
    console.log("1/10 Syncing Team Members (Users)...")
    const users = await karbonFetchAll("/Users")
    console.log(`  Fetched ${users.length} users from Karbon`)
    const mapped = users.map(mapUser)
    const result = await supabaseUpsert("team_members", mapped, "karbon_user_key")
    results.team_members = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("team_members", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.team_members = { synced: 0, errors: 1 }
    await logSync("team_members", "error", 0, err.message)
  }

  // 2. Contacts
  try {
    console.log("2/10 Syncing Contacts...")
    const contacts = await karbonFetchAll("/Contacts", "$expand=BusinessCards,AccountingDetail")
    console.log(`  Fetched ${contacts.length} contacts from Karbon`)
    const mapped = contacts.map(mapContact)
    const result = await supabaseUpsert("contacts", mapped, "karbon_contact_key")
    results.contacts = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("contacts", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.contacts = { synced: 0, errors: 1 }
    await logSync("contacts", "error", 0, err.message)
  }

  // 3. Organizations
  try {
    console.log("3/10 Syncing Organizations...")
    const orgs = await karbonFetchAll("/Organizations", "$expand=BusinessCards,AccountingDetail")
    console.log(`  Fetched ${orgs.length} organizations from Karbon`)
    const mapped = orgs.map(mapOrganization)
    const result = await supabaseUpsert("organizations", mapped, "karbon_organization_key")
    results.organizations = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("organizations", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.organizations = { synced: 0, errors: 1 }
    await logSync("organizations", "error", 0, err.message)
  }

  // 4. Client Groups
  try {
    console.log("4/10 Syncing Client Groups...")
    const groups = await karbonFetchAll("/ClientGroups", "$expand=BusinessCard,ClientTeam")
    console.log(`  Fetched ${groups.length} client groups from Karbon`)
    const mapped = groups.map(mapClientGroup)
    const result = await supabaseUpsert("client_groups", mapped, "karbon_client_group_key")
    results.client_groups = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("client_groups", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.client_groups = { synced: 0, errors: 1 }
    await logSync("client_groups", "error", 0, err.message)
  }

  // 5. Work Statuses
  try {
    console.log("5/10 Syncing Work Statuses...")
    const settings = await karbonFetch(`${KARBON_BASE_URL}/TenantSettings`)
    const statuses = settings.WorkStatuses || settings.value?.WorkStatuses || []
    console.log(`  Fetched ${statuses.length} work statuses from Karbon`)
    const mapped = statuses.map((s, i) => mapWorkStatus(s, i))
    const result = await supabaseUpsert("work_status", mapped, "karbon_status_key")
    results.work_statuses = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("work_statuses", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.work_statuses = { synced: 0, errors: 1 }
    await logSync("work_statuses", "error", 0, err.message)
  }

  // 6. Work Items
  try {
    console.log("6/10 Syncing Work Items...")
    const items = await karbonFetchAll("/WorkItems", "$expand=FeeSettings,Budget")
    console.log(`  Fetched ${items.length} work items from Karbon`)
    const mapped = items.map(mapWorkItem)
    const result = await supabaseUpsert("work_items", mapped, "karbon_work_item_key")
    results.work_items = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("work_items", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.work_items = { synced: 0, errors: 1 }
    await logSync("work_items", "error", 0, err.message)
  }

  // 7. Tasks (via WorkItems' IntegrationTasks)
  try {
    console.log("7/10 Syncing Tasks...")
    const tasks = await karbonFetchAll("/IntegrationTasks")
    console.log(`  Fetched ${tasks.length} tasks from Karbon`)
    const mapped = tasks.map(mapTask).filter(t => t.karbon_task_key)
    const result = await supabaseUpsert("karbon_tasks", mapped, "karbon_task_key")
    results.tasks = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("tasks", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.tasks = { synced: 0, errors: 1 }
    await logSync("tasks", "error", 0, err.message)
  }

  // 8. Timesheets
  try {
    console.log("8/10 Syncing Timesheets...")
    const weeklyTs = await karbonFetchAll("/Timesheets", "$expand=TimeEntries")
    console.log(`  Fetched ${weeklyTs.length} weekly timesheets from Karbon`)
    // Flatten TimeEntries
    const allEntries = []
    for (const ts of weeklyTs) {
      if (ts.TimeEntries && Array.isArray(ts.TimeEntries)) {
        ts.TimeEntries.forEach((entry, idx) => {
          allEntries.push(mapTimesheet(entry, ts, idx))
        })
      } else {
        allEntries.push(mapTimesheet(ts, null, 0))
      }
    }
    console.log(`  Flattened to ${allEntries.length} time entries`)
    const result = await supabaseUpsert("karbon_timesheets", allEntries.filter(e => e.karbon_timesheet_key), "karbon_timesheet_key")
    results.timesheets = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("timesheets", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.timesheets = { synced: 0, errors: 1 }
    await logSync("timesheets", "error", 0, err.message)
  }

  // 9. Notes
  try {
    console.log("9/10 Syncing Notes...")
    const notes = await karbonFetchAll("/Notes")
    console.log(`  Fetched ${notes.length} notes from Karbon`)
    const mapped = notes.map(mapNote).filter(n => n.karbon_note_key)
    const result = await supabaseUpsert("karbon_notes", mapped, "karbon_note_key")
    results.notes = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("notes", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.notes = { synced: 0, errors: 1 }
    await logSync("notes", "error", 0, err.message)
  }

  // 10. Invoices
  try {
    console.log("10/10 Syncing Invoices...")
    const invoices = await karbonFetchAll("/Invoices")
    console.log(`  Fetched ${invoices.length} invoices from Karbon`)
    const mapped = invoices.map(mapInvoice).filter(i => i.karbon_invoice_key)
    const result = await supabaseUpsert("karbon_invoices", mapped, "karbon_invoice_key")
    results.invoices = result
    console.log(`  Done: ${result.synced} synced, ${result.errors} errors\n`)
    await logSync("invoices", result.errors > 0 ? "partial" : "success", result.synced)
  } catch (err) {
    console.error(`  FAILED: ${err.message}\n`)
    results.invoices = { synced: 0, errors: 1 }
    await logSync("invoices", "error", 0, err.message)
  }

  // Summary
  console.log("=== SYNC COMPLETE ===")
  console.log(`Finished at: ${new Date().toISOString()}\n`)
  console.log("Entity            | Synced | Errors")
  console.log("------------------|--------|-------")
  for (const [entity, result] of Object.entries(results)) {
    console.log(`${entity.padEnd(18)}| ${String(result.synced).padEnd(7)}| ${result.errors}`)
  }
  const totalSynced = Object.values(results).reduce((s, r) => s + r.synced, 0)
  const totalErrors = Object.values(results).reduce((s, r) => s + r.errors, 0)
  console.log(`${"TOTAL".padEnd(18)}| ${String(totalSynced).padEnd(7)}| ${totalErrors}`)
}

main().catch(err => {
  console.error("FATAL:", err)
  process.exit(1)
})
