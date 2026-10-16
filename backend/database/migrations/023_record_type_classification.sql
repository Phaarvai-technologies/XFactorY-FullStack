-- 023: Demo vs real manufacturer data. Additive, re-runnable.
--
-- Reuses what exists: organizations.record_type (008: 'REAL' | 'DEMO' | 'TEST', NOT NULL,
-- DEFAULT 'REAL') is the classification. No new column is added. Meaning:
--   REAL  real manufacturer data. The only records Visionaries can find, view or book
--         (app/core/eligibility.py) and the only ones counted in real analytics.
--   DEMO  demonstration data. Kept and inspectable by admins; never shown to Visionaries,
--         never listed in onboarding company lookup for other users.
--   TEST  internal test data (existing meaning, same exclusions as DEMO).
-- It is independent of approval (manufacturer_onboarding.status), verification_status,
-- onboarding_source, entry_source, profile completeness and ownership (memberships).
--
-- Who sets it: self-registration -> column default REAL; CSV import / research seed files /
-- Admin Entry -> explicit REAL or DEMO; changes afterwards -> administrators / operators only,
-- with a reason, recorded in admin_change_history.
--
-- This migration only (1) re-asserts the column default and constraint, (2) adds the missing
-- organizations.source_ref column where it is absent (see below), and (3) adds the log
-- used by the one-time classification of existing records (database/backfills/023_*), so that
-- run is reviewable, cannot be applied twice, and can be rolled back exactly.

ALTER TABLE organizations ALTER COLUMN record_type SET DEFAULT 'REAL';

-- organizations.source_ref exists in the production / development databases but was never created
-- by these migrations (schema drift). The research seed files store their stable research id there
-- ('india_mfr_research:<id>') as their re-run key, and the one-time classification excludes those
-- rows. No-op where the column already exists.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS source_ref TEXT;
CREATE INDEX IF NOT EXISTS ix_organizations_source_ref ON organizations (source_ref) WHERE source_ref IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_record_type') THEN
    ALTER TABLE organizations ADD CONSTRAINT chk_org_record_type CHECK (record_type IN ('REAL', 'DEMO', 'TEST'));
  END IF;
END $$;
COMMENT ON COLUMN organizations.record_type IS
  'REAL = real manufacturer data (visible to Visionaries when approved and complete); DEMO / TEST = never shown to Visionaries. Independent of approval, onboarding source and ownership. Changed only by administrators / operators (audited in admin_change_history).';

CREATE TABLE IF NOT EXISTS record_type_classification_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_label        TEXT NOT NULL,                 -- e.g. '023_existing_manufacturers_demo'
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  old_record_type  TEXT NOT NULL,
  new_record_type  TEXT NOT NULL,
  rule             TEXT NOT NULL,                 -- why this record was in scope
  snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- status / approval / owners at apply time
  applied_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at   TIMESTAMPTZ,
  CONSTRAINT uq_record_type_classification UNIQUE (run_label, organization_id)
);
ALTER TABLE record_type_classification_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ix_record_type_classification_org ON record_type_classification_log (organization_id);
