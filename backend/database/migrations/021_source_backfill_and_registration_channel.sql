-- 021: auditable onboarding-source backfill + user registration channel. Additive, re-runnable.
--
-- * onboarding_source_backfill_log: one row per record and field examined by
--   `python -m app.backfill_onboarding_source --apply` (applied / unresolved / conflict), with the
--   rule and the evidence used, and when. An applied row is never overwritten, so re-running adds
--   nothing; unresolved / conflict rows are refreshed with the latest reason.
-- * users.registration_channel: HOW the person registered with X!Y (the channel), kept apart from
--   users.registration_method (014/018), which records the sign-up method or legacy evidence.
--     web_signup     - explicit Sign-up on the website (manual or Google)
--     legacy_account - account from before explicit registration, recognised from recorded evidence
--     admin_portal   - staff admin account created by an administrator
--   NULL = not registered / unknown. Set by the backend at registration; existing users are filled
--   by the same backfill command (from registration_method / the staff-account marker only).
-- * history event 'source_backfilled' (company history, time = when the backfill ran).

CREATE TABLE IF NOT EXISTS onboarding_source_backfill_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       UUID NOT NULL,
  record_type  TEXT NOT NULL CHECK (record_type IN ('company', 'user')),
  record_id    UUID NOT NULL,
  field        TEXT NOT NULL CHECK (field IN ('onboarding_source', 'registration_channel')),
  old_value    TEXT,
  new_value    TEXT,
  outcome      TEXT NOT NULL CHECK (outcome IN ('applied', 'unresolved', 'conflict')),
  rule         TEXT NOT NULL,
  evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_onboarding_source_backfill_log UNIQUE (record_type, record_id, field)
);
ALTER TABLE onboarding_source_backfill_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_channel TEXT;
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_registration_channel;
ALTER TABLE users ADD CONSTRAINT chk_users_registration_channel
  CHECK (registration_channel IS NULL OR registration_channel IN ('web_signup', 'legacy_account', 'admin_portal'));

-- widened only if it does not allow 'source_backfilled' yet (re-runs never narrow 022's version)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manufacturer_submission_events_event_ck'
                 AND pg_get_constraintdef(oid) LIKE '%source_backfilled%') THEN
    ALTER TABLE manufacturer_submission_events DROP CONSTRAINT IF EXISTS manufacturer_submission_events_event_ck;
    ALTER TABLE manufacturer_submission_events ADD CONSTRAINT manufacturer_submission_events_event_ck
      CHECK (event IN ('submitted', 'resubmitted', 'edited', 'note', 'decision', 'imported', 'merged',
                       'source_backfilled'));
  END IF;
END $$;
