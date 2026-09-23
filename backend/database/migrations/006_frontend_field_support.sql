-- Additive columns so every value the Manufacturer frontend collects can be
-- stored and returned exactly as the user entered it. Safe to run repeatedly.
-- Run after XY_Database_Schema.sql, 004 and 005.

-- Account form: country may be "Other" (no ISO code) and capacity is free text
-- such as "10000 units/month".
ALTER TABLE organization_profiles
  ADD COLUMN IF NOT EXISTS country_name TEXT,
  ADD COLUMN IF NOT EXISTS production_capacity_label TEXT;

-- Profile wizard, Location step: country label and the "Pin on map" value.
ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS country_name TEXT,
  ADD COLUMN IF NOT EXISTS map_pin TEXT;

-- Profile wizard, Certifications step: the chosen document's file name.
ALTER TABLE organization_certifications
  ADD COLUMN IF NOT EXISTS document_file_name TEXT;

-- Profile wizard, FAQ step: keep each manufacturer's own FAQ order.
ALTER TABLE manufacturer_faq_answers
  ADD COLUMN IF NOT EXISTS display_order SMALLINT NOT NULL DEFAULT 0;

-- Lets the frontend's personal (non-Clerk-organization) manufacturer workspace
-- be found quickly.
CREATE INDEX IF NOT EXISTS ix_organizations_created_by_type
  ON organizations (created_by_user_id, organization_type);
