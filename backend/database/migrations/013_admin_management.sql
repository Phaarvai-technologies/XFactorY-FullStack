-- Admin management (Admins tab). Additive and safe to run repeatedly.
-- Run after 012_visionary_portal.sql.
--
-- must_change_password: set when an admin is given a temporary password from the Admins
-- tab; they must choose their own password before using the admin portal.
-- created_by_user_id:  the admin who added this admin account (NULL = created in the terminal).
ALTER TABLE admin_accounts
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Admin list: role assignments per user, newest first.
CREATE INDEX IF NOT EXISTS ix_platform_role_assignments_user
  ON platform_role_assignments (user_id, granted_at DESC);
