var BASE = "https://api.karbonhq.com/v3"
var AK = process.env.KARBON_ACCESS_KEY, BT = process.env.KARBON_BEARER_TOKEN
var SB_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
var SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function kFetch(url) {
  var u = url.startsWith("http") ? url : BASE + url
  var r = await fetch(u, { headers: { Authorization: "Bearer " + BT, AccessKey: AK, Accept: "application/json" } })
  if (!r.ok) { var t = ""; try{t=await r.text()}catch(x){} throw new Error(r.status + " " + t.substring(0,200)) }
  return r.json()
}
async function kFetchAll(ep) {
  var all = [], url = BASE + ep, pg = 1
  while (url) {
    var d = await kFetch(url)
    var items = d.value || d || []
    if (Array.isArray(items)) for (var i=0;i<items.length;i++) all.push(items[i])
    url = d["@odata.nextLink"] || d["odata.nextLink"] || null
    if (pg % 5 === 0) console.log("  ... " + all.length + " (page " + pg + ")")
    pg++; if (pg > 500) break
  }
  return all
}
async function sbUpsert(table, data) {
  if (!data || !data.length) return { s: 0, e: 0 }
  var s = 0, e = 0
  for (var i = 0; i < data.length; i += 50) {
    var batch = data.slice(i, i + 50)
    var r = await fetch(SB_URL + "/rest/v1/" + table, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch)
    })
    if (r.ok) s += batch.length
    else { var t=""; try{t=await r.text()}catch(x){} console.error("  ERR " + table + ": " + r.status + " " + t.substring(0,300)); e += batch.length }
  }
  return { s: s, e: e }
}

async function main() {
  console.log("=== SYNC PART 1: Users + Contacts ===\n")

  // Users
  console.log("Syncing Users...")
  var rawU = await kFetchAll("/Users")
  console.log("  Fetched " + rawU.length)
  var seen = {}
  var users = rawU.filter(function(u) {
    var k = u.UserKey || u.MemberKey || u.Id
    var e = (u.EmailAddress || "").toLowerCase()
    if (!k || seen[k] || (e && seen["e_"+e])) return false
    seen[k] = true; if (e) seen["e_"+e] = true; return true
  }).map(function(u) {
    var parts = (u.Name || "").split(" ")
    return {
      karbon_user_key: u.UserKey || u.MemberKey || u.Id,
      first_name: u.FirstName || parts[0] || null,
      last_name: u.LastName || parts.slice(1).join(" ") || null,
      full_name: u.FullName || u.Name || null,
      email: u.EmailAddress || u.Email || null,
      title: u.Title || null, role: u.Role || null, department: u.Department || null,
      phone_number: u.PhoneNumber || null, mobile_number: u.MobileNumber || null,
      is_active: u.IsActive !== false,
      karbon_url: (u.UserKey||u.MemberKey||u.Id) ? "https://app2.karbonhq.com/4mTyp9lLRWTC#/team/" + (u.UserKey||u.MemberKey||u.Id) : null,
      last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }
  })
  var ru = await sbUpsert("team_members", users)
  console.log("  Users: " + ru.s + " synced, " + ru.e + " errors\n")

  // Contacts
  console.log("Syncing Contacts...")
  var rawC = await kFetchAll("/Contacts")
  console.log("  Fetched " + rawC.length)
  var contacts = rawC.map(function(c) {
    var bcs = Array.isArray(c.BusinessCards) ? c.BusinessCards : []
    var bc = bcs[0] || {}
    for (var bi=0;bi<bcs.length;bi++) if (bcs[bi].IsPrimaryCard) { bc = bcs[bi]; break }
    var acct = c.AccountingDetail || {}
    var phs = Array.isArray(bc.PhoneNumbers) ? bc.PhoneNumbers : []
    var ems = Array.isArray(bc.EmailAddresses) ? bc.EmailAddresses : []
    var addrs = Array.isArray(bc.Addresses) ? bc.Addresses : []
    var addr = addrs[0] || {}
    for (var ai=0;ai<addrs.length;ai++) if (addrs[ai].Label==="Physical") { addr=addrs[ai]; break }
    var acctNotes = acct.Notes || {}
    return {
      karbon_contact_key: c.ContactKey,
      first_name: c.FirstName || null, last_name: c.LastName || null,
      middle_name: c.MiddleName || null, preferred_name: c.PreferredName || null,
      salutation: c.Salutation || null, suffix: c.Suffix || null, prefix: c.Prefix || null,
      full_name: c.FullName || [c.FirstName, c.MiddleName, c.LastName].filter(Boolean).join(" ") || null,
      contact_type: c.ContactType || "Individual", entity_type: acct.EntityType || "Individual",
      status: c.Status || "Active", restriction_level: c.RestrictionLevel || null,
      is_prospect: c.ContactType === "Prospect",
      primary_email: c.EmailAddress || ems[0] || null,
      secondary_email: ems.length > 1 ? ems[1] : null,
      phone_primary: c.PhoneNumber || (phs[0] && phs[0].Number ? String(phs[0].Number) : null),
      address_line1: addr.AddressLines || addr.Street || null,
      city: addr.City || null, state: addr.StateProvinceCounty || null,
      zip_code: addr.ZipCode || addr.PostalCode || null, country: addr.CountryCode || null,
      date_of_birth: acct.BirthDate ? acct.BirthDate.split("T")[0] : null,
      occupation: c.Occupation || acct.Occupation || null,
      client_owner_key: c.ClientOwnerKey || null, client_manager_key: c.ClientManagerKey || null,
      client_partner_key: c.ClientPartnerKey || null,
      user_defined_identifier: c.UserDefinedIdentifier || null,
      business_cards: bcs.length > 0 ? bcs : null,
      accounting_detail: Object.keys(acct).length > 0 ? acct : null,
      assigned_team_members: c.AssignedTeamMembers || [],
      tags: c.Tags || [], notes: acctNotes.Body || c.Notes || null,
      custom_fields: c.CustomFields || {},
      contact_preference: c.ContactPreference || null,
      karbon_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/" + c.ContactKey,
      karbon_contact_url: "https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/" + c.ContactKey,
      karbon_created_at: c.CreatedDateTime || null, karbon_modified_at: c.LastModifiedDateTime || null,
      last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }
  })
  var rc = await sbUpsert("contacts", contacts)
  console.log("  Contacts: " + rc.s + " synced, " + rc.e + " errors\n")
  console.log("=== PART 1 COMPLETE ===")
}
main().catch(function(e){console.error("FATAL:",e.message)})
