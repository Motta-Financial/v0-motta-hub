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
