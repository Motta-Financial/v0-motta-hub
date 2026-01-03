-- =====================================================
-- COMPREHENSIVE KARBON API SCHEMA ALIGNMENT
-- This migration ensures Supabase mirrors all fields 
-- available from Karbon API v3
-- =====================================================

-- =====================================================
-- 1. CONTACTS TABLE - Align with Karbon Contact API
-- =====================================================
-- Karbon Contact fields from API:
-- ContactKey, FirstName, MiddleName, LastName, PreferredName, Salutation, Suffix
-- ClientOwner, ClientManager, ContactType, UserDefinedIdentifier, RestrictionLevel
-- AvatarUrl, LastModifiedDateTime, EntityDescription
-- AccountingDetail (BirthDate, DeathDate, Sex, FinancialYearEndDay/Month, TaxCountryCode, etc.)
-- BusinessCards (EmailAddresses[], PhoneNumbers[], Addresses[], WebSites[], SocialLinks, OrganizationKey, RoleOrTitle)

ALTER TABLE contacts 
  ADD COLUMN IF NOT EXISTS user_defined_identifier text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS death_date date,
  ADD COLUMN IF NOT EXISTS financial_year_end_day integer,
  ADD COLUMN IF NOT EXISTS financial_year_end_month integer,
  ADD COLUMN IF NOT EXISTS tax_country_code text,
  ADD COLUMN IF NOT EXISTS income_tax_installment_period text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS registration_number_type text,
  ADD COLUMN IF NOT EXISTS business_card_key text,
  ADD COLUMN IF NOT EXISTS websites text[],
  ADD COLUMN IF NOT EXISTS email_addresses text[],
  ADD COLUMN IF NOT EXISTS phone_numbers jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addresses jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_organization_key text,
  ADD COLUMN IF NOT EXISTS role_or_title text,
  ADD COLUMN IF NOT EXISTS facebook_link text,
  ADD COLUMN IF NOT EXISTS linkedin_link text,
  ADD COLUMN IF NOT EXISTS twitter_link text,
  ADD COLUMN IF NOT EXISTS skype_link text,
  ADD COLUMN IF NOT EXISTS client_owner_email text,
  ADD COLUMN IF NOT EXISTS client_manager_email text,
  ADD COLUMN IF NOT EXISTS entity_description text,
  ADD COLUMN IF NOT EXISTS karbon_modified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS karbon_url text;

-- Add comments for documentation
COMMENT ON COLUMN contacts.user_defined_identifier IS 'Karbon: UserDefinedIdentifier - Custom client identifier';
COMMENT ON COLUMN contacts.sex IS 'Karbon: AccountingDetail.Sex - M/F';
COMMENT ON COLUMN contacts.death_date IS 'Karbon: AccountingDetail.DeathDate';
COMMENT ON COLUMN contacts.financial_year_end_day IS 'Karbon: AccountingDetail.FinancialYearEndDay';
COMMENT ON COLUMN contacts.financial_year_end_month IS 'Karbon: AccountingDetail.FinancialYearEndMonth';
COMMENT ON COLUMN contacts.tax_country_code IS 'Karbon: AccountingDetail.TaxCountryCode';
COMMENT ON COLUMN contacts.income_tax_installment_period IS 'Karbon: AccountingDetail.IncomeTaxInstallmentPeriod';
COMMENT ON COLUMN contacts.registration_number IS 'Karbon: AccountingDetail.RegistrationNumbers.RegistrationNumber (SSN/EIN)';
COMMENT ON COLUMN contacts.registration_number_type IS 'Karbon: AccountingDetail.RegistrationNumbers.Type';
COMMENT ON COLUMN contacts.business_card_key IS 'Karbon: BusinessCards.BusinessCardKey';
COMMENT ON COLUMN contacts.websites IS 'Karbon: BusinessCards.WebSites[]';
COMMENT ON COLUMN contacts.email_addresses IS 'Karbon: BusinessCards.EmailAddresses[] - All email addresses';
COMMENT ON COLUMN contacts.phone_numbers IS 'Karbon: BusinessCards.PhoneNumbers[] - JSON array with Number, CountryCode, Label';
COMMENT ON COLUMN contacts.addresses IS 'Karbon: BusinessCards.Addresses[] - JSON array with AddressLines, City, State, ZipCode, CountryCode, Label';
COMMENT ON COLUMN contacts.linked_organization_key IS 'Karbon: BusinessCards.OrganizationKey - Links contact to organization';
COMMENT ON COLUMN contacts.role_or_title IS 'Karbon: BusinessCards.RoleOrTitle';
COMMENT ON COLUMN contacts.facebook_link IS 'Karbon: BusinessCards.FacebookLink';
COMMENT ON COLUMN contacts.linkedin_link IS 'Karbon: BusinessCards.LinkedInLink';
COMMENT ON COLUMN contacts.twitter_link IS 'Karbon: BusinessCards.TwitterLink';
COMMENT ON COLUMN contacts.skype_link IS 'Karbon: BusinessCards.SkypeLink';
COMMENT ON COLUMN contacts.client_owner_email IS 'Karbon: ClientOwner email address';
COMMENT ON COLUMN contacts.client_manager_email IS 'Karbon: ClientManager email address';
COMMENT ON COLUMN contacts.entity_description IS 'Karbon: EntityDescription.Text';
COMMENT ON COLUMN contacts.karbon_modified_at IS 'Karbon: LastModifiedDateTime';

