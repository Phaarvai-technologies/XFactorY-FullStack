-- Magic link, daily check-in with Praveen (26 Nov 2026):
-- * a link can be generated WITHOUT an email (sent by WhatsApp / copied): the person enters their
--   own email when they open it and confirms it with a code (app/invitations.py, claim);
-- * any company can get a link, also one that already has an owner (an additional login).
-- Additive and idempotent: safe to run more than once.
ALTER TABLE manufacturer_invitations ALTER COLUMN email DROP NOT NULL;
ALTER TABLE manufacturer_invitations ALTER COLUMN contact_name DROP NOT NULL;
-- the membership role the person got when they accepted (owner, or admin for an additional login)
ALTER TABLE manufacturer_invitations ADD COLUMN IF NOT EXISTS accepted_role TEXT;
-- set when the person entered their own email on a link made without one: such a link never
-- signs anyone in by itself; the person confirms the email with a code each time
ALTER TABLE manufacturer_invitations ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
