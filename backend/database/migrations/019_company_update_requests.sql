-- 019: Admin-reviewed update requests for an existing company managed by someone else.
-- Additive and safe to run repeatedly. Reuses manufacturer_submissions (017) as the staging table.
--
-- * kind 'update_request': a signed-in user proposes changes to a company they do not manage.
--   target_organization_id = that company (database id), organization_id = the requester's own
--   workspace, submitted_by_user_id = the requester. The main record is untouched until an admin
--   approves, and approval never changes ownership or memberships.
-- * source            - where the request came from; set by the backend ('web_dashboard').
-- * base_snapshot     - the company's values when the request was submitted (to show what changed
--                       on the company since then).
-- * original_payload  - the values exactly as the requester submitted them (payload may be
--                       edited by the reviewing admin).
-- * admin_notes       - internal verification / contact notes (never shown to the requester).
-- * applied_changes   - per field {from, to} actually written on approval.
-- * manufacturer_submission_events - audit trail: submitted, resubmitted, edited, note, decision.

ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_kind_check;
ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_kind_ck;
ALTER TABLE manufacturer_submissions ADD CONSTRAINT manufacturer_submissions_kind_ck
  CHECK (kind IN ('new_company', 'claim', 'update', 'update_request'));

ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'web_dashboard';
ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_source_ck;
ALTER TABLE manufacturer_submissions ADD CONSTRAINT manufacturer_submissions_source_ck
  CHECK (source IN ('web_dashboard'));
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS base_snapshot JSONB;
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS original_payload JSONB;
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS applied_changes JSONB;

-- One open company submission per user (unchanged rule), now excluding update requests, which
-- are limited to one open request per user AND company (a retry updates it, never adds rows).
DROP INDEX IF EXISTS uq_manufacturer_submissions_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_manufacturer_submissions_open_v2
  ON manufacturer_submissions (submitted_by_user_id)
  WHERE status IN ('pending', 'changes_requested') AND kind <> 'update_request';
CREATE UNIQUE INDEX IF NOT EXISTS uq_manufacturer_update_requests_open
  ON manufacturer_submissions (submitted_by_user_id, target_organization_id)
  WHERE status IN ('pending', 'changes_requested') AND kind = 'update_request';

CREATE TABLE IF NOT EXISTS manufacturer_submission_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL REFERENCES manufacturer_submissions(id) ON DELETE CASCADE,
  event          TEXT NOT NULL CHECK (event IN ('submitted', 'resubmitted', 'edited', 'note', 'decision')),
  actor_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role     TEXT NOT NULL CHECK (actor_role IN ('requester', 'admin')),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_manufacturer_submission_events_submission
  ON manufacturer_submission_events (submission_id, created_at);
ALTER TABLE manufacturer_submission_events ENABLE ROW LEVEL SECURITY;

-- Review status in the admin lists: a pending update request puts the company in the review
-- queue (SUBMITTED); one waiting for the REQUESTER's corrections does not mark the company itself
-- as "Needs correction". Otherwise identical to 017's view.
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
  SELECT o.id AS organization_id,
         COALESCE((SELECT s.payload->>'companyName' FROM manufacturer_submissions s
                   WHERE s.target_organization_id = o.id AND s.kind = 'new_company'
                     AND s.status IN ('pending', 'changes_requested')
                   ORDER BY s.updated_at DESC LIMIT 1), o.display_name) AS company_name,
         o.created_at AS registered_at,
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
    WHEN EXISTS (SELECT 1 FROM manufacturer_submissions s
                 WHERE s.target_organization_id = base.organization_id AND s.status = 'pending') THEN 'SUBMITTED'
    WHEN EXISTS (SELECT 1 FROM manufacturer_submissions s
                 WHERE s.target_organization_id = base.organization_id AND s.status = 'changes_requested'
                   AND s.kind <> 'update_request')
      THEN 'NEEDS_CORRECTION'
    WHEN NOT has_onboarding OR onboarding_raw_status = 'draft' THEN 'NOT_STARTED'
    WHEN onboarding_raw_status = 'in_progress' THEN 'IN_PROGRESS'
    WHEN onboarding_raw_status IN ('submitted', 'under_review') THEN 'SUBMITTED'
    WHEN onboarding_raw_status = 'changes_requested' THEN 'NEEDS_CORRECTION'
    WHEN onboarding_raw_status = 'rejected' THEN 'REJECTED'
    WHEN onboarding_raw_status = 'approved' THEN 'REVIEWED'
  END AS review_status
FROM base;
