-- Welcome email for newly registered users, sent once. Safe to run repeatedly.
-- Existing users are marked as already welcomed (only when the column is first added),
-- so nobody who registered before this change gets a late welcome email.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'users'
                   AND column_name = 'welcome_email_sent_at') THEN
    ALTER TABLE users ADD COLUMN welcome_email_sent_at TIMESTAMPTZ;
    UPDATE users SET welcome_email_sent_at = COALESCE(created_at, now());
  END IF;
END $$;
