-- 018: compatibility for accounts that existed before explicit registration (014).
--
-- Accounts created before 014 have no users.registration_completed_at, so genuinely registered
-- users were refused at sign-in. The backend now recognises such an account the first time it
-- signs in, ONLY from recorded evidence of a deliberate sign-up (see
-- app/identity/registration.py: legacy_evidence), and records which evidence it used in
-- users.registration_method ('legacy_signup_flow', 'legacy_terms', 'legacy_activity',
-- 'legacy_password', 'legacy_legal_terms'). Nothing is inferred from a row merely existing.
--
-- Only accounts whose users row is older than legacy_cutoff qualify (accounts created after it
-- must complete Sign-up). The cutoff defaults to the moment this migration first runs; it is
-- stored here so it is visible and can be audited or adjusted. Re-running changes nothing.
CREATE TABLE IF NOT EXISTS registration_settings (
  key        TEXT PRIMARY KEY,
  value      TIMESTAMPTZ NOT NULL,
  note       TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO registration_settings (key, value, note)
VALUES ('legacy_cutoff', now(),
        'Users rows created before this time may be recognised as registered from legacy sign-up evidence.')
ON CONFLICT (key) DO NOTHING;
ALTER TABLE registration_settings ENABLE ROW LEVEL SECURITY;
