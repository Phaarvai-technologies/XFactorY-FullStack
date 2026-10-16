-- check_tn_india.sql — READ ONLY. Shows that the India and Tamil Nadu research data is in the database.
-- Run:  python database\seeds\run_seed.py database\seeds\check_tn_india.sql
--
-- IDs in the research files:  IN-...  = India database,  TN-...  = Tamil Nadu database.
-- Every Tamil Nadu company was imported through seed_part2_NEW.sql (same research IDs).

-- 1. Totals: India + Tamil Nadu
SELECT CASE WHEN o.source_ref LIKE 'india_mfr_research:TN-%' THEN 'Tamil Nadu database (TN- ids)'
            ELSE 'India database (IN- ids)' END AS source,
       o.record_type, count(*) AS companies
FROM organizations o
WHERE o.source_ref LIKE 'india_mfr_research:%'
GROUP BY 1, 2
UNION ALL
SELECT 'TOTAL imported', NULL, count(*) FROM organizations WHERE source_ref LIKE 'india_mfr_research:%'
ORDER BY 1;

-- 2. Imported companies located in Tamil Nadu (from either database), by headquarters state
SELECT coalesce(f.state_province, '(no state)') AS state, count(*) AS companies
FROM organizations o
LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
WHERE o.source_ref LIKE 'india_mfr_research:%'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 15;

-- 3. Problems (all must be 0)
SELECT
  (SELECT count(*) FROM (SELECT source_ref FROM organizations WHERE source_ref LIKE 'india_mfr_research:%'
                         GROUP BY source_ref HAVING count(*) > 1) d)                       AS duplicate_imports,
  (SELECT count(*) FROM organizations WHERE source_ref LIKE 'india_mfr_research:%'
                                         AND record_type <> 'REAL')                        AS imported_not_real,
  (SELECT count(*) FROM organizations o JOIN manufacturer_onboarding mo ON mo.organization_id = o.id
     WHERE o.source_ref LIKE 'india_mfr_research:%' AND mo.status = 'approved')            AS imported_auto_approved,
  (SELECT count(*) FROM organizations o WHERE o.source_ref LIKE 'india_mfr_research:%'
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id))              AS imported_with_owner;

-- 4. Five sample Tamil Nadu companies
SELECT o.display_name, f.city, f.state_province, o.record_type, o.source_ref
FROM organizations o
LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
WHERE o.source_ref LIKE 'india_mfr_research:TN-%'
ORDER BY o.display_name
LIMIT 5;
