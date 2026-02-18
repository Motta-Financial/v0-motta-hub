export interface KarbonWorkItem {
  WorkKey: string
  Title: string
  ServiceLine: string
  WorkStatus: string
  PrimaryStatus: string
  SecondaryStatus?: string
  WorkType: string
  ClientName?: string
  ClientKey?: string
  ClientGroup?: string
  ClientGroupKey?: string
  DueDate?: string
  DeadlineDate?: string
  StartDate?: string
  CompletedDate?: string
  ModifiedDate?: string
  CreatedDate?: string
  AssignedTo?: {
    UserKey: string
    FullName: string
    Email: string
  } | null
  Priority?: string
  Description?: string
  UserRoleAssignments?: Array<{
    UserKey: string
    RoleKey: string
    RoleName?: string
  }>
  FeeSettings?: {
    FeeType?: string
    FeeValue?: number
  }
  Budget?: {
    BudgetedHours?: number
    BudgetedAmount?: number
  }
  Tags?: string[]
  CustomFields?: Record<string, any>
  WorkItemTypeKey?: string
  PermaKey?: string
  EstimatedBudgetMinutes?: number
  EstimatedCompletionDate?: string
}

export interface KarbonWorkItemsResponse {
  workItems: KarbonWorkItem[]
  count: number
  totalCount?: number
}

export interface KarbonClient {
  clientKey: string
  clientName: string
  clientGroup?: string | null
  clientGroupKey?: string | null
  workItemCount: number
  activeWorkItems: number
  completedWorkItems: number
  lastActivity?: string | null
  serviceLinesUsed: string[]
  relatedClients: Array<{
    clientKey: string
    clientName: string
  }>
  isProspect?: boolean
}

export interface KarbonClientDetails {
  client: {
    clientKey: string
    clientName: string
    clientGroup?: string | null
    clientGroupKey?: string | null
  }
  stats: {
    totalWorkItems: number
    activeWorkItems: number
    completedWorkItems: number
    cancelledWorkItems: number
  }
  teamMembers: Array<{
    name: string
    email: string
    userKey: string
  }>
  serviceLinesUsed: string[]
  workItems: KarbonWorkItem[]
  relatedClients: Array<{
    clientKey: string
    clientName: string
    workItemCount: number
  }>
}

/**
 * KarbonTask now represents the real /v3/IntegrationTasks endpoint shape.
 * The old /v3/Tasks endpoint does not exist in Karbon's API.
 */
export interface KarbonTask {
  TaskKey: string
  Title: string
  Description?: string
  Status: string
  DueDate?: string
  CompletedDate?: string
  AssignedTo?: {
    UserKey: string
    FullName: string
    Email?: string
  } | null
  Priority?: string
  WorkItemKey?: string
  ContactKey?: string
  CreatedDate?: string
  ModifiedDate?: string
}

/**
 * Karbon IntegrationTask - the actual API shape from /v3/IntegrationTasks
 */
export interface KarbonIntegrationTask {
  IntegrationTaskKey: string
  TaskDefinitionKey: string
  WorkItemKey: string
  WorkItemClientKey?: string
  Status: string
  CreatedAt: string
  UpdatedAt: string
  Data?: Record<string, any>
}

/**
 * Karbon Invoice - from /v3/Invoices endpoint
 */
export interface KarbonInvoice {
  InvoiceKey: string
  InvoiceNumber?: string
  WorkItemKey?: string
  ClientKey?: string
  ClientName?: string
  Amount?: number
  Tax?: number
  TotalAmount?: number
  Status?: string
  IssuedDate?: string
  DueDate?: string
  PaidDate?: string
  Currency?: string
  LineItems?: Array<{
    Description?: string
    Quantity?: number
    UnitPrice?: number
    Amount?: number
    TaskTypeKey?: string
  }>
  CreatedDate?: string
  ModifiedDate?: string
}

/**
 * Karbon TenantSettings - from /v3/TenantSettings (replaces fictional /WorkStatuses)
 */
export interface KarbonTenantSettings {
  WorkStatuses?: Array<{
    WorkStatusKey: string
    PrimaryStatusName: string
    SecondaryStatusName: string
    WorkTypeKeys?: string[]
  }>
  WorkTypes?: Array<{
    WorkTypeKey: string
    Name: string
    AvailableStatuses?: string[]
  }>
  ContactTypes?: string[]
}

export interface KarbonWorkItemTask {
  TaskKey: string
  WorkItemTaskKey: string
  Title: string
  Description?: string
  Status: string
  IsComplete: boolean
  DueDate?: string
  CompletedDate?: string
  SortOrder: number
  AssignedTo?: {
    UserKey: string
    FullName: string
    Email?: string
  } | null
  EstimatedMinutes?: number
  ActualMinutes?: number
}

