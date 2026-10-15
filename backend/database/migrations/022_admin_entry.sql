-- 022: Admin Entry - companies created by an admin in the admin dashboard ("Add company").
-- Additive, re-runnable. Enables the 'admin_entry' onboarding source (reserved in 020) and the
-- 'created' history event. ai_voice_call and ground_sales stay unavailable.

ALTER TABLE organizations DROP CONSTRAINT IF EXISTS chk_org_onboarding_source;
ALTER TABLE organizations ADD CONSTRAINT chk_org_onboarding_source
  CHECK (onboarding_source IS NULL OR onboarding_source IN ('database_import', 'web_dashboard', 'admin_entry'));

ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_source_ck;
ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_source_ck
  CHECK (source IS NULL OR source IN ('database_import', 'web_dashboard', 'admin_entry', 'admin_review'));

ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_event_ck;
ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_event_ck
  CHECK (event IN ('submitted', 'resubmitted', 'edited', 'note', 'decision', 'imported', 'merged',
                   'source_backfilled', 'created'));
