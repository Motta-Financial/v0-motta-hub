/**
 * Pure mapper: Karbon WorkItem JSON -> Supabase work_items row.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

function parseTaxYear(item: any): number | null {
  if (item.TaxYear) return item.TaxYear
  if (item.YearEnd) {
    const year = new Date(item.YearEnd).getFullYear()
    if (year > 2000 && year < 2100) return year
  }
  if (item.Title) {
    const match = String(item.Title).match(/\b(20\d{2})\b/)
    if (match) return parseInt(match[1], 10)
  }
  return null
}

export function mapKarbonWorkItemToSupabase(item: any) {
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
    start_date: item.StartDate ? String(item.StartDate).split("T")[0] : null,
    due_date: item.DueDate ? String(item.DueDate).split("T")[0] : null,
    completed_date: item.CompletedDate ? String(item.CompletedDate).split("T")[0] : null,
    year_end: item.YearEnd ? String(item.YearEnd).split("T")[0] : null,
    tax_year: parseTaxYear(item),
    period_start: item.PeriodStart ? String(item.PeriodStart).split("T")[0] : null,
    period_end: item.PeriodEnd ? String(item.PeriodEnd).split("T")[0] : null,
    internal_due_date: item.InternalDueDate ? String(item.InternalDueDate).split("T")[0] : null,
    regulatory_deadline: item.RegulatoryDeadline ? String(item.RegulatoryDeadline).split("T")[0] : null,
    client_deadline: item.ClientDeadline ? String(item.ClientDeadline).split("T")[0] : null,
    extension_date: item.ExtensionDate ? String(item.ExtensionDate).split("T")[0] : null,
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
    karbon_url: `${KARBON_TENANT_PREFIX}/work/${item.WorkItemKey}`,
    karbon_created_at: item.CreatedDate || item.CreatedDateTime || null,
    karbon_modified_at: item.LastModifiedDateTime || item.ModifiedDate || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
