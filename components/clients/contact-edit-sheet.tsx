"use client"

/**
 * Edit sheet for Hub contacts (individuals).
 * Slide-out panel for editing contact details with sections for:
 * - Basic Info (name, email, phone)
 * - Address
 * - Professional (occupation, employer)
 * - Notes & Tags
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

interface Contact {
  id: string
  first_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
  primary_email?: string | null
  secondary_email?: string | null
  phone_primary?: string | null
  phone_mobile?: string | null
  phone_work?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip_code?: string | null
  country?: string | null
  status?: string | null
  notes?: string | null
  tags?: string[] | null
  occupation?: string | null
  employer?: string | null
  contact_preference?: string | null
  linkedin_url?: string | null
  twitter_handle?: string | null
  website?: string | null
  salutation?: string | null
  suffix?: string | null
}

interface Props {
  contact: Contact | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: Contact) => void
}

const CONTACT_STATUSES = ["active", "inactive", "prospect", "archived"]
const CONTACT_PREFERENCES = ["email", "phone", "text", "mail", "any"]
const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."]

export function ContactEditSheet({
  contact,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [saving, setSaving] = useState(false)

  // Form state
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [preferredName, setPreferredName] = useState("")
  const [salutation, setSalutation] = useState("")
  const [suffix, setSuffix] = useState("")
  const [primaryEmail, setPrimaryEmail] = useState("")
  const [secondaryEmail, setSecondaryEmail] = useState("")
  const [phonePrimary, setPhonePrimary] = useState("")
  const [phoneMobile, setPhoneMobile] = useState("")
  const [phoneWork, setPhoneWork] = useState("")
  const [addressLine1, setAddressLine1] = useState("")
  const [addressLine2, setAddressLine2] = useState("")
  const [city, setCity] = useState("")
  const [state, setState] = useState("")
  const [zipCode, setZipCode] = useState("")
  const [country, setCountry] = useState("")
  const [status, setStatus] = useState("")
  const [notes, setNotes] = useState("")
  const [occupation, setOccupation] = useState("")
  const [employer, setEmployer] = useState("")
  const [contactPreference, setContactPreference] = useState("")
  const [linkedinUrl, setLinkedinUrl] = useState("")
  const [twitterHandle, setTwitterHandle] = useState("")
  const [website, setWebsite] = useState("")

  // Load contact data when opened
  useEffect(() => {
    if (contact && open) {
      setFirstName(contact.first_name || "")
      setLastName(contact.last_name || "")
      setPreferredName(contact.preferred_name || "")
      setSalutation(contact.salutation || "")
      setSuffix(contact.suffix || "")
      setPrimaryEmail(contact.primary_email || "")
      setSecondaryEmail(contact.secondary_email || "")
      setPhonePrimary(contact.phone_primary || "")
      setPhoneMobile(contact.phone_mobile || "")
      setPhoneWork(contact.phone_work || "")
      setAddressLine1(contact.address_line1 || "")
      setAddressLine2(contact.address_line2 || "")
      setCity(contact.city || "")
      setState(contact.state || "")
      setZipCode(contact.zip_code || "")
      setCountry(contact.country || "")
      setStatus(contact.status || "")
      setNotes(contact.notes || "")
      setOccupation(contact.occupation || "")
      setEmployer(contact.employer || "")
      setContactPreference(contact.contact_preference || "")
      setLinkedinUrl(contact.linkedin_url || "")
      setTwitterHandle(contact.twitter_handle || "")
      setWebsite(contact.website || "")
    }
  }, [contact, open])

  async function handleSave() {
    if (!contact) return

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        first_name: firstName || null,
        last_name: lastName || null,
        preferred_name: preferredName || null,
        salutation: salutation || null,
        suffix: suffix || null,
        primary_email: primaryEmail || null,
        secondary_email: secondaryEmail || null,
        phone_primary: phonePrimary || null,
        phone_mobile: phoneMobile || null,
        phone_work: phoneWork || null,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        city: city || null,
        state: state || null,
        zip_code: zipCode || null,
        country: country || null,
        status: status || null,
        notes: notes || null,
        occupation: occupation || null,
        employer: employer || null,
        contact_preference: contactPreference || null,
        linkedin_url: linkedinUrl || null,
        twitter_handle: twitterHandle || null,
        website: website || null,
      }

      const res = await fetch(`/api/clients/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Failed to save")
      }

      const { data: updated } = await res.json()
      toast.success("Contact updated successfully")
      onSaved(updated)
      onOpenChange(false)
    } catch (err) {
      console.error("[ContactEditSheet] save error:", err)
      toast.error(err instanceof Error ? err.message : "Failed to save contact")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg w-full flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Contact</SheetTitle>
          <SheetDescription>
            Update contact information. Changes are saved to the audit trail.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 pb-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Basic Information
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="salutation">Salutation</Label>
                  <Select value={salutation} onValueChange={setSalutation}>
                    <SelectTrigger id="salutation">
                      <SelectValue placeholder="Select..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">None</SelectItem>
                      {SALUTATIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="suffix">Suffix</Label>
                  <Input
                    id="suffix"
                    value={suffix}
                    onChange={(e) => setSuffix(e.target.value)}
                    placeholder="Jr., III, etc."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferredName">Preferred Name</Label>
                <Input
                  id="preferredName"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  placeholder="Nickname or preferred name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id="status">
                    <SelectValue placeholder="Select status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            {/* Contact Methods */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Contact Methods
              </h3>

              <div className="space-y-2">
                <Label htmlFor="primaryEmail">Primary Email</Label>
                <Input
                  id="primaryEmail"
                  type="email"
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secondaryEmail">Secondary Email</Label>
                <Input
                  id="secondaryEmail"
                  type="email"
                  value={secondaryEmail}
                  onChange={(e) => setSecondaryEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="phonePrimary">Primary Phone</Label>
                  <Input
                    id="phonePrimary"
                    type="tel"
                    value={phonePrimary}
                    onChange={(e) => setPhonePrimary(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phoneMobile">Mobile</Label>
                  <Input
                    id="phoneMobile"
                    type="tel"
                    value={phoneMobile}
                    onChange={(e) => setPhoneMobile(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phoneWork">Work Phone</Label>
                <Input
                  id="phoneWork"
                  type="tel"
                  value={phoneWork}
                  onChange={(e) => setPhoneWork(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactPreference">Contact Preference</Label>
                <Select
                  value={contactPreference}
                  onValueChange={setContactPreference}
                >
                  <SelectTrigger id="contactPreference">
                    <SelectValue placeholder="Select preference..." />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_PREFERENCES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

            {/* Professional */}
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-foreground">
                Professional
              </h3>

              <div className="space-y-2">
                <Label htmlFor="occupation">Occupation</Label>
                <Input
                  id="occupation"
                  value={occupation}
                  onChange={(e) => setOccupation(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="employer">Employer</Label>
                <Input
                  id="employer"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="linkedinUrl">LinkedIn URL</Label>
                <Input
                  id="linkedinUrl"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="twitterHandle">Twitter Handle</Label>
                <Input
                  id="twitterHandle"
                  value={twitterHandle}
                  onChange={(e) => setTwitterHandle(e.target.value)}
                  placeholder="@username"
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
                  placeholder="Add notes about this contact..."
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
