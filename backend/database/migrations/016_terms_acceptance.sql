-- 016: Terms and Conditions acceptance recorded at registration.
--
-- users.accepted_terms_version already exists in the base schema (unused until now);
-- terms_accepted_at is the only new column. Both are written only by
-- POST /api/v1/identity/registration/complete, from a sign-up token the backend issued
-- after the user explicitly ticked the Terms checkbox on the Sign-up page.
-- Additive, idempotent, no data changes: historical accounts keep NULL (acceptance unknown);
-- nothing is backfilled or inferred.
ALTER TABLE users ADD COLUMN IF NOT EXISTS accepted_terms_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;