-- =====================================================
-- 2. ORGANIZATIONS TABLE - Align with Karbon Organization API
-- =====================================================
-- Karbon Organization fields from API:
-- OrganizationKey, Name, LegalName, TradingName, EntityType, Industry, LineOfBusiness
-- TaxCountryCode, BaseCurrency, AnnualRevenue, IsVATRegistered, PaysTax
-- IncorporationDate, IncorporationState, FinancialYearEndDay/Month
-- BusinessCards (same as Contact), ClientOwner, ClientManager, UserDefinedIdentifier
-- AccountingDetail (similar to Contact), LastModifiedDateTime

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS user_defined_identifier text,
  ADD COLUMN IF NOT EXISTS client_owner_email text,
  ADD COLUMN IF NOT EXISTS client_manager_email text,
  ADD COLUMN IF NOT EXISTS client_owner_id uuid REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS client_manager_id uuid REFERENCES team_members(id),
  ADD COLUMN IF NOT EXISTS restriction_level text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS business_card_key text,
  ADD COLUMN IF NOT EXISTS websites text[],
  ADD COLUMN IF NOT EXISTS email_addresses text[],
  ADD COLUMN IF NOT EXISTS phone_numbers jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS addresses jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS facebook_link text,
  ADD COLUMN IF NOT EXISTS linkedin_link text,
  ADD COLUMN IF NOT EXISTS twitter_link text,
  ADD COLUMN IF NOT EXISTS skype_link text,
  ADD COLUMN IF NOT EXISTS entity_description text,
  ADD COLUMN IF NOT EXISTS gst_basis text,
  ADD COLUMN IF NOT EXISTS gst_period text,
  ADD COLUMN IF NOT EXISTS sales_tax_basis text,
  ADD COLUMN IF NOT EXISTS sales_tax_period text,
  ADD COLUMN IF NOT EXISTS prepare_gst boolean,
  ADD COLUMN IF NOT EXISTS organization_valuation numeric,
  ADD COLUMN IF NOT EXISTS revenue_model text,
  ADD COLUMN IF NOT EXISTS sells text,
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS registration_number_type text,
  ADD COLUMN IF NOT EXISTS karbon_modified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS karbon_url text;

