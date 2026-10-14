-- 014: explicit application registration (separate from Clerk authentication).
--
-- A Clerk identity, or a users row created by the Clerk webhook / read-time
-- synchronisation, does NOT mean the person completed X!Y sign-up. Only the
-- authenticated, idempotent POST /api/v1/identity/registration/complete call (made
-- after an explicit Sign-up) sets users.registration_completed_at.
--
-- Additive and idempotent: these objects already exist in some databases with exactly
-- this shape, so every statement is IF NOT EXISTS and re-running is a no-op.
-- No existing data is changed here. Existing accounts are handled by the separate,
-- deliberately run database/backfills/014_registration_backfill.sql.

ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_completed_at timestamptz;
-- 'manual' | 'google' (explicit sign-up) or 'legacy' (backfilled existing account).
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_method text;
-- Clerk session id (`sid` claim) of the request that completed registration (audit).
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_session_id text;

-- One row per consumed sign-up flow token (single use; replay by another account is refused).
-- Tokens themselves are HMAC-signed and stateless; only their SHA-256 hash is stored.
CREATE TABLE IF NOT EXISTS registration_flows (
  token_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose = ANY (ARRAY['sign-in'::text, 'sign-up'::text])),
  method text NOT NULL CHECK (method = ANY (ARRAY['manual'::text, 'google'::text])),
  return_path text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  completed_clerk_user_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT registration_flows_pkey PRIMARY KEY (token_hash)
);
