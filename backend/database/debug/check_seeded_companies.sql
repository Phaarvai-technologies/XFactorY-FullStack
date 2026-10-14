-- Read-only: are the seeded manufacturer companies visible in the company search?
-- Run in the Supabase SQL editor (or psql). Changes nothing.
--
-- The search lists every manufacturer organization that is active or claim_pending, not
-- archived, not record_type 'TEST', and is not an empty per-user placeholder
-- (created by a user through the app, entry_source 'MANUFACTURER', details form never submitted).

-- 1. One row per reason, with counts.
SELECT
  CASE
    WHEN o.organization_type <> 'manufacturer'              THEN 'hidden: organization_type is ' || o.organization_type
    WHEN o.status NOT IN ('active', 'claim_pending')        THEN 'hidden: status is ' || o.status
    WHEN o.is_archived                                      THEN 'hidden: archived'
    WHEN o.record_type = 'TEST'                             THEN 'hidden: record_type TEST'
    WHEN o.created_by_user_id IS NOT NULL AND o.entry_source = 'MANUFACTURER'
         AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding mo
                         WHERE mo.organization_id = o.id AND mo.personal_information_completed)
                                                            THEN 'hidden: empty user placeholder (expected)'
    ELSE 'SEARCHABLE'
  END AS search_visibility,
  count(*) AS companies,
  count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id
                                      AND m.status = 'active' AND m.membership_role IN ('owner', 'admin'))) AS without_owner
FROM organizations o
GROUP BY 1
ORDER BY 1;

-- 2. Same-name companies (kept separate on purpose; the search shows their location).
SELECT lower(regexp_replace(btrim(o.display_name), '\s+', ' ', 'g')) AS normalized_name,
       count(*) AS records,
       string_agg(COALESCE(f.city, '?') || ', ' || COALESCE(op.country_name, f.country_name, '?'), ' | ') AS locations
FROM organizations o
LEFT JOIN organization_profiles op ON op.organization_id = o.id
LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters AND f.status <> 'suspended'
WHERE o.organization_type = 'manufacturer' AND NOT o.is_archived
  AND NOT (o.created_by_user_id IS NOT NULL AND o.entry_source = 'MANUFACTURER'
           AND NOT EXISTS (SELECT 1 FROM manufacturer_onboarding mo
                           WHERE mo.organization_id = o.id AND mo.personal_information_completed))
GROUP BY 1
HAVING count(*) > 1
ORDER BY records DESC, 1
LIMIT 50;