-- Add comments for documentation
COMMENT ON COLUMN organizations.user_defined_identifier IS 'Karbon: UserDefinedIdentifier - Custom client identifier';
COMMENT ON COLUMN organizations.client_owner_email IS 'Karbon: ClientOwner email address';
COMMENT ON COLUMN organizations.client_manager_email IS 'Karbon: ClientManager email address';
COMMENT ON COLUMN organizations.restriction_level IS 'Karbon: RestrictionLevel - Public/Private/etc.';
COMMENT ON COLUMN organizations.avatar_url IS 'Karbon: AvatarUrl';
COMMENT ON COLUMN organizations.business_card_key IS 'Karbon: BusinessCards.BusinessCardKey';
COMMENT ON COLUMN organizations.websites IS 'Karbon: BusinessCards.WebSites[]';
COMMENT ON COLUMN organizations.email_addresses IS 'Karbon: BusinessCards.EmailAddresses[]';
COMMENT ON COLUMN organizations.phone_numbers IS 'Karbon: BusinessCards.PhoneNumbers[] - JSON array';
COMMENT ON COLUMN organizations.addresses IS 'Karbon: BusinessCards.Addresses[] - JSON array';
COMMENT ON COLUMN organizations.entity_description IS 'Karbon: EntityDescription.Text';
COMMENT ON COLUMN organizations.gst_basis IS 'Karbon: AccountingDetail.GstBasis';
COMMENT ON COLUMN organizations.gst_period IS 'Karbon: AccountingDetail.GstPeriod';
COMMENT ON COLUMN organizations.sales_tax_basis IS 'Karbon: AccountingDetail.SalesTaxBasis';
COMMENT ON COLUMN organizations.sales_tax_period IS 'Karbon: AccountingDetail.SalesTaxPeriod';
COMMENT ON COLUMN organizations.prepare_gst IS 'Karbon: AccountingDetail.PrepareGST';
COMMENT ON COLUMN organizations.organization_valuation IS 'Karbon: AccountingDetail.OrganizationValuation';
COMMENT ON COLUMN organizations.revenue_model IS 'Karbon: AccountingDetail.RevenueModel';
COMMENT ON COLUMN organizations.sells IS 'Karbon: AccountingDetail.Sells';
COMMENT ON COLUMN organizations.registration_number IS 'Karbon: AccountingDetail.RegistrationNumbers.RegistrationNumber (EIN/TaxID)';
COMMENT ON COLUMN organizations.registration_number_type IS 'Karbon: AccountingDetail.RegistrationNumbers.Type';
COMMENT ON COLUMN organizations.karbon_modified_at IS 'Karbon: LastModifiedDateTime';

-- =====================================================
-- 3. WORK_ITEMS TABLE - Align with Karbon WorkItem API
-- =====================================================
-- Karbon WorkItem fields from API:
-- WorkItemKey, Title, Description, ClientKey, ClientName, ClientType, ClientUserDefinedIdentifier
-- RelatedClientGroupKey, ClientGroupKey, RelatedClientGroupName
-- AssigneeKey, AssigneeName, AssigneeEmailAddress
-- StartDate, DueDate, DeadlineDate, CompletedDate, ToDoPeriod
-- WorkType, WorkStatus, PrimaryStatus, SecondaryStatus
-- WorkTemplateKey, WorkTemplateTitle, WorkScheduleKey
-- FeeSettings (FeeType, FeeValue), ClientTaskRecipient
-- LastModifiedDateTime

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS client_user_defined_identifier text,
  ADD COLUMN IF NOT EXISTS related_client_group_key text,
  ADD COLUMN IF NOT EXISTS related_client_group_name text,
  ADD COLUMN IF NOT EXISTS assignee_key text,
  ADD COLUMN IF NOT EXISTS assignee_name text,
  ADD COLUMN IF NOT EXISTS assignee_email text,
  ADD COLUMN IF NOT EXISTS deadline_date date,
  ADD COLUMN IF NOT EXISTS todo_period date,
  ADD COLUMN IF NOT EXISTS primary_status text,
  ADD COLUMN IF NOT EXISTS secondary_status text,
  ADD COLUMN IF NOT EXISTS work_template_key text,
  ADD COLUMN IF NOT EXISTS work_template_title text,
  ADD COLUMN IF NOT EXISTS work_schedule_key text,
  ADD COLUMN IF NOT EXISTS fee_type text,
  ADD COLUMN IF NOT EXISTS fee_value numeric,
  ADD COLUMN IF NOT EXISTS client_task_recipient text,
  ADD COLUMN IF NOT EXISTS karbon_modified_at timestamp with time zone;

