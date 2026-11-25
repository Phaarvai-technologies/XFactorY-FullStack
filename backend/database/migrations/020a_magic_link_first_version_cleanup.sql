-- One-time clean-up for development databases that ran the FIRST magic-link version of 028
-- (before 25 Nov 2026). That version stored registration_channel 'manufacturer_invite', history
-- events 'invitation_sent' / 'invitation_opened' / … and source 'manufacturer_invite'. The current
-- version uses registration_channel 'admin_portal' and event 'note' with details.action, so the
-- checks that migrations 021-024 re-create on every run accept every row again.
-- Runs before 021 (file order). Does nothing on databases that never had those values.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'users' AND column_name = 'registration_channel') THEN
    UPDATE users SET registration_channel = 'admin_portal'
    WHERE registration_channel = 'manufacturer_invite';
  END IF;
  IF to_regclass('public.manufacturer_submission_events') IS NOT NULL THEN
    UPDATE manufacturer_submission_events
    SET details = COALESCE(details, '{}'::jsonb) || jsonb_build_object('action', event), event = 'note'
    WHERE event IN ('invitation_sent', 'invitation_resent', 'invitation_cancelled', 'invitation_opened',
                    'invitation_accepted', 'details_confirmed', 'details_reviewed');
    UPDATE manufacturer_submission_events SET source = 'web_dashboard' WHERE source = 'manufacturer_invite';
  END IF;
END $$;
