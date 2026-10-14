-- Read-only: why might a registered user be told to sign up? Run in the Supabase SQL editor.
-- Changes nothing. (For one person, `python -m app.diagnose_registration --email ...` also checks
-- the Clerk configuration and the Clerk side.)

-- 1. Accounts without the registration marker, by the evidence the backend will accept at their
--    next sign-in. "needs Clerk check" = recognised at sign-in if the Clerk account has a
--    password or accepted legal terms; otherwise the person must complete Sign-up (same account).
WITH cutoff AS (SELECT value FROM registration_settings WHERE key = 'legacy_cutoff')
SELECT
  CASE
    WHEN u.registration_completed_at IS NOT NULL THEN 'registered (' || COALESCE(u.registration_method, '?') || ')'
    WHEN u.status <> 'active' THEN 'not active: ' || u.status
    WHEN u.clerk_user_id LIKE 'local-admin:%' THEN 'staff-only admin account (not a Clerk sign-in)'
    WHEN u.created_at >= (SELECT value FROM cutoff) THEN 'created after cutoff: must complete Sign-up'
    WHEN EXISTS (SELECT 1 FROM registration_flows f
                 WHERE f.completed_clerk_user_id = u.clerk_user_id AND f.purpose = 'sign-up')
      THEN 'recognised at sign-in: legacy_signup_flow'
    WHEN NULLIF(btrim(COALESCE(u.accepted_terms_version, '')), '') IS NOT NULL
      THEN 'recognised at sign-in: legacy_terms'
    WHEN EXISTS (SELECT 1 FROM marketplace_role_selections s WHERE s.user_id = u.id AND s.status = 'active')
      OR EXISTS (SELECT 1 FROM memberships m
                 JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
                 JOIN manufacturer_onboarding mo ON mo.organization_id = o.id AND mo.personal_information_completed
                 WHERE m.user_id = u.id AND m.status = 'active')
      OR EXISTS (SELECT 1 FROM visionary_profiles v WHERE v.user_id = u.id)
      OR EXISTS (SELECT 1 FROM platform_role_assignments p
                 WHERE p.user_id = u.id AND p.status = 'active' AND p.revoked_at IS NULL)
      THEN 'recognised at sign-in: legacy_activity'
    ELSE 'needs Clerk check (password / legal terms) at sign-in'
  END AS registration_state,
  count(*) AS accounts
FROM users u
GROUP BY 1
ORDER BY 1;

-- 2. Recent registration-check failures recorded by the backend (Clerk unreachable / not
--    configured, suspended accounts). These are errors, never "not registered".
SELECT created_at, clerk_user_id, method, path, status_code, left(detail, 120) AS detail
FROM user_activity_events
WHERE kind = 'error' AND (path LIKE '%/identity/%' OR path LIKE '%/manufacturer/bootstrap')
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 50;