-- Add comments for documentation
COMMENT ON COLUMN work_items.client_name IS 'Karbon: ClientName - Denormalized client name';
COMMENT ON COLUMN work_items.client_user_defined_identifier IS 'Karbon: ClientUserDefinedIdentifier';
COMMENT ON COLUMN work_items.related_client_group_key IS 'Karbon: RelatedClientGroupKey';
COMMENT ON COLUMN work_items.related_client_group_name IS 'Karbon: RelatedClientGroupName';
COMMENT ON COLUMN work_items.assignee_key IS 'Karbon: AssigneeKey - Karbon user key';
COMMENT ON COLUMN work_items.assignee_name IS 'Karbon: AssigneeName';
COMMENT ON COLUMN work_items.assignee_email IS 'Karbon: AssigneeEmailAddress';
COMMENT ON COLUMN work_items.deadline_date IS 'Karbon: DeadlineDate - Hard deadline vs DueDate';
COMMENT ON COLUMN work_items.todo_period IS 'Karbon: ToDoPeriod';
COMMENT ON COLUMN work_items.primary_status IS 'Karbon: PrimaryStatus - First part of WorkStatus';
COMMENT ON COLUMN work_items.secondary_status IS 'Karbon: SecondaryStatus - Second part of WorkStatus';
COMMENT ON COLUMN work_items.work_template_key IS 'Karbon: WorkTemplateKey';
COMMENT ON COLUMN work_items.work_template_title IS 'Karbon: WorkTemplateTitle';
COMMENT ON COLUMN work_items.work_schedule_key IS 'Karbon: WorkScheduleKey';
COMMENT ON COLUMN work_items.fee_type IS 'Karbon: FeeSettings.FeeType - FixedFee/Hourly/etc.';
COMMENT ON COLUMN work_items.fee_value IS 'Karbon: FeeSettings.FeeValue';
COMMENT ON COLUMN work_items.client_task_recipient IS 'Karbon: ClientTaskRecipient';
COMMENT ON COLUMN work_items.karbon_modified_at IS 'Karbon: LastModifiedDateTime';

-- =====================================================
-- 4. TEAM_MEMBERS TABLE - Align with Karbon User API
-- =====================================================
-- Karbon User fields from API:
-- Id (UserKey), Name, EmailAddress, BillableRate, CapacityMinutesPerWeek
-- Permissions[], Roles[], Teams[]

ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS billable_rate numeric,
  ADD COLUMN IF NOT EXISTS capacity_minutes_per_week integer,
  ADD COLUMN IF NOT EXISTS permissions text[],
  ADD COLUMN IF NOT EXISTS roles text[],
  ADD COLUMN IF NOT EXISTS teams text[],
  ADD COLUMN IF NOT EXISTS karbon_modified_at timestamp with time zone;

COMMENT ON COLUMN team_members.billable_rate IS 'Karbon: BillableRate';
COMMENT ON COLUMN team_members.capacity_minutes_per_week IS 'Karbon: CapacityMinutesPerWeek';
COMMENT ON COLUMN team_members.permissions IS 'Karbon: Permissions[] - User/Admin/etc.';
COMMENT ON COLUMN team_members.roles IS 'Karbon: Roles[] - Accountant/Bookkeeper/etc.';
COMMENT ON COLUMN team_members.teams IS 'Karbon: Teams[] - Team memberships';

-- =====================================================
-- 5. CLIENT_GROUPS TABLE - Align with Karbon ClientGroup API
-- =====================================================

ALTER TABLE client_groups
  ADD COLUMN IF NOT EXISTS user_defined_identifier text,
  ADD COLUMN IF NOT EXISTS client_owner_email text,
  ADD COLUMN IF NOT EXISTS client_manager_email text,
  ADD COLUMN IF NOT EXISTS restriction_level text,
  ADD COLUMN IF NOT EXISTS karbon_modified_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS karbon_url text;