export interface KarbonTimesheet {
  TimesheetKey: string
  Date: string
  Minutes: number
  Hours: string
  Description?: string
  IsBillable: boolean
  BillingStatus?: string
  HourlyRate?: number
  BilledAmount?: number
  User?: {
    UserKey: string
    FullName: string
  } | null
  WorkItem?: {
    WorkItemKey: string
    Title: string
  } | null
  Client?: {
    ClientKey: string
    ClientName: string
  } | null
  TaskKey?: string
  CreatedDate?: string
  ModifiedDate?: string
}

export interface KarbonTimesheetSummary {
  totalMinutes: number
  totalHours: string
  billableMinutes: number
  billableHours: string
  nonBillableMinutes: number
  nonBillableHours: string
}

export interface KarbonClientGroup {
  ClientGroupKey: string
  Name: string
  Description?: string
  GroupType?: string
  Members: Array<{
    ContactKey: string
    ContactName: string
    Role?: string
  }>
  PrimaryContact?: {
    ContactKey: string
    Name: string
  } | null
  CreatedDate?: string
  ModifiedDate?: string
}

export interface KarbonNote {
  NoteKey: string
  Subject?: string
  Body: string
  NoteType?: string
  Author?: {
    UserKey: string
    FullName: string
  } | null
  Contact?: {
    ContactKey: string
    Name: string
  } | null
  WorkItem?: {
    WorkItemKey: string
    Title: string
  } | null
  CreatedDate?: string
  ModifiedDate?: string
  IsPinned?: boolean
}

export interface KarbonWorkItemNote extends KarbonNote {
  WorkItemNoteKey: string
}

export interface KarbonContact {
  ContactKey: string
  FirstName?: string
  MiddleName?: string
  LastName?: string
  PreferredName?: string
  Salutation?: string
  Suffix?: string
  ContactType?: string
  UserDefinedIdentifier?: string
  RestrictionLevel?: string
  AvatarUrl?: string
  LastModifiedDateTime?: string
  EntityDescription?: string
  ClientTeam?: Array<{
    MemberKey: string
    MemberType: string
    RoleType: string
  }>
  AccountingDetail?: {
    ContactPermaKey?: string
    BirthDate?: string
    DeathDate?: string
    Sex?: string
    FinancialYearEndDay?: number
    FinancialYearEndMonth?: number
    IncorporationDate?: string
    IncorporationState?: string
    LegalName?: string
    LineOfBusiness?: string
    EntityType?: string
    TaxCountryCode?: string
    TradingName?: string
    AnnualRevenue?: number
    BaseCurrency?: string
    GstBasis?: string
    GstPeriod?: string
    IncomeTaxInstallmentPeriod?: string
    IsVATRegistered?: boolean
    OrganizationValuation?: number
    PaysTax?: boolean
    PrepareGST?: boolean
    ProvisionalTaxBasic?: boolean
    ProvisionalTaxRatio?: number
    RevenueModel?: string
    SalesTaxBasis?: string
    SalesTaxPeriod?: string
    Sells?: string
    RegistrationNumbers?: Array<{
      RegistrationNumber: string
      Type: string
    }>
    Notes?: Array<{
      Body: string
      Type: string
    }>
    Bank?: string
    Benefits?: string
    BillPay?: string
    Expenses?: string
    FileManagement?: string
    LegalFirm?: string
    Payroll?: string
    Revenue?: string
    TaxProvider?: string
  }
  BusinessCards?: Array<{
    BusinessCardKey: string
    IsPrimaryCard: boolean
    WebSites?: string[]
    EmailAddresses?: string[]
    OrganizationKey?: string
    OrganizationName?: string
    RoleOrTitle?: string
    FacebookLink?: string
    LinkedInLink?: string
    TwitterLink?: string
    SkypeLink?: string
    Addresses?: Array<{
      AddressKey?: string
      AddressLines?: string[]
      City?: string
      StateProvinceCounty?: string
      ZipCode?: string
      CountryCode?: string
      Label?: string
    }>
  }>
  CustomFields?: Record<string, any>
}

export interface KarbonUser {
  userKey: string
  fullName: string
  firstName?: string
  lastName?: string
  email: string
  title?: string
  department?: string
  isActive: boolean
  avatarUrl?: string
  phoneNumber?: string
  mobileNumber?: string
  officeLocation?: string
  startDate?: string
  role?: string
  permissions?: string[]
  lastLoginDate?: string
  teams?: Array<{
    teamKey: string
    teamName: string
    role?: string
  }>
  manager?: string
  employeeId?: string
  timezone?: string
  language?: string
  bio?: string
  skills?: string[]
  certifications?: string[]
}

export interface KarbonTasksResponse {
  tasks: KarbonTask[]
  count: number
  totalCount?: number
}

export interface KarbonTimesheetsResponse {
  timesheets: KarbonTimesheet[]
  count: number
  totalCount?: number
  summary: KarbonTimesheetSummary
}

export interface KarbonClientGroupsResponse {
  clientGroups: KarbonClientGroup[]
  count: number
  totalCount?: number
}

export interface KarbonNotesResponse {
  notes: KarbonNote[]
  count: number
  totalCount?: number
}
