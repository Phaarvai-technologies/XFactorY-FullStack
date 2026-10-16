-- check_demo.sql — READ ONLY. Shows whether the existing manufacturer records are now DEMO.
-- Run:  python database\seeds\run_seed.py database\seeds\check_demo.sql

-- 1. Was the one-time classification applied?  (expect 1 row, rolled_back = 0)
SELECT run_label, count(*) AS records_marked_demo, min(applied_at) AS applied_at,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
FROM record_type_classification_log
GROUP BY run_label;

-- 2. All manufacturers by type and origin
--    expect: existing companies -> DEMO ; research imports (india_mfr_research) -> REAL
SELECT CASE WHEN o.source_ref LIKE 'india_mfr_research:%' THEN 'research import (India / Tamil Nadu)'
            ELSE 'existing company' END AS origin,
       o.record_type, count(*) AS companies
FROM organizations o
WHERE o.organization_type = 'manufacturer'
GROUP BY 1, 2 ORDER BY 1, 2;

-- 3. Existing companies that are still REAL (expect 0 rows, unless you put them in the KEEP-REAL list
--    or registered them after running 2_apply.sql)
SELECT o.id, o.display_name, o.created_at,
       (SELECT min(applied_at) FROM record_type_classification_log) AS classification_ran_at
FROM organizations o
WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
  AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%')
ORDER BY o.created_at;

-- 4. Research imports that are NOT real (expect 0)
SELECT count(*) AS research_rows_not_real
FROM organizations o
WHERE o.source_ref LIKE 'india_mfr_research:%' AND o.record_type <> 'REAL';

-- 5. Nothing else changed: approval, owners and status are the same as when they were marked demo
--    (expect 0 and 0 right after applying)
SELECT
  count(*) FILTER (WHERE (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = l.organization_id)
                         IS DISTINCT FROM l.snapshot->>'approval') AS approval_changed,
  count(*) FILTER (WHERE (SELECT o.status FROM organizations o WHERE o.id = l.organization_id)
                         IS DISTINCT FROM l.snapshot->>'status') AS status_changed
FROM record_type_classification_log l WHERE l.rolled_back_at IS NULL;

-- 6. Demo companies Visionaries can see (expect 0)
SELECT count(*) AS demo_visible_to_visionaries
FROM organizations o
JOIN admin_manufacturer_overview v ON v.organization_id = o.id
WHERE o.record_type <> 'REAL' AND v.record_type = 'REAL';

-- 7. A sample of the companies now marked DEMO (first 20), with their change-history entry
SELECT o.display_name, o.record_type, h.old_value || ' -> ' || h.new_value AS change, h.created_at AS changed_at
FROM organizations o
JOIN admin_change_history h ON h.manufacturer_id = o.id AND h.field_changed = 'Record type'
WHERE o.record_type = 'DEMO'
ORDER BY h.created_at DESC, o.display_name
LIMIT 20;