-- =====================================================
-- 6. CREATE INDEXES FOR KARBON KEYS (for fast lookups during sync)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_contacts_karbon_key ON contacts(karbon_contact_key) WHERE karbon_contact_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_karbon_modified ON contacts(karbon_modified_at) WHERE karbon_modified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_linked_org_key ON contacts(linked_organization_key) WHERE linked_organization_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_organizations_karbon_key ON organizations(karbon_organization_key) WHERE karbon_organization_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_karbon_modified ON organizations(karbon_modified_at) WHERE karbon_modified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_items_karbon_key ON work_items(karbon_work_item_key) WHERE karbon_work_item_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_modified ON work_items(karbon_modified_at) WHERE karbon_modified_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_karbon_client_key ON work_items(karbon_client_key) WHERE karbon_client_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_items_assignee_key ON work_items(assignee_key) WHERE assignee_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_members_karbon_key ON team_members(karbon_user_key) WHERE karbon_user_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_client_groups_karbon_key ON client_groups(karbon_client_group_key) WHERE karbon_client_group_key IS NOT NULL;

-- =====================================================
-- 7. CREATE FUNCTION TO LINK WORK ITEMS TO CLIENTS
-- =====================================================

CREATE OR REPLACE FUNCTION link_work_item_to_client()
RETURNS TRIGGER AS $$
BEGIN
  -- Link to contact if client_type is Contact
  IF NEW.client_type = 'Contact' AND NEW.karbon_client_key IS NOT NULL THEN
    SELECT id INTO NEW.contact_id 
    FROM contacts 
    WHERE karbon_contact_key = NEW.karbon_client_key;
  END IF;
  
  -- Link to organization if client_type is Organization
  IF NEW.client_type = 'Organization' AND NEW.karbon_client_key IS NOT NULL THEN
    SELECT id INTO NEW.organization_id 
    FROM organizations 
    WHERE karbon_organization_key = NEW.karbon_client_key;
  END IF;
  
  -- Link to client group
  IF NEW.related_client_group_key IS NOT NULL THEN
    SELECT id INTO NEW.client_group_id 
    FROM client_groups 
    WHERE karbon_client_group_key = NEW.related_client_group_key;
  END IF;
  
  -- Link to assignee (team member)
  IF NEW.assignee_key IS NOT NULL THEN
    SELECT id INTO NEW.assignee_id 
    FROM team_members 
    WHERE karbon_user_key = NEW.assignee_key;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_link_work_item_to_client ON work_items;
CREATE TRIGGER trg_link_work_item_to_client
  BEFORE INSERT OR UPDATE ON work_items
  FOR EACH ROW
  EXECUTE FUNCTION link_work_item_to_client();

-- =====================================================
-- 8. CREATE FUNCTION TO LINK CONTACTS TO ORGANIZATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION link_contact_to_organization()
RETURNS TRIGGER AS $$
DECLARE
  org_id uuid;
BEGIN
  -- Link contact to organization via linked_organization_key
  IF NEW.linked_organization_key IS NOT NULL THEN
    SELECT id INTO org_id 
    FROM organizations 
    WHERE karbon_organization_key = NEW.linked_organization_key;
    
    -- If organization found, create/update contact_organizations link
    IF org_id IS NOT NULL THEN
      INSERT INTO contact_organizations (contact_id, organization_id, role_or_title, is_primary_contact)
      VALUES (NEW.id, org_id, NEW.role_or_title, true)
      ON CONFLICT (contact_id, organization_id) 
      DO UPDATE SET role_or_title = EXCLUDED.role_or_title;
    END IF;
  END IF;
  
  -- Link to client owner team member
  IF NEW.client_owner_email IS NOT NULL THEN
    SELECT id INTO NEW.client_owner_id 
    FROM team_members 
    WHERE email = NEW.client_owner_email;
  END IF;
  
  -- Link to client manager team member
  IF NEW.client_manager_email IS NOT NULL THEN
    SELECT id INTO NEW.client_manager_id 
    FROM team_members 
    WHERE email = NEW.client_manager_email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_link_contact_to_organization ON contacts;
CREATE TRIGGER trg_link_contact_to_organization
  AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION link_contact_to_organization();

-- =====================================================
-- 9. CREATE FUNCTION TO LINK ORGANIZATIONS TO TEAM MEMBERS
-- =====================================================

