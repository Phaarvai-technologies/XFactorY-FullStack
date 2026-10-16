-- =============================================================================
-- 023 / 3_verify.sql — READ ONLY. Run after 2_apply.sql, and again after importing real data.
-- Every "problems_*" column must be 0.
-- =============================================================================

-- 1. The one-time run
SELECT run_label, count(*) AS records, min(applied_at) AS applied_at,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
FROM record_type_classification_log GROUP BY run_label;

-- 2. Integrity of the classified records
SELECT
  -- every logged record is DEMO now, unless an admin later switched it (that shows in history)
  (SELECT count(*) FROM record_type_classification_log l JOIN organizations o ON o.id = l.organization_id
    WHERE l.rolled_back_at IS NULL AND o.record_type <> 'DEMO'
      AND NOT EXISTS (SELECT 1 FROM admin_change_history h WHERE h.manufacturer_id = l.organization_id
                      AND h.field_changed = 'Record type' AND h.created_at > l.applied_at
                      AND h.reason IS DISTINCT FROM
                          'One-time classification of existing records as demo data (023_existing_manufacturers_demo)'))
                                                                                                   AS problems_not_demo,
  -- nothing created after the run was touched by it
  (SELECT count(*) FROM record_type_classification_log l JOIN organizations o ON o.id = l.organization_id
    WHERE o.created_at >= l.applied_at)                                                            AS problems_created_after_run,
  -- research seed imports are never in the run
  (SELECT count(*) FROM record_type_classification_log l JOIN organizations o ON o.id = l.organization_id
    WHERE o.source_ref LIKE 'india_mfr_research:%')                                                AS problems_research_rows_logged,
  -- only manufacturers
  (SELECT count(*) FROM record_type_classification_log l JOIN organizations o ON o.id = l.organization_id
    WHERE o.organization_type <> 'manufacturer')                                                   AS problems_non_manufacturer,
  -- owners / members unchanged since the run (compared with the snapshot)
  (SELECT count(*) FROM record_type_classification_log l
    WHERE l.rolled_back_at IS NULL
      AND l.snapshot->'members' IS DISTINCT FROM coalesce((
        SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.membership_role, 'status', m.status)
                         ORDER BY m.user_id)
        FROM memberships m WHERE m.organization_id = l.organization_id), '[]'::jsonb))             AS info_members_changed_since,
  -- approval unchanged since the run
  (SELECT count(*) FROM record_type_classification_log l
    WHERE l.rolled_back_at IS NULL
      AND (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = l.organization_id)
          IS DISTINCT FROM l.snapshot->>'approval')                                                AS info_approval_changed_since;
-- (info_* can grow later through normal admin work; right after 2_apply.sql they must be 0.)

-- 3. Nobody outside the admin portal can see demo data
SELECT
  (SELECT count(*) FROM organizations o
    WHERE o.organization_type = 'manufacturer' AND o.record_type <> 'REAL'
      AND EXISTS (SELECT 1 FROM admin_manufacturer_overview elig WHERE elig.organization_id = o.id
                  AND elig.record_type = 'REAL' AND elig.onboarding_raw_status = 'approved'
                  AND elig.completeness >= 100))                                                   AS problems_demo_visible_to_visionaries,
  (SELECT count(*) FROM organizations o WHERE o.record_type NOT IN ('REAL', 'DEMO', 'TEST'))         AS problems_invalid_values;

-- 4. Current totals (Real should grow only through self-registration, real imports and admin choices)
SELECT o.record_type, coalesce(o.onboarding_source, '(unknown)') AS onboarding_source, count(*) AS manufacturers
FROM organizations o WHERE o.organization_type = 'manufacturer'
GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- 5. After importing the real research data: those rows are REAL and none was converted
SELECT count(*) FILTER (WHERE o.record_type = 'REAL') AS research_rows_real,
       count(*) FILTER (WHERE o.record_type <> 'REAL') AS problems_research_rows_not_real
FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%';
