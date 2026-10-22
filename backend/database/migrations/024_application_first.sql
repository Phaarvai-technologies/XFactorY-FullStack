-- 024: approval-first manufacturer onboarding (app/manufacturer_applications.py).
-- Additive and safe to run repeatedly. Existing rows are not changed.
--
--   * users.personal_email       - the applicant's personal email from the onboarding form. The
--                                  sign-in email (users.email, from Clerk) and the company's contact
--                                  details (organization_profiles) are separate and never overwritten.
--   * kind 'join_company'        - one applicant's onboarding to an EXISTING company (reviewed per
--                                  applicant; the company's own approval and members are untouched).
--   * correction_fields          - the fields the admin asked the applicant to correct; only these
--                                  may change on resubmission.
--   * event 'membership_granted' - history row when an approved applicant is linked to a company.
--   * manufacturer_application_drafts - the applicant's unsent form (one per user); never reviewed,
--                                  never grants access.

ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email CITEXT;

ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_kind_ck;
ALTER TABLE manufacturer_submissions ADD CONSTRAINT manufacturer_submissions_kind_ck
  CHECK (kind IN ('new_company', 'claim', 'update', 'update_request', 'join_company'));

ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS correction_fields TEXT[];

ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_event_ck;
ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_event_ck
  CHECK (event IN ('submitted', 'resubmitted', 'edited', 'note', 'decision', 'imported', 'merged',
                   'source_backfilled', 'created', 'membership_granted'));

CREATE TABLE IF NOT EXISTS manufacturer_application_drafts (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Applicant / admin lookups of applications by company and by notification.
CREATE INDEX IF NOT EXISTS ix_manufacturer_submissions_user_created
  ON manufacturer_submissions (submitted_by_user_id, created_at DESC);
