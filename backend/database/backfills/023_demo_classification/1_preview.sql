-- =============================================================================
-- 023 / 1_preview.sql — READ ONLY. What 2_apply.sql would classify as DEMO, and what needs review.
-- =============================================================================
-- Run first (migration 023 must be applied). Changes nothing:
--   psql "$DATABASE_URL" -f 1_preview.sql > preview.txt
--   (or: python run_seed.py 1_preview.sql — it prints every result table)
--
-- SCOPE (identical in 2_apply.sql). An organization is classified DEMO when ALL hold:
--   1. organization_type = 'manufacturer'           (buyer / Visionary and other orgs: never)
--   2. record_type = 'REAL'                          (existing DEMO / TEST rows: left as they are)
--   3. created before the moment 2_apply.sql runs   (anything created later stays REAL)
--   4. source_ref is not 'india_mfr_research:%'      (rows from the real research seed files stay REAL,
--                                                     in case those were loaded before this step)
--   5. its id is not in the KEEP-REAL list you put in 2_apply.sql
-- Users are never classified (record_type exists on organizations only). Memberships, owners,
-- approval, verification, onboarding source, archive state and every id stay exactly as they are.
-- =============================================================================

-- A. When this preview was taken; compare with the time you run 2_apply.sql
SELECT now() AS preview_taken_at;

-- B. The number to copy into 2_apply.sql (expected_count) if you keep no records REAL
SELECT count(*) AS in_scope_total
FROM organizations o
WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
  AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%');

-- C. What stays as it is
SELECT 'manufacturer, already ' || o.record_type AS untouched_group, count(*) AS records
FROM organizations o WHERE o.organization_type = 'manufacturer' AND o.record_type <> 'REAL' GROUP BY 1
UNION ALL
SELECT 'manufacturer, research seed import (stays REAL)', count(*)
FROM organizations o WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
  AND o.source_ref LIKE 'india_mfr_research:%'
UNION ALL
SELECT 'non-manufacturer organization (' || o.organization_type || ')', count(*)
FROM organizations o WHERE o.organization_type <> 'manufacturer' GROUP BY o.organization_type
ORDER BY 1;

-- D. In-scope records by how they came onto X!Y and their state
SELECT coalesce(o.onboarding_source, '(unknown)') AS onboarding_source, o.entry_source,
       coalesce(mo.status, '(no onboarding)') AS approval, o.is_archived AS archived, count(*) AS records
FROM organizations o
LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
  AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%')
GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC;

-- E. Every in-scope record with the relationships to check before applying.
--    Review rows where any flag is true: they may be genuine companies run by real people.
--    To keep such a record REAL, add its id to the KEEP-REAL list in 2_apply.sql
--    (or apply, then switch it back to Real in the admin portal with a reason).
WITH scope AS (
  SELECT o.* FROM organizations o
  WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
    AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%')
),
owners AS (
  SELECT m.organization_id,
         string_agg(u.email::text || ' [' || coalesce(u.registration_channel, 'channel unknown') || ']',
                    '; ' ORDER BY u.email) AS owner_emails,
         -- the same people also belong to other organizations (shared users): their other
         -- companies / Visionary workspaces are NOT changed by this script
         bool_or(EXISTS (SELECT 1 FROM memberships m2 JOIN organizations o2 ON o2.id = m2.organization_id
                         WHERE m2.user_id = m.user_id AND m2.status = 'active'
                           AND m2.organization_id <> m.organization_id)) AS owner_in_other_orgs,
         bool_or(EXISTS (SELECT 1 FROM visionary_profiles vp WHERE vp.user_id = m.user_id)) AS owner_is_visionary,
         bool_or(EXISTS (SELECT 1 FROM platform_role_assignments pa WHERE pa.user_id = m.user_id
                         AND pa.status = 'active' AND pa.revoked_at IS NULL)) AS owner_is_admin
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.status = 'active' AND m.membership_role IN ('owner', 'admin')
  GROUP BY m.organization_id
)
SELECT s.id, s.display_name, s.created_at, s.status, s.verification_status,
       coalesce(mo.status, '(none)') AS approval, s.onboarding_source, s.entry_source, s.is_archived AS archived,
       ow.owner_emails,
       coalesce(ow.owner_in_other_orgs, false) AS shared_owner,
       coalesce(ow.owner_is_visionary, false) AS owner_is_visionary,
       coalesce(ow.owner_is_admin, false) AS owner_is_admin,
       (mo.status = 'approved') AS approved,
       (SELECT count(*) FROM manufacturer_booking_requests b WHERE b.manufacturer_organization_id = s.id) AS booking_requests,
       (SELECT count(*) FROM engagements e WHERE e.supply_organization_id = s.id) AS engagements,
       (SELECT count(*) FROM machines mm WHERE mm.organization_id = s.id AND mm.publication_status = 'published') AS published_machines,
       (SELECT count(*) FROM manufacturer_submissions ms WHERE ms.target_organization_id = s.id
          AND ms.organization_id <> s.id AND ms.status IN ('pending', 'changes_requested')) AS open_requests_from_others,
       (ov.completeness >= 100 AND mo.status = 'approved') AS visible_to_visionaries_today
FROM scope s
LEFT JOIN manufacturer_onboarding mo ON mo.organization_id = s.id
LEFT JOIN owners ow ON ow.organization_id = s.id
LEFT JOIN admin_manufacturer_overview ov ON ov.organization_id = s.id
ORDER BY (ow.owner_emails IS NOT NULL) DESC, (mo.status = 'approved') DESC NULLS LAST, s.created_at;

-- F. Summary of the flags above
WITH scope AS (
  SELECT o.id FROM organizations o
  WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
    AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%')
)
SELECT count(*) AS in_scope,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = s.id AND m.status = 'active'))
         AS with_active_members,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM manufacturer_onboarding mo WHERE mo.organization_id = s.id
                                      AND mo.status = 'approved')) AS approved,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM admin_manufacturer_overview ov JOIN manufacturer_onboarding mo
                                      ON mo.organization_id = ov.organization_id
                                      WHERE ov.organization_id = s.id AND ov.completeness >= 100
                                        AND mo.status = 'approved')) AS visible_to_visionaries_today,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM manufacturer_booking_requests b
                                      WHERE b.manufacturer_organization_id = s.id)) AS with_booking_requests
FROM scope s;
