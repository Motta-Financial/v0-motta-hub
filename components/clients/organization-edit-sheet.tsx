"use client"

/**
 * Edit sheet for Hub organizations (businesses/entities).
 * Slide-out panel for editing organization details with sections for:
 * - Basic Info (name, entity type, industry)
 * - Contact Info (email, phone, website)
 * - Address
 * - Business Details (EIN, incorporation)
 * - Notes
 */

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

interface Organization {
  id: string
  name?: string | null
  trading_name?: string | null
  entity_type?: string | null
  industry?: string | null
  line_of_business?: string | null
  primary_email?: string | null
  phone?: string | null
  website?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  country?: string | null
  status?: string | null
  notes?: string | null
  ein?: string | null
  incorporation_state?: string | null
  fiscal_year_end_month?: number | null
  description?: string | null
  linkedin_url?: string | null
  twitter_handle?: string | null
  facebook_url?: string | null
}

interface Props {
  organization: Organization | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Organization) => void
}

const ORG_STATUSES = ["active", "inactive", "prospect", "archived"]
const ENTITY_TYPES = [
  "sole_proprietorship",
  "partnership",
  "llc",
  "s_corp",
  "c_corp",
  "non_profit",
  "trust",
  "estate",
  "other",
]
const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
]

function formatEntityType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Llc/g, "LLC")
    .replace(/S Corp/g, "S-Corp")
    .replace(/C Corp/g, "C-Corp")
}

