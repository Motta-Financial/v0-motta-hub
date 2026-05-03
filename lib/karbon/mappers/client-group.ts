/**
 * Pure mapper: Karbon ClientGroup JSON -> Supabase client_groups row.
 */
const KARBON_TENANT_PREFIX = "https://app2.karbonhq.com/4mTyp9lLRWTC#"

export function mapKarbonClientGroupToSupabase(group: any) {
  const groupName = group.FullName || group.Name || `Group ${group.ClientGroupKey}`

  return {
    karbon_client_group_key: group.ClientGroupKey,
    name: groupName,
    description: group.EntityDescription || group.Description || null,
    group_type: group.ContactType || group.GroupType || null,
    contact_type: group.ContactType || null,
    primary_contact_key: group.PrimaryContactKey || null,
    primary_contact_name: group.PrimaryContactName || null,
    client_owner_key: group.ClientOwner || null,
    client_owner_name: group.ClientOwnerName || null,
    client_manager_key: group.ClientManager || null,
    client_manager_name: group.ClientManagerName || null,
    members: group.Members || [],
    restriction_level: group.RestrictionLevel || "Public",
    user_defined_identifier: group.UserDefinedIdentifier || null,
    entity_description: group.EntityDescription || null,
    karbon_url: group.ClientGroupKey
      ? `${KARBON_TENANT_PREFIX}/client-groups/${group.ClientGroupKey}`
      : null,
    karbon_created_at: group.CreatedDate || null,
    karbon_modified_at: group.LastModifiedDateTime || null,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
