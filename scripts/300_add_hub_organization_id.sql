-- Add hub_organization_id to proconnect_clients so we can link
-- ProConnect clients to either a contact (person) or an organization.
-- Together with hub_contact_id, exactly one of the two should be set
-- for a linked ProConnect client.

ALTER TABLE proconnect_clients
  ADD COLUMN IF NOT EXISTS hub_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proconnect_clients_hub_organization_id
  ON proconnect_clients(hub_organization_id);

COMMENT ON COLUMN proconnect_clients.hub_organization_id IS
  'When the ProConnect client represents a business, this links to the matching organizations.id row in the Hub. Mutually exclusive with hub_contact_id.';
