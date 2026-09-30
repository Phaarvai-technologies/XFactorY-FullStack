-- Admin Dashboard MVP (XY-ADMIN-01 .. 10). Additive and safe to run repeatedly.
-- Run after 007_form_progress.sql.

-- ---------------------------------------------------------------------------
-- XY-ADMIN-08 / section 2: fields on the manufacturer record (organizations).
-- onboarding_status and profile_completion_percentage are NOT new columns:
-- they come from manufacturer_onboarding.status and the admin completeness
-- calculation (view below), so there is one source of truth.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'REAL',
  ADD COLUMN IF NOT EXISTS entry_source TEXT NOT NULL DEFAULT 'MANUFACTURER',
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS assigned_admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT chk_org_record_type CHECK (record_type IN ('REAL', 'DEMO', 'TEST'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE organizations ADD CONSTRAINT chk_org_entry_source
    CHECK (entry_source IN ('MANUFACTURER', 'ADMIN_ASSISTED', 'IMPORTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS ix_organizations_admin_list
  ON organizations (organization_type, is_archived, record_type, updated_at DESC);

-- Last activity for XY-ADMIN-03 / 10 (updated at most every few minutes per user).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Admin Change History (section 2): every admin change to a manufacturer.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_change_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  field_changed   TEXT NOT NULL,
  old_value       TEXT,
  new_value       TEXT,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_admin_change_history_manufacturer
  ON admin_change_history (manufacturer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Internal Notes (section 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_internal_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  admin_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  note            TEXT NOT NULL CHECK (length(btrim(note)) > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_admin_internal_notes_manufacturer
  ON admin_internal_notes (manufacturer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- XY-ADMIN-03 / 10: account suspensions and failed operations per user.
-- Never stores passwords, OTP codes, tokens or other secrets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  clerk_user_id TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('error', 'account_status')),
  method       TEXT,
  path         TEXT,
  status_code  SMALLINT,
  detail       TEXT,
  request_id   TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_user_activity_events_user
  ON user_activity_events (clerk_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_user_activity_events_recent
  ON user_activity_events (kind, created_at DESC);

ALTER TABLE admin_change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_internal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_events ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- One row per manufacturer with everything the admin lists, filters, queue and
-- analytics need. Completeness (XY-ADMIN-09 formula):
--   required fields completed / applicable required fields x 100
-- The 14 required items are the r_* columns; the backend maps them to labels.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW admin_manufacturer_overview AS
WITH owner AS (
  SELECT DISTINCT ON (m.organization_id)
         m.organization_id, u.id AS user_id, u.first_name, u.last_name, u.email, u.phone,
         u.date_of_birth, u.last_seen_at, u.status AS user_status
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.status = 'active'
  ORDER BY m.organization_id, (m.membership_role = 'owner') DESC, m.created_at
),
hq AS (
  SELECT DISTINCT ON (organization_id) organization_id, address_line1, city, state_province, country_name
  FROM facilities WHERE is_headquarters AND status <> 'suspended'
  ORDER BY organization_id, created_at
),
certs AS (SELECT organization_id, count(*) AS n FROM organization_certifications GROUP BY organization_id),
infra AS (SELECT organization_id, count(*) FILTER (WHERE btrim(coalesce(text_value, '')) <> '') AS n
          FROM manufacturer_infrastructure GROUP BY organization_id),
faqs AS (SELECT organization_id, count(*) AS n FROM manufacturer_faq_answers GROUP BY organization_id),
listings AS (
  SELECT m.organization_id, count(*) AS n,
         (array_agg(m.name ORDER BY m.created_at DESC))[1] AS latest_type
  FROM machines m
  WHERE m.status <> 'archived'
    AND NOT EXISTS (SELECT 1 FROM manufacturer_form_progress p
                    WHERE p.record_id = m.id AND p.form_key = 'machinery' AND p.status = 'draft')
  GROUP BY m.organization_id
),
progress AS (
  SELECT organization_id, max(updated_at) AS last_step_at
  FROM manufacturer_form_progress GROUP BY organization_id
),
base AS (
  SELECT o.id AS organization_id, o.display_name AS company_name, o.created_at AS registered_at,
         o.record_type, o.entry_source, o.referral_source, o.assigned_admin_user_id,
         o.is_archived, o.archived_at,
         owner.user_id, owner.first_name, owner.last_name, owner.email AS user_email,
         owner.phone AS user_phone, owner.last_seen_at, owner.user_status,
         op.contact_email, op.contact_phone, op.company_category AS industry,
         coalesce(nullif(hq.country_name, ''), op.country_name) AS country,
         hq.city, hq.address_line1,
         listings.latest_type AS major_process, coalesce(listings.n, 0) AS listing_count,
         coalesce(certs.n, 0) AS cert_count, coalesce(infra.n, 0) AS infra_count, coalesce(faqs.n, 0) AS faq_count,
         mo.organization_id IS NOT NULL AS has_onboarding, mo.status AS onboarding_raw_status,
         mo.current_step, mo.submitted_at, mo.reviewed_at, mo.created_at AS onboarding_started_at,
         progress.last_step_at,
         GREATEST(o.updated_at, op.updated_at, mo.updated_at, progress.last_step_at) AS last_updated,
         -- the 14 required items
         btrim(coalesce(owner.first_name, '')) <> '' AS r_first_name,
         btrim(coalesce(owner.last_name, '')) <> '' AS r_last_name,
         (btrim(coalesce(op.contact_email::text, '')) <> '' OR btrim(coalesce(op.contact_phone, '')) <> '') AS r_contact,
         owner.date_of_birth IS NOT NULL AS r_dob,
         (mo.personal_information_completed IS TRUE AND btrim(coalesce(o.display_name, '')) <> '') AS r_company_name,
         btrim(coalesce(op.company_category, '')) <> '' AS r_industry,
         btrim(coalesce(op.country_name, '')) <> '' AS r_account_country,
         btrim(coalesce(op.about_company, '')) <> '' AS r_about,
         btrim(coalesce(hq.address_line1, '')) <> '' AS r_address,
         btrim(coalesce(hq.city, '')) <> '' AS r_city,
         btrim(coalesce(hq.country_name, '')) <> '' AS r_location_country,
         coalesce(certs.n, 0) > 0 AS r_certification,
         coalesce(infra.n, 0) > 0 AS r_infrastructure,
         coalesce(faqs.n, 0) > 0 AS r_faq
  FROM organizations o
  LEFT JOIN owner ON owner.organization_id = o.id
  LEFT JOIN organization_profiles op ON op.organization_id = o.id
  LEFT JOIN hq ON hq.organization_id = o.id
  LEFT JOIN certs ON certs.organization_id = o.id
  LEFT JOIN infra ON infra.organization_id = o.id
  LEFT JOIN faqs ON faqs.organization_id = o.id
  LEFT JOIN listings ON listings.organization_id = o.id
  LEFT JOIN progress ON progress.organization_id = o.id
  LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
  WHERE o.organization_type = 'manufacturer'
)
SELECT base.*,
  (r_first_name::int + r_last_name::int + r_contact::int + r_dob::int + r_company_name::int
   + r_industry::int + r_account_country::int + r_about::int + r_address::int + r_city::int
   + r_location_country::int + r_certification::int + r_infrastructure::int + r_faq::int) AS required_done,
  14 AS required_total,
  round((r_first_name::int + r_last_name::int + r_contact::int + r_dob::int + r_company_name::int
   + r_industry::int + r_account_country::int + r_about::int + r_address::int + r_city::int
   + r_location_country::int + r_certification::int + r_infrastructure::int + r_faq::int) * 100.0 / 14)::int
    AS completeness,
  CASE
    WHEN NOT has_onboarding OR onboarding_raw_status = 'draft' THEN 'NOT_STARTED'
    WHEN onboarding_raw_status = 'in_progress' THEN 'IN_PROGRESS'
    WHEN onboarding_raw_status IN ('submitted', 'under_review') THEN 'SUBMITTED'
    WHEN onboarding_raw_status IN ('changes_requested', 'rejected') THEN 'NEEDS_CORRECTION'
    WHEN onboarding_raw_status = 'approved' THEN 'REVIEWED'
  END AS review_status
FROM base;
