-- 024_personal_email.sql
-- The registering user's personal email from the Manufacturer details form, kept on the user
-- (users.personal_email). It is never written to the company's contact details
-- (organization_profiles.contact_email) and never replaces the sign-in email (users.email).
-- Additive and safe to run repeatedly; existing rows are not changed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS personal_email CITEXT;