CREATE OR REPLACE FUNCTION link_organization_to_team_members()
RETURNS TRIGGER AS $$
BEGIN
  -- Link to client owner team member
  IF NEW.client_owner_email IS NOT NULL THEN
    SELECT id INTO NEW.client_owner_id 
    FROM team_members 
    WHERE email = NEW.client_owner_email;
  END IF;
  
  -- Link to client manager team member
  IF NEW.client_manager_email IS NOT NULL THEN
    SELECT id INTO NEW.client_manager_id 
    FROM team_members 
    WHERE email = NEW.client_manager_email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_link_organization_to_team_members ON organizations;
CREATE TRIGGER trg_link_organization_to_team_members
  BEFORE INSERT OR UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION link_organization_to_team_members();

-- =====================================================
-- 10. BATCH LINK EXISTING RECORDS
-- =====================================================

-- Link existing work items to contacts
UPDATE work_items wi
SET contact_id = c.id
FROM contacts c
WHERE wi.client_type = 'Contact'
  AND wi.karbon_client_key = c.karbon_contact_key
  AND wi.contact_id IS NULL;

-- Link existing work items to organizations
UPDATE work_items wi
SET organization_id = o.id
FROM organizations o
WHERE wi.client_type = 'Organization'
  AND wi.karbon_client_key = o.karbon_organization_key
  AND wi.organization_id IS NULL;

-- Link existing work items to client groups
UPDATE work_items wi
SET client_group_id = cg.id
FROM client_groups cg
WHERE wi.related_client_group_key = cg.karbon_client_group_key
  AND wi.client_group_id IS NULL;

-- Link existing work items to assignees
UPDATE work_items wi
SET assignee_id = tm.id
FROM team_members tm
WHERE wi.assignee_key = tm.karbon_user_key
  AND wi.assignee_id IS NULL;

-- =====================================================
-- 11. CREATE VIEW FOR COMPLETE WORK ITEM DATA
-- =====================================================

DROP VIEW IF EXISTS v_work_items_complete;
CREATE VIEW v_work_items_complete AS
SELECT 
  wi.*,
  -- Contact info
  c.first_name AS contact_first_name,
  c.last_name AS contact_last_name,
  c.full_name AS contact_full_name,
  c.primary_email AS contact_email,
  c.karbon_url AS contact_karbon_url,
  -- Organization info
  o.name AS organization_name,
  o.primary_email AS organization_email,
  o.karbon_url AS organization_karbon_url,
  -- Client group info
  cg.name AS client_group_name,
  -- Assignee info
  tm.full_name AS assignee_full_name,
  tm.email AS assignee_email_full,
  -- Client owner/manager info
  co.full_name AS client_owner_full_name,
  cm.full_name AS client_manager_full_name
FROM work_items wi
LEFT JOIN contacts c ON wi.contact_id = c.id
LEFT JOIN organizations o ON wi.organization_id = o.id
LEFT JOIN client_groups cg ON wi.client_group_id = cg.id
LEFT JOIN team_members tm ON wi.assignee_id = tm.id
LEFT JOIN team_members co ON wi.client_owner_id = co.id
LEFT JOIN team_members cm ON wi.client_manager_id = cm.id;

-- =====================================================
-- 12. GENERATE KARBON URLS FOR ALL RECORDS
-- =====================================================

-- Store the base URL in app_settings if not exists
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_settings (key, value) 
VALUES ('karbon_base_url', 'https://app2.karbonhq.com/4mTyp9lLRWTC#')
ON CONFLICT (key) DO NOTHING;

-- Update karbon_url for contacts
UPDATE contacts 
SET karbon_url = 'https://app2.karbonhq.com/4mTyp9lLRWTC#/contacts/' || karbon_contact_key
WHERE karbon_contact_key IS NOT NULL AND karbon_url IS NULL;

-- Update karbon_url for organizations
UPDATE organizations 
SET karbon_url = 'https://app2.karbonhq.com/4mTyp9lLRWTC#/organizations/' || karbon_organization_key
WHERE karbon_organization_key IS NOT NULL AND karbon_url IS NULL;

-- Update karbon_url for work items
UPDATE work_items 
SET karbon_url = 'https://app2.karbonhq.com/4mTyp9lLRWTC#/work/' || karbon_work_item_key
WHERE karbon_work_item_key IS NOT NULL AND karbon_url IS NULL;

-- =====================================================
-- COMPLETE - Schema now aligned with Karbon API v3
-- =====================================================
