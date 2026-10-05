-- 015: In-app notifications from the admin portal to manufacturers.
-- Uses the existing "notifications" table (one row per recipient, channel 'in_app') and adds
-- the message itself and read / popup state. Admin notes get a "shared with manufacturer" flag:
-- notes stay private unless the admin ticks "Show to manufacturer".
-- Idempotent and additive: safe to run again, never removes data.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS popup_shown_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS ix_notifications_user_created ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_user_unread ON notifications (user_id) WHERE read_at IS NULL;

ALTER TABLE admin_internal_notes
  ADD COLUMN IF NOT EXISTS shared_with_manufacturer BOOLEAN NOT NULL DEFAULT false;