export function OrganizationEditSheet({
  organization,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [tradingName, setTradingName] = useState("")
  const [entityType, setEntityType] = useState("")
  const [industry, setIndustry] = useState("")
  const [lineOfBusiness, setLineOfBusiness] = useState("")
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [website, setWebsite] = useState("")
  const [addressLine1, setAddressLine1] = useState("")
  const [addressLine2, setAddressLine2] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zipCode, setZipCode] = useState("")
  const [country, setCountry] = useState("")
  const [status, setStatus] = useState("")
  const [notes, setNotes] = useState("")
  const [ein, setEin] = useState("")
  const [incorporationState, setIncorporationState] = useState("")
  const [fiscalYearEndMonth, setFiscalYearEndMonth] = useState<string>("")
  const [description, setDescription] = useState("")
  const [linkedinUrl, setLinkedinUrl] = useState("")
  const [twitterHandle, setTwitterHandle] = useState("")
  const [facebookUrl, setFacebookUrl] = useState("")

  // Load organization data when opened
  useEffect(() => {
    if (organization && open) {
      setName(organization.name || "")
      setTradingName(organization.trading_name || "")
      setEntityType(organization.entity_type || "")
      setIndustry(organization.industry || "")
      setLineOfBusiness(organization.line_of_business || "")
      setPrimaryEmail(organization.primary_email || "")
      setPhone(organization.phone || "")
      setWebsite(organization.website || "")
      setAddressLine1(organization.address_line1 || "")
      setAddressLine2(organization.address_line2 || "")
      setCity(organization.city || "")
      setState(organization.state || "")
      setZipCode(organization.zip_code || "")
      setCountry(organization.country || "")
      setStatus(organization.status || "")
      setNotes(organization.notes || "")
      setEin(organization.ein || "")
      setIncorporationState(organization.incorporation_state || "")
      setFiscalYearEndMonth(
        organization.fiscal_year_end_month?.toString() || ""
      )
      setDescription(organization.description || "")
      setLinkedinUrl(organization.linkedin_url || "")
      setTwitterHandle(organization.twitter_handle || "")
      setFacebookUrl(organization.facebook_url || "")
    }
  }, [organization, open])

  async function handleSave() {
    if (!organization) return

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: name || null,
        trading_name: tradingName || null,
        entity_type: entityType || null,
        industry: industry || null,
        line_of_business: lineOfBusiness || null,
        primary_email: primaryEmail || null,
        phone: phone || null,
        website: website || null,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        city: city || null,
        state: state || null,
        zip_code: zipCode || null,
        country: country || null,
        status: status || null,
        notes: notes || null,
        ein: ein || null,
        incorporation_state: incorporationState || null,
        fiscal_year_end_month: fiscalYearEndMonth
          ? parseInt(fiscalYearEndMonth, 10)
          : null,
        description: description || null,
        linkedin_url: linkedinUrl || null,
        twitter_handle: twitterHandle || null,
        facebook_url: facebookUrl || null,
      }

      const res = await fetch(`/api/clients/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save")
      }

      const { data: updated } = await res.json()
      toast.success("Organization updated successfully")
      onSaved(updated)
      onOpenChange(false)
    } catch (err) {
      console.error("[OrganizationEditSheet] save error:", err)
      toast.error(
        err instanceof Error ? err.message : "Failed to save organization"
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Organization</SheetTitle>
          <SheetDescription>
            Update organization information. Changes are saved to the audit
            trail.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Basic Information
              </h3>

              <div className="space-y-2">
                <Label htmlFor="name">Legal Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tradingName">Trading Name / DBA</Label>
                <Input
                  id="tradingName"
                  value={tradingName}
                  onChange={(e) => setTradingName(e.target.value)}
                  placeholder="If different from legal name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="entityType">Entity Type</Label>
                <Select value={entityType} onValueChange={setEntityType}>
                  <SelectTrigger id="entityType">
                    <SelectValue placeholder="Select entity type..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ENTITY_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {formatEntityType(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industry</Label>
                <Input
                  id="industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g., Technology, Healthcare, Retail"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="lineOfBusiness">Line of Business</Label>
                <Input
                  id="lineOfBusiness"
                  value={lineOfBusiness}
                  onChange={(e) => setLineOfBusiness(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Brief description of the business..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Select status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Contact Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Contact Information
              </h3>

              <div className="space-y-2">
                <Label htmlFor="primaryEmail">Email</Label>
                <Input
                  id="primaryEmail"
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedinUrl">LinkedIn</Label>
                <Input
                  id="linkedinUrl"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/company/..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="twitterHandle">Twitter</Label>
                  <Input
                    id="twitterHandle"
                    value={twitterHandle}
                    onChange={(e) => setTwitterHandle(e.target.value)}
                    placeholder="@handle"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="facebookUrl">Facebook</Label>
                  <Input
                    id="facebookUrl"
                    value={facebookUrl}
                    onChange={(e) => setFacebookUrl(e.target.value)}
                    placeholder="URL"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Address */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Address</h3>

              <div className="space-y-2">
                <Label htmlFor="addressLine1">Address Line 1</Label>
                <Input
                  id="addressLine1"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="addressLine2">Address Line 2</Label>
                <Input
                  id="addressLine2"
                  value={addressLine2}
                  onChange={(e) => setAddressLine2(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State</Label>
                  <Input
                    id="state"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP Code</Label>
                  <Input
                    id="zipCode"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Business Details */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Business Details
              </h3>

              <div className="space-y-2">
                <Label htmlFor="ein">EIN</Label>
                <Input
                  id="ein"
                  value={ein}
                  onChange={(e) => setEin(e.target.value)}
                  placeholder="XX-XXXXXXX"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="incorporationState">
                    Incorporation State
                  </Label>
                  <Input
                    id="incorporationState"
                    value={incorporationState}
                    onChange={(e) => setIncorporationState(e.target.value)}
                    placeholder="e.g., DE, CA"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fiscalYearEndMonth">Fiscal Year End</Label>
                  <Select
                    value={fiscalYearEndMonth}
                    onValueChange={setFiscalYearEndMonth}
                  >
                    <SelectTrigger id="fiscalYearEndMonth">
                      <SelectValue placeholder="Select month..." />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m) => (
                        <SelectItem key={m.value} value={m.value.toString()}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Separator />

            {/* Notes */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">Notes</h3>

              <div className="space-y-2">
                <Label htmlFor="notes">Internal Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Add notes about this organization..."
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <SheetFooter className="border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
