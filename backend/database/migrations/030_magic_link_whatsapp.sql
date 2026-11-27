-- Magic link, meeting 27 Nov 2026: Send by Email and Send by WhatsApp are separate.
-- * a link for a person with an email can be shared on WhatsApp only (no email sent);
-- * a link made without an email: when the person enters an email that has no account yet, the
--   account is made and they are signed in straight away (no code). Only an email that already
--   has an account needs the code Clerk emails (so a link cannot open somebody else's account).
-- Additive and idempotent: safe to run more than once.
ALTER TABLE manufacturer_invitations ADD COLUMN IF NOT EXISTS claim_needs_code BOOLEAN;
-- how the link was first shared: 'email' or 'whatsapp' (for the team's overview)
ALTER TABLE manufacturer_invitations ADD COLUMN IF NOT EXISTS channel TEXT;
