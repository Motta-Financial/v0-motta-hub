export interface FilterView {
  id: string
  name: string
  type: "clients" | "workItems" | "teammates"
  filters: {
    searchQuery?: string
    serviceLines?: string[]
    fiscalYear?: string
    status?: string
    assignedTo?: string
    showAssignedToMe?: boolean
    clientType?: "active" | "prospects" | "all"
    dateRange?: {
      start?: string
      end?: string
    }
    priority?: string[]
    workType?: string[]
    clientGroup?: string[]
    userStatus?: "all" | "active" | "inactive"
    department?: string
    officeLocation?: string
    teams?: string[]
  }
  isShared: boolean
  createdBy: string
  createdAt: string
  lastModified: string
}

export interface ViewsResponse {
  views: FilterView[]
}
