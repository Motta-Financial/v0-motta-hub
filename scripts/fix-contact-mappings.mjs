/**
 * Fix Contact Mappings Across Integrations
 * 
 * This script fixes orphaned records by:
 * 1. Linking debriefs to contacts/organizations via karbon_client_key
 * 2. Linking Calendly invitees to contacts via email match
 * 3. Inheriting contact/organization links from ignition_clients to ignition_proposals
 * 
 * Run with: node --env-file-if-exists=/vercel/share/.env.project scripts/fix-contact-mappings.mjs
 */

import postgres from 'postgres'

const url = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING
if (!url) {
  console.error('No POSTGRES_URL found')
  process.exit(1)
}

const sql = postgres(url)

async function fixDebriefMappings() {
  console.log('\n=== FIXING DEBRIEF MAPPINGS ===\n')
  
  // Link debriefs to contacts via karbon_client_key
  const contactLinks = await sql`
    UPDATE debriefs d
    SET contact_id = c.id
    FROM contacts c
    WHERE d.karbon_client_key = c.karbon_contact_key
      AND d.contact_id IS NULL
      AND c.karbon_contact_key IS NOT NULL
    RETURNING d.id, c.full_name
  `
  console.log(`Linked ${contactLinks.length} debriefs to contacts via karbon_contact_key`)
  
  // Link debriefs to organizations via karbon_client_key
  const orgLinks = await sql`
    UPDATE debriefs d
    SET organization_id = o.id
    FROM organizations o
    WHERE d.karbon_client_key = o.karbon_organization_key
      AND d.organization_id IS NULL
      AND d.contact_id IS NULL
      AND o.karbon_organization_key IS NOT NULL
    RETURNING d.id, o.name
  `
  console.log(`Linked ${orgLinks.length} debriefs to organizations via karbon_organization_key`)
  
  // Link debriefs to client_groups via karbon_client_key (for client_group_id)
  const groupLinks = await sql`
    UPDATE debriefs d
    SET client_group_id = cg.id
    FROM client_groups cg
    WHERE d.karbon_client_key = cg.karbon_client_group_key
      AND d.client_group_id IS NULL
      AND cg.karbon_client_group_key IS NOT NULL
    RETURNING d.id, cg.name
  `
  console.log(`Linked ${groupLinks.length} debriefs to client_groups via karbon_client_group_key`)
  
  // Try to link debriefs to contacts/orgs via work_item
  const workItemLinks = await sql`
    UPDATE debriefs d
    SET 
      contact_id = COALESCE(d.contact_id, w.contact_id),
      organization_id = COALESCE(d.organization_id, w.organization_id)
    FROM work_items w
    WHERE d.work_item_id = w.id
      AND d.contact_id IS NULL AND d.organization_id IS NULL
      AND (w.contact_id IS NOT NULL OR w.organization_id IS NOT NULL)
    RETURNING d.id
  `
  console.log(`Linked ${workItemLinks.length} debriefs to contacts/orgs via work_item`)
}

async function fixCalendlyMappings() {
  console.log('\n=== FIXING CALENDLY INVITEE MAPPINGS ===\n')
  
  // Link calendly invitees to contacts via email match
  const emailLinks = await sql`
    UPDATE calendly_invitees i
    SET contact_id = c.id
    FROM contacts c
    WHERE LOWER(i.email) = LOWER(c.primary_email)
      AND i.contact_id IS NULL
      AND i.email IS NOT NULL
      AND c.primary_email IS NOT NULL
    RETURNING i.id, i.email, c.full_name
  `
  console.log(`Linked ${emailLinks.length} Calendly invitees to contacts via email`)
  
  // Also try secondary email
  const secondaryLinks = await sql`
    UPDATE calendly_invitees i
    SET contact_id = c.id
    FROM contacts c
    WHERE LOWER(i.email) = LOWER(c.secondary_email)
      AND i.contact_id IS NULL
      AND i.email IS NOT NULL
      AND c.secondary_email IS NOT NULL
    RETURNING i.id, i.email, c.full_name
  `
  console.log(`Linked ${secondaryLinks.length} Calendly invitees to contacts via secondary email`)
}

