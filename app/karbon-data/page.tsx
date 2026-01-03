"use client"

import { useState } from "react"
import { DashboardLayout } from "@/components/dashboard-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Loader2,
  Database,
  FileText,
  Users,
  Building2,
  Upload,
  CheckCircle2,
  AlertCircle,
  Briefcase,
  RefreshCw,
  Link2,
  Clock,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface ImportResult {
  success?: boolean
  synced?: number
  errors?: number
  errorDetails?: string[]
  error?: string
  incrementalSync?: boolean
  lastSyncTimestamp?: string | null
}

interface LinkResult {
  linked?: number
  errors?: number
}

interface WorkItemsAnalysis {
  totalWorkItems: number
  uniqueWorkTypes: string[]
  workTypeBreakdown: Record<string, number>
  uniquePrimaryStatuses: string[]
  statusBreakdown: Record<string, number>
  uniqueSecondaryStatuses: string[]
  uniqueWorkStatuses: string[]
  uniqueAssignees: string[]
  uniqueClients: string[]
  totalUniqueClients: number
  uniqueClientGroups: string[]
  totalUniqueClientGroups: number
  sampleRawItems: any[]
}

interface ContactsAnalysis {
  totalContacts: number
  uniqueContactTypes: string[]
  contactTypeBreakdown: Record<string, number>
  uniqueStatuses: string[]
  uniqueCountries: string[]
  uniqueStates: string[]
  sampleRawItems: any[]
}

interface OrganizationsAnalysis {
  totalOrganizations: number
  uniqueEntityTypes: string[]
  entityTypeBreakdown: Record<string, number>
  uniqueIndustries: string[]
  industryBreakdown: Record<string, number>
  uniqueCountries: string[]
  uniqueStates: string[]
  sampleRawItems: any[]
}

