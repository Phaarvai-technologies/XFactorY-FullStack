-- 020: Company onboarding source (how a company first came onto X!Y), import batches and a
-- company-level onboarding history. Additive and safe to run repeatedly.
--
-- Reuses what exists:
--   * manufacturer_submissions (017/019) is the staging record. Field mapping:
--       company_id            -> target_organization_id (selected_company_id when picked from the list)
--       proposed information  -> payload (original_payload = as submitted)
--       submission_source     -> source           (set by the backend only)
--       approval_status       -> status           ('draft' allowed, unused: the dashboard sends directly)
--       review_note           -> review_feedback
--     New here: source_reference_id, submitted_at; submitted_by_user_id becomes nullable for
--     future automated channels (a web_dashboard submission must still name its user).
--   * manufacturer_submission_events (019) is the history. New here: organization_id (company
--     events without a submission, e.g. 'imported'), source, import_batch_id, idempotency_key.
--   * organizations.entry_source (008) is NOT reused: it is an admin-editable classification and
--     its column default ('MANUFACTURER') was applied to rows loaded any other way, so it is not
--     evidence of origin. organizations.onboarding_source is new, set once by the backend, and
--     NULL means "unknown" (historical rows are not guessed; see backfills/020_*).
--
-- Only implemented channels are accepted by the database. admin_entry (no admin company-creation
-- workflow exists), ai_voice_call and ground_sales (reserved) need a later migration together
-- with their verified integration; see ONBOARDING_SOURCES.md.

CREATE TABLE IF NOT EXISTS import_batches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_reference TEXT NOT NULL,                -- file name or other reference of the import
  content_sha256   TEXT NOT NULL,                -- same content = same batch (re-runs reuse it)
  imported_by      TEXT NOT NULL,                -- operator account or job name that ran it
  row_count        INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_batches_content UNIQUE (content_sha256)
);
ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_source TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE RESTRICT;
-- created once; a later migration (022) may widen it, so re-runs never narrow it again
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_onboarding_source') THEN
    ALTER TABLE organizations ADD CONSTRAINT chk_org_onboarding_source
      CHECK (onboarding_source IS NULL OR onboarding_source IN ('database_import', 'web_dashboard'));
  END IF;
END $$;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_import_batch_source;
ALTER TABLE organizations ADD CONSTRAINT chk_org_import_batch_source
  CHECK (import_batch_id IS NULL OR onboarding_source = 'database_import');
CREATE INDEX IF NOT EXISTS ix_organizations_import_batch ON organizations (import_batch_id)
  WHERE import_batch_id IS NOT NULL;

-- The original source is kept for good: once set it cannot be changed or cleared by any later
-- update (dashboard edits, approvals, merges, admin edits).
CREATE OR REPLACE FUNCTION xy_keep_onboarding_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.onboarding_source IS NOT NULL AND NEW.onboarding_source IS DISTINCT FROM OLD.onboarding_source THEN
    RAISE EXCEPTION 'onboarding_source of organization % is already %, and is never changed',
      OLD.id, OLD.onboarding_source USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.import_batch_id IS NOT NULL AND NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id THEN
    RAISE EXCEPTION 'import_batch_id of organization % is never changed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_organizations_keep_onboarding_source ON organizations;
CREATE TRIGGER trg_organizations_keep_onboarding_source
  BEFORE UPDATE OF onboarding_source, import_batch_id ON organizations
  FOR EACH ROW EXECUTE FUNCTION xy_keep_onboarding_source();

-- ---------------------------------------------------------------- staging record
ALTER TABLE manufacturer_submissions ALTER COLUMN submitted_by_user_id DROP NOT NULL;
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS source_reference_id TEXT;
ALTER TABLE manufacturer_submissions ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
UPDATE manufacturer_submissions SET submitted_at = created_at WHERE submitted_at IS NULL;  -- first submission time
ALTER TABLE manufacturer_submissions ALTER COLUMN submitted_at SET DEFAULT now();
ALTER TABLE manufacturer_submissions ALTER COLUMN submitted_at SET NOT NULL;
ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_status_check;
ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_status_ck;
ALTER TABLE manufacturer_submissions ADD CONSTRAINT manufacturer_submissions_status_ck
  CHECK (status IN ('draft', 'pending', 'changes_requested', 'approved', 'rejected'));
-- source stays limited to 'web_dashboard' (019's constraint); a dashboard submission needs its user
ALTER TABLE manufacturer_submissions DROP CONSTRAINT IF EXISTS manufacturer_submissions_submitter_ck;
ALTER TABLE manufacturer_submissions ADD CONSTRAINT manufacturer_submissions_submitter_ck
  CHECK (source <> 'web_dashboard' OR submitted_by_user_id IS NOT NULL);

-- ---------------------------------------------------------------- history
ALTER TABLE manufacturer_submission_events ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE manufacturer_submission_events ADD COLUMN IF NOT EXISTS organization_id UUID
  REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE manufacturer_submission_events ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE manufacturer_submission_events ADD COLUMN IF NOT EXISTS import_batch_id UUID
  REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE manufacturer_submission_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
-- several events written in one transaction keep their order
ALTER TABLE manufacturer_submission_events ALTER COLUMN created_at SET DEFAULT clock_timestamp();

ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_event_check;
-- created once; a later migration (022) may widen it, so re-runs never narrow it again
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturer_submission_events_event_ck') THEN
    ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_event_ck
      CHECK (event IN ('submitted', 'resubmitted', 'edited', 'note', 'decision', 'imported', 'merged'));
  END IF;
END $$;
ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_actor_role_check;
ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_actor_role_ck;
ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_actor_role_ck
  CHECK (actor_role IN ('requester', 'admin', 'system'));
-- 'admin_review' marks review actions; it is never a company onboarding source
-- created once; a later migration (022) may widen it, so re-runs never narrow it again
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturer_submission_events_source_ck') THEN
    ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_source_ck
      CHECK (source IS NULL OR source IN ('database_import', 'web_dashboard', 'admin_review'));
  END IF;
END $$;
ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_subject_ck;
ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_subject_ck
  CHECK (submission_id IS NOT NULL OR organization_id IS NOT NULL);

-- Existing 019 events: the company and channel follow from rows that already exist
-- (requester events came only from the dashboard, admin events only from the review).
UPDATE manufacturer_submission_events e SET organization_id = s.target_organization_id
FROM manufacturer_submissions s WHERE e.submission_id = s.id AND e.organization_id IS NULL;
UPDATE manufacturer_submission_events SET source = CASE actor_role WHEN 'requester' THEN 'web_dashboard'
                                                                   WHEN 'admin' THEN 'admin_review' END
WHERE source IS NULL AND actor_role IN ('requester', 'admin');

CREATE UNIQUE INDEX IF NOT EXISTS uq_manufacturer_submission_events_idempotency
  ON manufacturer_submission_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_manufacturer_submission_events_org
  ON manufacturer_submission_events (organization_id, created_at);