async function fixIgnitionMappings() {
  console.log('\n=== FIXING IGNITION PROPOSAL MAPPINGS ===\n')
  
  // Inherit contact_id from ignition_clients to ignition_proposals
  const contactInherit = await sql`
    UPDATE ignition_proposals p
    SET contact_id = c.contact_id
    FROM ignition_clients c
    WHERE p.ignition_client_id = c.ignition_client_id
      AND p.contact_id IS NULL
      AND c.contact_id IS NOT NULL
    RETURNING p.proposal_id, c.name
  `
  console.log(`Inherited contact_id to ${contactInherit.length} proposals from ignition_clients`)
  
  // Inherit organization_id from ignition_clients to ignition_proposals
  const orgInherit = await sql`
    UPDATE ignition_proposals p
    SET organization_id = c.organization_id
    FROM ignition_clients c
    WHERE p.ignition_client_id = c.ignition_client_id
      AND p.organization_id IS NULL
      AND c.organization_id IS NOT NULL
    RETURNING p.proposal_id, c.name
  `
  console.log(`Inherited organization_id to ${orgInherit.length} proposals from ignition_clients`)
  
  // Try to match unmatched ignition_clients by email
  console.log('\nAttempting to match unmatched ignition_clients by email...')
  const emailMatch = await sql`
    UPDATE ignition_clients ic
    SET 
      contact_id = c.id,
      match_status = 'matched',
      match_method = 'email',
      match_confidence = 0.9
    FROM contacts c
    WHERE LOWER(ic.email) = LOWER(c.primary_email)
      AND ic.contact_id IS NULL
      AND ic.organization_id IS NULL
      AND ic.email IS NOT NULL
      AND c.primary_email IS NOT NULL
    RETURNING ic.ignition_client_id, ic.name, c.full_name
  `
  console.log(`Matched ${emailMatch.length} ignition_clients to contacts by email`)
  
  // Try to match by name
  const nameMatch = await sql`
    UPDATE ignition_clients ic
    SET 
      contact_id = c.id,
      match_status = 'matched',
      match_method = 'name',
      match_confidence = 0.7
    FROM contacts c
    WHERE LOWER(TRIM(ic.name)) = LOWER(TRIM(c.full_name))
      AND ic.contact_id IS NULL
      AND ic.organization_id IS NULL
      AND ic.name IS NOT NULL
      AND c.full_name IS NOT NULL
    RETURNING ic.ignition_client_id, ic.name, c.full_name
  `
  console.log(`Matched ${nameMatch.length} ignition_clients to contacts by name`)
  
  // Try to match business_name to organization
  const bizMatch = await sql`
    UPDATE ignition_clients ic
    SET 
      organization_id = o.id,
      match_status = 'matched',
      match_method = 'business_name',
      match_confidence = 0.8
    FROM organizations o
    WHERE LOWER(TRIM(ic.business_name)) = LOWER(TRIM(o.name))
      AND ic.contact_id IS NULL
      AND ic.organization_id IS NULL
      AND ic.business_name IS NOT NULL
      AND o.name IS NOT NULL
    RETURNING ic.ignition_client_id, ic.business_name, o.name
  `
  console.log(`Matched ${bizMatch.length} ignition_clients to organizations by business_name`)
}

async function showSummary() {
  console.log('\n=== FINAL SUMMARY ===\n')
  
  const ignitionStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(contact_id) as has_contact,
      COUNT(organization_id) as has_organization,
      COUNT(CASE WHEN contact_id IS NULL AND organization_id IS NULL THEN 1 END) as unlinked
    FROM ignition_clients
  `
  console.log('Ignition Clients:')
  console.log(`  Total: ${ignitionStats[0].total}, Linked: ${Number(ignitionStats[0].has_contact) + Number(ignitionStats[0].has_organization)}, Unlinked: ${ignitionStats[0].unlinked}`)
  
  const proposalStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(contact_id) as has_contact,
      COUNT(organization_id) as has_organization,
      COUNT(CASE WHEN contact_id IS NULL AND organization_id IS NULL THEN 1 END) as unlinked
    FROM ignition_proposals
  `
  console.log('Ignition Proposals:')
  console.log(`  Total: ${proposalStats[0].total}, Linked: ${Number(proposalStats[0].has_contact) + Number(proposalStats[0].has_organization)}, Unlinked: ${proposalStats[0].unlinked}`)
  
  const calendlyStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(contact_id) as has_contact
    FROM calendly_invitees
  `
  console.log('Calendly Invitees:')
  console.log(`  Total: ${calendlyStats[0].total}, Linked: ${calendlyStats[0].has_contact}, Unlinked: ${Number(calendlyStats[0].total) - Number(calendlyStats[0].has_contact)}`)
  
  const debriefStats = await sql`
    SELECT 
      COUNT(*) as total,
      COUNT(contact_id) as has_contact,
      COUNT(organization_id) as has_organization,
      COUNT(CASE WHEN contact_id IS NULL AND organization_id IS NULL THEN 1 END) as unlinked
    FROM debriefs
  `
  console.log('Debriefs:')
  console.log(`  Total: ${debriefStats[0].total}, Linked: ${Number(debriefStats[0].has_contact) + Number(debriefStats[0].has_organization)}, Unlinked: ${debriefStats[0].unlinked}`)
}

async function main() {
  console.log('Starting contact mapping fixes...\n')
  
  try {
    await fixDebriefMappings()
    await fixCalendlyMappings()
    await fixIgnitionMappings()
    await showSummary()
    
    console.log('\nContact mapping fixes completed!')
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

main()
