-- Outgoing email log (the app's own emails, sent over SMTP when SMTP_HOST is set).
-- Additive and safe to run repeatedly. Run after 009_admin_accounts.sql.
-- Stores who / what / result only - never the email body, passwords or tokens.
CREATE TABLE IF NOT EXISTS email_deliveries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  to_email        CITEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  template        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error           TEXT,
  message_id      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS ix_email_deliveries_user ON email_deliveries (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_email_deliveries_recent ON email_deliveries (created_at DESC);
ALTER TABLE email_deliveries ENABLE ROW LEVEL SECURITY;