export default function KarbonDataPage() {
  const [activeTab, setActiveTab] = useState("work-items")

  // Work Items state
  const [workItemsLoading, setWorkItemsLoading] = useState(false)
  const [workItemsAnalysis, setWorkItemsAnalysis] = useState<WorkItemsAnalysis | null>(null)
  const [workItemsError, setWorkItemsError] = useState<string | null>(null)
  const [workItemsImportResult, setWorkItemsImportResult] = useState<ImportResult | null>(null)
  const [workItemsLinkResult, setWorkItemsLinkResult] = useState<LinkResult | null>(null)

  // Contacts state
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactsAnalysis, setContactsAnalysis] = useState<ContactsAnalysis | null>(null)
  const [contactsError, setContactsError] = useState<string | null>(null)
  const [contactsImportResult, setContactsImportResult] = useState<ImportResult | null>(null)

  // Organizations state
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [orgsAnalysis, setOrgsAnalysis] = useState<OrganizationsAnalysis | null>(null)
  const [orgsError, setOrgsError] = useState<string | null>(null)
  const [orgsImportResult, setOrgsImportResult] = useState<ImportResult | null>(null)

  // Import options
  const [importToSupabase, setImportToSupabase] = useState(true)
  const [incrementalSync, setIncrementalSync] = useState(true)

  const fetchWorkItems = async (forceFullSync = false) => {
    setWorkItemsLoading(true)
    setWorkItemsError(null)
    setWorkItemsImportResult(null)
    setWorkItemsLinkResult(null)
    try {
      const useIncremental = incrementalSync && !forceFullSync
      const url = `/api/karbon/work-items?debug=true${importToSupabase ? "&import=true" : ""}${useIncremental ? "&incremental=true" : ""}`
      const response = await fetch(url)
      const data = await response.json()
      if (data.error) {
        setWorkItemsError(data.error)
      } else {
        setWorkItemsAnalysis(data.analysis)
        if (data.importResult) {
          setWorkItemsImportResult(data.importResult)
        }
        if (data.linkResult) {
          setWorkItemsLinkResult(data.linkResult)
        }
      }
    } catch (err) {
      setWorkItemsError(err instanceof Error ? err.message : "Failed to fetch work items")
    } finally {
      setWorkItemsLoading(false)
    }
  }

  const fetchContacts = async (forceFullSync = false) => {
    setContactsLoading(true)
    setContactsError(null)
    setContactsImportResult(null)
    try {
      const useIncremental = incrementalSync && !forceFullSync
      const url = `/api/karbon/contacts?debug=true${importToSupabase ? "&import=true" : ""}${useIncremental ? "&incremental=true" : ""}`
      const response = await fetch(url)
      const data = await response.json()
      if (data.error) {
        setContactsError(data.error)
      } else {
        setContactsAnalysis(data.analysis)
        if (data.importResult) {
          setContactsImportResult(data.importResult)
        }
      }
    } catch (err) {
      setContactsError(err instanceof Error ? err.message : "Failed to fetch contacts")
    } finally {
      setContactsLoading(false)
    }
  }

  const fetchOrganizations = async (forceFullSync = false) => {
    setOrgsLoading(true)
    setOrgsError(null)
    setOrgsImportResult(null)
    try {
      const useIncremental = incrementalSync && !forceFullSync
      const url = `/api/karbon/organizations?debug=true${importToSupabase ? "&import=true" : ""}${useIncremental ? "&incremental=true" : ""}`
      const response = await fetch(url)
      const data = await response.json()
      if (data.error) {
        setOrgsError(data.error)
      } else {
        if (data.analysis) {
          setOrgsAnalysis({
            totalOrganizations: data.analysis.totalOrganizations || 0,
            uniqueEntityTypes: data.analysis.uniqueEntityTypes || [],
            entityTypeBreakdown: data.analysis.entityTypeBreakdown || {},
            uniqueIndustries: data.analysis.uniqueIndustries || [],
            industryBreakdown: data.analysis.industryBreakdown || {},
            uniqueCountries: data.analysis.uniqueCountries || [],
            uniqueStates: data.analysis.uniqueStates || [],
            sampleRawItems: data.analysis.sampleRawItems || [],
          })
        } else if (data.organizations) {
          // Fallback: Build analysis from raw organizations data
          const orgs = data.organizations || []
          const entityTypes: Record<string, number> = {}
          const industries: Record<string, number> = {}
          const countries: Set<string> = new Set()
          const states: Set<string> = new Set()

          orgs.forEach((org: any) => {
            const et = org.AccountingDetail?.EntityType || org.ContactType || org.EntityType || "Unknown"
            entityTypes[et] = (entityTypes[et] || 0) + 1

            const ind = org.AccountingDetail?.Industry || org.Industry || "Unknown"
            industries[ind] = (industries[ind] || 0) + 1

            if (org.Country) countries.add(org.Country)
            if (org.State) states.add(org.State)
          })

          setOrgsAnalysis({
            totalOrganizations: orgs.length,
            uniqueEntityTypes: Object.keys(entityTypes),
            entityTypeBreakdown: entityTypes,
            uniqueIndustries: Object.keys(industries),
            industryBreakdown: industries,
            uniqueCountries: Array.from(countries),
            uniqueStates: Array.from(states),
            sampleRawItems: orgs.slice(0, 3),
          })
        }
        if (data.importResult) {
          setOrgsImportResult(data.importResult)
        }
      }
    } catch (err) {
      setOrgsError(err instanceof Error ? err.message : "Failed to fetch organizations")
    } finally {
      setOrgsLoading(false)
    }
  }

  const renderImportResult = (result: ImportResult | null, linkResult?: LinkResult | null) => {
    if (!result) return null

    return (
      <Card
        className={
          result.success
            ? "border-green-500 bg-green-50 dark:bg-green-950/20"
            : "border-amber-500 bg-amber-50 dark:bg-amber-950/20"
        }
      >
        <CardContent className="pt-4">
          <div className="flex items-center gap-3">
            {result.success ? (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            ) : (
              <AlertCircle className="h-5 w-5 text-amber-600" />
            )}
            <div className="flex-1">
              <p className="font-medium">
                {result.error
                  ? `Import failed: ${result.error}`
                  : `Imported ${result.synced?.toLocaleString()} records to Supabase`}
              </p>
              {result.incrementalSync && (
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Incremental sync from{" "}
                  {result.lastSyncTimestamp ? new Date(result.lastSyncTimestamp).toLocaleString() : "beginning"}
                </p>
              )}
              {result.errors && result.errors > 0 && (
                <p className="text-sm text-muted-foreground">
                  {result.errors} errors occurred
                  {result.errorDetails && `: ${result.errorDetails[0]}`}
                </p>
              )}
              {linkResult && (linkResult.linked || 0) > 0 && (
                <p className="text-sm text-green-600 flex items-center gap-1 mt-1">
                  <Link2 className="h-3 w-3" />
                  Linked {linkResult.linked} work items to contacts/organizations
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  const renderError = (error: string | null) => {
    if (!error) return null

    return (
      <Card className="border-destructive">
        <CardContent className="pt-4">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <DashboardLayout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Karbon Data Analysis</h1>
            <p className="text-sm text-muted-foreground">View and import your Karbon data into Supabase</p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch id="incremental-toggle" checked={incrementalSync} onCheckedChange={setIncrementalSync} />
              <Label htmlFor="incremental-toggle" className="text-sm cursor-pointer flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                Incremental Sync
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="import-toggle" checked={importToSupabase} onCheckedChange={setImportToSupabase} />
              <Label htmlFor="import-toggle" className="text-sm cursor-pointer flex items-center gap-1">
                <Database className="h-3 w-3" />
                Import to Supabase
              </Label>
            </div>
          </div>
        </div>

        {incrementalSync && importToSupabase && (
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200">
            <CardContent className="py-3">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                <strong>Incremental Sync Enabled:</strong> Only records modified since the last sync will be fetched and
                imported. Use "Full Sync" button to reimport all records.
              </p>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="work-items" className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Work Items
            </TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Contacts
            </TabsTrigger>
            <TabsTrigger value="organizations" className="flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Organizations
            </TabsTrigger>
          </TabsList>

          {/* Work Items Tab */}
          <TabsContent value="work-items" className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Karbon Work Items</h3>
                    <p className="text-sm text-muted-foreground">
                      Fetch work items from Karbon and sync to the work_items table.
                      {incrementalSync && " Uses karbon_work_item_key for duplicate detection."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {incrementalSync && importToSupabase && (
                      <Button variant="outline" onClick={() => fetchWorkItems(true)} disabled={workItemsLoading}>
                        {workItemsLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Database className="h-4 w-4 mr-2" />
                        )}
                        Full Sync
                      </Button>
                    )}
                    <Button onClick={() => fetchWorkItems(false)} disabled={workItemsLoading}>
                      {workItemsLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : importToSupabase ? (
                        incrementalSync ? (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )
                      ) : (
                        <Database className="h-4 w-4 mr-2" />
                      )}
                      {workItemsLoading
                        ? "Fetching..."
                        : importToSupabase
                          ? incrementalSync
                            ? "Sync Changes"
                            : "Fetch & Import Work Items"
                          : "Fetch Work Items"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {renderError(workItemsError)}
            {renderImportResult(workItemsImportResult, workItemsLinkResult)}

            {workItemsAnalysis && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {workItemsImportResult?.incrementalSync ? "Changed Items" : "Total Work Items"}
                          </p>
                          <p className="text-xl font-bold">{workItemsAnalysis.totalWorkItems.toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Work Types</p>
                          <p className="text-xl font-bold">{workItemsAnalysis.uniqueWorkTypes.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-purple-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Unique Clients</p>
                          <p className="text-xl font-bold">{workItemsAnalysis.totalUniqueClients.toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-orange-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {workItemsLinkResult ? "Linked" : "Client Groups"}
                          </p>
                          <p className="text-xl font-bold">
                            {workItemsLinkResult?.linked ?? workItemsAnalysis.totalUniqueClientGroups}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Work Types Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(workItemsAnalysis.workTypeBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                            <span className="font-medium truncate mr-2">{type}</span>
                            <Badge variant="secondary" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Status Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(workItemsAnalysis.statusBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([status, count]) => (
                          <div
                            key={status}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                          >
                            <span className="font-medium truncate mr-2">{status}</span>
                            <Badge variant="secondary" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Sample Raw Work Item</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="bg-muted rounded p-3 overflow-auto max-h-64">
                      <pre className="text-xs">{JSON.stringify(workItemsAnalysis.sampleRawItems[0], null, 2)}</pre>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {!workItemsAnalysis && !workItemsLoading && !workItemsError && (
              <Card>
                <CardContent className="py-8 text-center">
                  <Briefcase className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click "{incrementalSync ? "Sync Changes" : "Fetch & Import Work Items"}" to pull your Karbon work
                    items
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Contacts Tab */}
          <TabsContent value="contacts" className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Karbon Contacts</h3>
                    <p className="text-sm text-muted-foreground">
                      Fetch contacts from Karbon and sync to the contacts table.
                      {incrementalSync && " Uses karbon_contact_key for duplicate detection."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {incrementalSync && importToSupabase && (
                      <Button variant="outline" onClick={() => fetchContacts(true)} disabled={contactsLoading}>
                        {contactsLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Database className="h-4 w-4 mr-2" />
                        )}
                        Full Sync
                      </Button>
                    )}
                    <Button onClick={() => fetchContacts(false)} disabled={contactsLoading}>
                      {contactsLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : importToSupabase ? (
                        incrementalSync ? (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )
                      ) : (
                        <Database className="h-4 w-4 mr-2" />
                      )}
                      {contactsLoading
                        ? "Fetching..."
                        : importToSupabase
                          ? incrementalSync
                            ? "Sync Changes"
                            : "Fetch & Import Contacts"
                          : "Fetch Contacts"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {renderError(contactsError)}
            {renderImportResult(contactsImportResult)}

            {contactsAnalysis && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {contactsImportResult?.incrementalSync ? "Changed Contacts" : "Total Contacts"}
                          </p>
                          <p className="text-xl font-bold">{contactsAnalysis.totalContacts.toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Contact Types</p>
                          <p className="text-xl font-bold">{contactsAnalysis.uniqueContactTypes.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-purple-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Countries</p>
                          <p className="text-xl font-bold">{contactsAnalysis.uniqueCountries.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-orange-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">States</p>
                          <p className="text-xl font-bold">{contactsAnalysis.uniqueStates.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Contact Types Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(contactsAnalysis.contactTypeBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                            <span className="font-medium truncate mr-2">{type}</span>
                            <Badge variant="secondary" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Sample Raw Contact</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="bg-muted rounded p-3 overflow-auto max-h-64">
                      <pre className="text-xs">{JSON.stringify(contactsAnalysis.sampleRawItems[0], null, 2)}</pre>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {!contactsAnalysis && !contactsLoading && !contactsError && (
              <Card>
                <CardContent className="py-8 text-center">
                  <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click "{incrementalSync ? "Sync Changes" : "Fetch & Import Contacts"}" to pull your Karbon contacts
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Organizations Tab */}
          <TabsContent value="organizations" className="space-y-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">Karbon Organizations</h3>
                    <p className="text-sm text-muted-foreground">
                      Fetch organizations from Karbon and sync to the organizations table.
                      {incrementalSync && " Uses karbon_organization_key for duplicate detection."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {incrementalSync && importToSupabase && (
                      <Button variant="outline" onClick={() => fetchOrganizations(true)} disabled={orgsLoading}>
                        {orgsLoading ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Database className="h-4 w-4 mr-2" />
                        )}
                        Full Sync
                      </Button>
                    )}
                    <Button onClick={() => fetchOrganizations(false)} disabled={orgsLoading}>
                      {orgsLoading ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : importToSupabase ? (
                        incrementalSync ? (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        ) : (
                          <Upload className="h-4 w-4 mr-2" />
                        )
                      ) : (
                        <Database className="h-4 w-4 mr-2" />
                      )}
                      {orgsLoading
                        ? "Fetching..."
                        : importToSupabase
                          ? incrementalSync
                            ? "Sync Changes"
                            : "Fetch & Import Organizations"
                          : "Fetch Organizations"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {renderError(orgsError)}
            {renderImportResult(orgsImportResult)}

            {orgsAnalysis && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-blue-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {orgsImportResult?.incrementalSync ? "Changed Orgs" : "Total Organizations"}
                          </p>
                          <p className="text-xl font-bold">{orgsAnalysis.totalOrganizations.toLocaleString()}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-green-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Entity Types</p>
                          <p className="text-xl font-bold">{orgsAnalysis.uniqueEntityTypes.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-purple-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Industries</p>
                          <p className="text-xl font-bold">{orgsAnalysis.uniqueIndustries.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="p-0">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-orange-600" />
                        <div>
                          <p className="text-xs text-muted-foreground">Countries</p>
                          <p className="text-xl font-bold">{orgsAnalysis.uniqueCountries.length}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Entity Types Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(orgsAnalysis.entityTypeBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => (
                          <div key={type} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
                            <span className="font-medium truncate mr-2">{type}</span>
                            <Badge variant="secondary" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Industries Breakdown</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                      {Object.entries(orgsAnalysis.industryBreakdown)
                        .sort((a, b) => b[1] - a[1])
                        .map(([industry, count]) => (
                          <div
                            key={industry}
                            className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm"
                          >
                            <span className="font-medium truncate mr-2">{industry}</span>
                            <Badge variant="secondary" className="text-xs">
                              {count}
                            </Badge>
                          </div>
                        ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 pb-2">
                    <CardTitle className="text-base">Sample Raw Organization</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="bg-muted rounded p-3 overflow-auto max-h-64">
                      <pre className="text-xs">{JSON.stringify(orgsAnalysis.sampleRawItems[0], null, 2)}</pre>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {!orgsAnalysis && !orgsLoading && !orgsError && (
              <Card>
                <CardContent className="py-8 text-center">
                  <Building2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Click "{incrementalSync ? "Sync Changes" : "Fetch & Import Organizations"}" to pull your Karbon
                    organizations
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  )
}
