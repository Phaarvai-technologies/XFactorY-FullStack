-- Admin email + password sign-in (separate from Clerk). Additive and safe to run repeatedly.
-- Run after 008_admin_dashboard.sql.
--
-- An admin account is a password login for a `users` row that holds an admin role in
-- platform_role_assignments. If the email already belongs to a Clerk user, the account is
-- linked to that user (the person can then sign in either way). Otherwise a staff-only
-- user row is created with clerk_user_id 'local-admin:<uuid>' (never a real Clerk id).
-- Passwords are stored only as scrypt hashes; session tokens only as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS admin_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email               CITEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_until        TIMESTAMPTZ,
  last_login_at       TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES admin_accounts(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  ip_address   TEXT,
  user_agent   TEXT
);
CREATE INDEX IF NOT EXISTS ix_admin_sessions_account ON admin_sessions (account_id, created_at DESC);

ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

-- Sign-in events appear in the user's troubleshooting panel.
ALTER TABLE user_activity_events DROP CONSTRAINT IF EXISTS user_activity_events_kind_check;
ALTER TABLE user_activity_events ADD CONSTRAINT user_activity_events_kind_check
  CHECK (kind IN ('error', 'account_status', 'admin_login', 'admin_login_failed'));
