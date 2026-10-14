-- One-time compatibility backfill for accounts that existed before explicit registration
-- (migration 014). NOT run by `python -m app.migrate`: review the preview, then run it once
-- deliberately (Supabase SQL editor or psql) right after deploying 014.
--
-- WHY THIS IS NEEDED
-- Before 014 there was no registration record. Users rows were created by any of:
--   * the Clerk user.created / user.updated webhook,
--   * the first authenticated API call (identity get_actor, manufacturer ensure_actor,
--     Clerk-admin sign-in),
-- and Clerk itself turned an unknown Google sign-in into a sign-up. Historical data therefore
-- CANNOT tell an explicit sign-up apart from an account created by an accidental sign-in.
--
-- WHAT THIS DOES (conservative)
-- Marks an existing account as registered (registration_method = 'legacy') only when it shows
-- deliberate use of the application after sign-in:
--   * saved marketplace roles (Roles page "Continue"), or
--   * a submitted Manufacturer details form (personal_information_completed), or
--   * a saved Visionary profile, or
--   * an active admin role.
-- The timestamp is the time of this backfill (not an invented sign-up time); the 'legacy'
-- method records that it is a compatibility grant, not sign-up evidence.
-- Nothing is deleted. Accounts left unregistered keep all their data and become registered
-- the moment the person completes Sign-up (manual sign-up on an existing email first proves
-- the password; Continue with Google transfers to the existing account).
--
-- If the business decides every pre-014 account should keep access, use OPTION B instead.

-- ---------------------------------------------------------------- PREVIEW (read-only)
SELECT
  count(*) FILTER (WHERE registration_completed_at IS NULL)                         AS unregistered_total,
  count(*) FILTER (WHERE registration_completed_at IS NULL AND (
      EXISTS (SELECT 1 FROM marketplace_role_selections s WHERE s.user_id = u.id AND s.status = 'active')
   OR EXISTS (SELECT 1 FROM memberships m
              JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
              JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.personal_information_completed
              WHERE m.user_id = u.id AND m.status = 'active')
   OR EXISTS (SELECT 1 FROM visionary_profiles v WHERE v.user_id = u.id)
   OR EXISTS (SELECT 1 FROM platform_role_assignments p
              WHERE p.user_id = u.id AND p.status = 'active' AND p.revoked_at IS NULL)))   AS option_a_would_mark
FROM users u
WHERE u.clerk_user_id NOT LIKE 'local-admin:%';

-- ---------------------------------------------------------------- OPTION A (recommended)
BEGIN;
UPDATE users u
SET registration_completed_at = now(),
    registration_method = 'legacy',
    updated_at = now()
WHERE u.registration_completed_at IS NULL
  AND u.clerk_user_id NOT LIKE 'local-admin:%'
  AND (
       EXISTS (SELECT 1 FROM marketplace_role_selections s WHERE s.user_id = u.id AND s.status = 'active')
    OR EXISTS (SELECT 1 FROM memberships m
               JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
               JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.personal_information_completed
               WHERE m.user_id = u.id AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM visionary_profiles v WHERE v.user_id = u.id)
    OR EXISTS (SELECT 1 FROM platform_role_assignments p
               WHERE p.user_id = u.id AND p.status = 'active' AND p.revoked_at IS NULL)
  );
COMMIT;

-- ---------------------------------------------------------------- OPTION B (grandfather all)
-- Keeps access for every account that existed before 014, including any created by an
-- accidental Google sign-in. Replace the cutoff with the 014 deployment time.
-- UPDATE users SET registration_completed_at = now(), registration_method = 'legacy', updated_at = now()
-- WHERE registration_completed_at IS NULL AND clerk_user_id NOT LIKE 'local-admin:%'
--   AND created_at < TIMESTAMPTZ '2026-10-14 00:00:00+00';
