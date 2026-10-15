-- 017: Admin approval of submitted manufacturer company details (staging), separate from
-- profile completion. Additive and safe to run repeatedly.
--
-- * manufacturer_submissions holds the basic company details a manufacturer submits (name,
--   category, country, capacity, company contact) until an admin decides. The main tables
--   (organizations / organization_profiles) stay the source of truth: they change only when a
--   submission is approved, in one transaction, once (applied_at).
-- * Approval status of a company = manufacturer_onboarding.status ('approved' = approved).
--   Profile completion = admin_manufacturer_overview.completeness (the 14 required items).
--   Visionary visibility / booking need both (rules in backend app/core/eligibility.py).
-- * The overview view below is 008's, unchanged except: review_status shows pending
--   submissions as SUBMITTED and 'rejected' as the new REJECTED status, and company_name shows
--   a new company's submitted name while it awaits approval (admin lists only).

CREATE TABLE IF NOT EXISTS manufacturer_submissions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the submitter's own manufacturer organization (their workspace while the review runs)
  organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- the company the details are for: the workspace itself (new company / update) or the
  -- existing company the user selected (claim of a seeded / imported company)
  target_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  selected_company_id    UUID REFERENCES organizations(id) ON DELETE SET NULL,
  submitted_by_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                   TEXT NOT NULL CHECK (kind IN ('new_company', 'claim', 'update')),
  payload                JSONB NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  reviewed_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TIMESTAMPTZ,
  review_feedback        TEXT,
  applied_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One open submission per user: a retry or a correction updates it instead of adding rows.
-- (019 replaces this index so update requests are counted separately; migrations are re-run in
-- order, so the original is only created on a database that does not have 019's yet.)
DO $$
BEGIN
  IF to_regclass('uq_manufacturer_submissions_open_v2') IS NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_manufacturer_submissions_open
      ON manufacturer_submissions (submitted_by_user_id) WHERE status IN ('pending', 'changes_requested');
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_manufacturer_submissions_target
  ON manufacturer_submissions (target_organization_id, status);
CREATE INDEX IF NOT EXISTS ix_manufacturer_submissions_org
  ON manufacturer_submissions (organization_id);
ALTER TABLE manufacturer_submissions ENABLE ROW LEVEL SECURITY;

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
         -- a new company awaiting approval is listed under the name it was submitted with
         -- (the main record keeps its value until approval)
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
    -- a submission awaiting the admin decides the queue status, even for an approved company
    -- (staged changes to an approved company keep the company itself approved)
    WHEN EXISTS (SELECT 1 FROM manufacturer_submissions s
                 WHERE s.target_organization_id = base.organization_id AND s.status = 'pending') THEN 'SUBMITTED'
    WHEN EXISTS (SELECT 1 FROM manufacturer_submissions s
                 WHERE s.target_organization_id = base.organization_id AND s.status = 'changes_requested')
      THEN 'NEEDS_CORRECTION'
    WHEN NOT has_onboarding OR onboarding_raw_status = 'draft' THEN 'NOT_STARTED'
    WHEN onboarding_raw_status = 'in_progress' THEN 'IN_PROGRESS'
    WHEN onboarding_raw_status IN ('submitted', 'under_review') THEN 'SUBMITTED'
    WHEN onboarding_raw_status = 'changes_requested' THEN 'NEEDS_CORRECTION'
    WHEN onboarding_raw_status = 'rejected' THEN 'REJECTED'
    WHEN onboarding_raw_status = 'approved' THEN 'REVIEWED'
  END AS review_status
FROM base;
