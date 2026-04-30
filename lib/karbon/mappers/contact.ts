/**
 * Pure mapper: Karbon Contact JSON -> Supabase contacts row.
 * Used by both the webhook hot path (lib/karbon/upsert.ts) and the legacy
 * full-sync route at app/api/karbon/contacts/route.ts.
 *
 * NOTE: this is intentionally a pure function — no Supabase, no fetch, no env.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonContactToSupabase(contact: any) {
  const businessCards = Array.isArray(contact.BusinessCards) ? contact.BusinessCards : []
  const businessCard = businessCards.find((bc: any) => bc.IsPrimaryCard) || businessCards[0] || {}
  const accountingDetail = contact.AccountingDetail || {}

  const addresses = Array.isArray(businessCard.Addresses)
    ? businessCard.Addresses
    : businessCard.Addresses
      ? [businessCard.Addresses]
      : []
  const primaryAddress = addresses.find((a: any) => a.Label === "Physical") || addresses[0] || {}
  const mailingAddress = addresses.find((a: any) => a.Label === "Mailing") || {}

  const phoneNumbers = Array.isArray(businessCard.PhoneNumbers)
    ? businessCard.PhoneNumbers
    : businessCard.PhoneNumbers
      ? [businessCard.PhoneNumbers]
      : []
  const workPhone = phoneNumbers.find((p: any) => p.Label === "Work")
  const mobilePhone = phoneNumbers.find((p: any) => p.Label === "Mobile")
  const faxPhone = phoneNumbers.find((p: any) => p.Label === "Fax")
  const primaryPhone = phoneNumbers.find((p: any) => p.Label === "Primary") || phoneNumbers[0]

  const emailAddresses = businessCard.EmailAddresses || []
  const primaryEmailFromCard = Array.isArray(emailAddresses) ? emailAddresses[0] : emailAddresses
  const secondaryEmailFromCard =
    Array.isArray(emailAddresses) && emailAddresses.length > 1 ? emailAddresses[1] : null

  // Registration numbers may be a single object or an array
  const regNumbersRaw = accountingDetail.RegistrationNumbers || {}
  const regNumbers = Array.isArray(regNumbersRaw)
    ? regNumbersRaw
    : regNumbersRaw.Type
      ? [regNumbersRaw]
      : []

  let ein: string | null = null
  let ssnLastFour: string | null = null
  let driversLicense: string | null = null
  let passportNumber: string | null = null
  for (const reg of regNumbers) {
    switch (reg.Type) {
      case "Employer Identification Number (EIN)":
      case "EIN":
        ein = reg.RegistrationNumber
        break
      case "Social Security Number":
      case "SSN":
        ssnLastFour = reg.RegistrationNumber?.slice(-4) || null
        break
      case "Driver's License":
        driversLicense = reg.RegistrationNumber
        break
      case "Passport":
        passportNumber = reg.RegistrationNumber
        break
    }
  }

  const firstName = contact.FirstName || null
  const lastName = contact.LastName || null
  const middleName = contact.MiddleName || null
  const fullName =
    contact.FullName || [firstName, middleName, lastName].filter(Boolean).join(" ") || null

  const primaryEmail = contact.EmailAddress || primaryEmailFromCard || null

  return {
    karbon_contact_key: contact.ContactKey,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    middle_name: middleName,
    preferred_name: contact.PreferredName || null,
    salutation: contact.Salutation || null,
    suffix: contact.Suffix || null,
    prefix: contact.Prefix || null,
    contact_type: contact.ContactType || "Individual",
    entity_type: accountingDetail.EntityType || "Individual",
    status: contact.Status || "Active",
    restriction_level: contact.RestrictionLevel || null,
    is_prospect: contact.ContactType === "Prospect",
    avatar_url: contact.AvatarUrl || null,
    primary_email: typeof primaryEmail === "string" ? primaryEmail : null,
    secondary_email: typeof secondaryEmailFromCard === "string" ? secondaryEmailFromCard : null,
    phone_primary: contact.PhoneNumber || (primaryPhone?.Number ? String(primaryPhone.Number) : null),
    phone_mobile: mobilePhone?.Number ? String(mobilePhone.Number) : null,
    phone_work: workPhone?.Number ? String(workPhone.Number) : null,
    phone_fax: faxPhone?.Number ? String(faxPhone.Number) : null,
    address_line1: primaryAddress.AddressLines || primaryAddress.Street || null,
    address_line2: primaryAddress.AddressLine2 || null,
    city: primaryAddress.City || null,
    state: primaryAddress.StateProvinceCounty || primaryAddress.State || null,
    zip_code: primaryAddress.ZipCode || primaryAddress.PostalCode || null,
    country: primaryAddress.CountryCode || primaryAddress.Country || null,
    mailing_address_line1: mailingAddress.AddressLines || mailingAddress.Street || null,
    mailing_address_line2: mailingAddress.AddressLine2 || null,
    mailing_city: mailingAddress.City || null,
    mailing_state: mailingAddress.StateProvinceCounty || mailingAddress.State || null,
    mailing_zip_code: mailingAddress.ZipCode || mailingAddress.PostalCode || null,
    mailing_country: mailingAddress.CountryCode || mailingAddress.Country || null,
    date_of_birth: accountingDetail.BirthDate ? String(accountingDetail.BirthDate).split("T")[0] : null,
    occupation: contact.Occupation || accountingDetail.Occupation || null,
    employer: contact.Employer || null,
    source: contact.Source || null,
    referred_by: contact.ReferredBy || null,
    linkedin_url: businessCard.LinkedInLink || null,
    twitter_handle: businessCard.TwitterLink || null,
    facebook_url: businessCard.FacebookLink || null,
    website:
      Array.isArray(businessCard.WebSites) ? businessCard.WebSites[0] : businessCard.WebSites || null,
    tax_provider_key: accountingDetail.TaxProvider?.OrganizationKey || null,
    tax_provider_name: accountingDetail.TaxProvider?.Name || null,
    legal_firm_key: accountingDetail.LegalFirm?.OrganizationKey || null,
    legal_firm_name: accountingDetail.LegalFirm?.Name || null,
    client_owner_key: contact.ClientOwnerKey || null,
    client_manager_key: contact.ClientManagerKey || null,
    client_partner_key: contact.ClientPartnerKey || null,
    user_defined_identifier: contact.UserDefinedIdentifier || null,
    registration_numbers: regNumbersRaw,
    business_cards: businessCards.length ? businessCards : null,
    accounting_detail: accountingDetail || null,
    assigned_team_members: contact.AssignedTeamMembers || [],
    tags: contact.Tags || [],
    notes: accountingDetail.Notes?.Body || contact.Notes || null,
    custom_fields: contact.CustomFields || {},
    contact_preference: contact.ContactPreference || null,
    ssn_last_four: ssnLastFour,
    drivers_license: driversLicense,
    passport_number: passportNumber,
    ein,
    karbon_url: `${KARBON_TENANT_PREFIX}/contacts/${contact.ContactKey}`,
    karbon_contact_url: `${KARBON_TENANT_PREFIX}/contacts/${contact.ContactKey}`,
    karbon_created_at: contact.CreatedDateTime || null,
    karbon_modified_at: contact.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
