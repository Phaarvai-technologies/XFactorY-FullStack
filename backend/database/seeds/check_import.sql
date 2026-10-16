-- check_import.sql — READ ONLY. Shows whether the research import (seed) is in the database,
-- or whether unseed removed it.
-- Run:  python database\seeds\run_seed.py database\seeds\check_import.sql
--
-- After unseed.sql : section 1 imported_companies = 0 (or only companies someone claimed), section 3 all 0.
-- After seed files : section 1 imported_companies ≈ 22,349 (≈ 22,071 if you kept the old import),
--                    all REAL, and section 3 all 0.

-- 1. Imported research companies and their linked rows
SELECT
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%')                       AS imported_companies,
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%' AND o.record_type = 'REAL') AS real,
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%' AND o.record_type <> 'REAL') AS not_real,
  (SELECT count(*) FROM organization_profiles p JOIN organizations o ON o.id = p.organization_id
    WHERE o.source_ref LIKE 'india_mfr_research:%')                                                           AS profiles,
  (SELECT count(*) FROM facilities f JOIN organizations o ON o.id = f.organization_id
    WHERE o.source_ref LIKE 'india_mfr_research:%')                                                           AS facilities,
  (SELECT count(*) FROM admin_internal_notes n JOIN organizations o ON o.id = n.manufacturer_id
    WHERE o.source_ref LIKE 'india_mfr_research:%')                                                           AS admin_notes,
  (SELECT count(*) FROM manufacturer_submission_events e JOIN organizations o ON o.id = e.organization_id
    WHERE o.source_ref LIKE 'india_mfr_research:%' AND e.event = 'imported')                                  AS import_events;

-- 2. Which import format the rows are in
--    new format (current seed files): has an import batch;  old format: imported before the update
SELECT CASE WHEN o.import_batch_id IS NOT NULL THEN 'new format (current seed files)'
            ELSE 'old format (earlier seed files)' END AS format,
       count(*) AS companies,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'))
         AS claimed_by_users
FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%'
GROUP BY 1;

-- 3. Problems (all must be 0)
SELECT
  (SELECT count(*) FROM (SELECT source_ref FROM organizations WHERE source_ref LIKE 'india_mfr_research:%'
                         GROUP BY source_ref HAVING count(*) > 1) d)                                         AS duplicate_imports,
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%'
     AND NOT EXISTS (SELECT 1 FROM organization_profiles p WHERE p.organization_id = o.id))                  AS companies_without_profile,
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%'
     AND o.record_type <> 'REAL'
     AND NOT EXISTS (SELECT 1 FROM admin_change_history h WHERE h.manufacturer_id = o.id
                     AND h.field_changed = 'Record type'))                                                   AS not_real_without_admin_change;

-- 4. Import batches written by the seed files (one per file; a re-run only updates last_run_at)
SELECT source_reference, row_count, created_at, last_run_at,
       (SELECT count(*) FROM organizations o WHERE o.import_batch_id = b.id) AS companies_in_batch
FROM import_batches b
WHERE b.imported_by LIKE 'research_seed:%'
ORDER BY created_at;

-- 5. Whole picture: every manufacturer by origin and type
SELECT CASE WHEN o.source_ref LIKE 'india_mfr_research:%' THEN 'research import' ELSE 'other company' END AS origin,
       o.record_type, count(*) AS companies
FROM organizations o WHERE o.organization_type = 'manufacturer'
GROUP BY 1, 2 ORDER BY 1, 2;
