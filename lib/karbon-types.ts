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
  AssignedTo?: Array<{
    UserKey: string
    FullName: string
    Email: string
  }>
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
