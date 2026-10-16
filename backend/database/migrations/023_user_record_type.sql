-- 023: Real / Demo / Test marking for people (e.g. a demo Visionary), like organizations.record_type
-- (008) for companies. Set only by an admin (Admin portal -> Visionaries); every existing user stays
-- REAL. Additive and safe to run repeatedly.
ALTER TABLE users ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'REAL';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_record_type') THEN
    ALTER TABLE users ADD CONSTRAINT chk_users_record_type CHECK (record_type IN ('REAL', 'DEMO', 'TEST'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_users_record_type ON users (record_type) WHERE record_type <> 'REAL';
