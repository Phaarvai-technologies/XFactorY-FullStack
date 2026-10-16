-- all_data.sql — READ ONLY. Every manufacturer company, Real and Demo together.
-- Run:  python database\seeds\run_seed.py database\seeds\all_data.sql

-- 1. Totals by type and origin
SELECT o.record_type,
       CASE WHEN o.source_ref LIKE 'india_mfr_research:TN-%' THEN 'Tamil Nadu import'
            WHEN o.source_ref LIKE 'india_mfr_research:%'    THEN 'India import'
            ELSE 'existing company' END AS origin,
       count(*) AS companies
FROM organizations o
WHERE o.organization_type = 'manufacturer'
GROUP BY 1, 2
UNION ALL
SELECT 'ALL', 'Real + Demo', count(*) FROM organizations WHERE organization_type = 'manufacturer'
ORDER BY 1, 2;

-- 2. Sample: all Demo companies + the first 20 Real companies (A-Z)
(SELECT o.record_type, o.display_name, f.city, f.state_province,
        (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id) AS approval
   FROM organizations o
   LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
  WHERE o.organization_type = 'manufacturer' AND o.record_type <> 'REAL')
UNION ALL
(SELECT o.record_type, o.display_name, f.city, f.state_province,
        (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id)
   FROM organizations o
   LEFT JOIN facilities f ON f.organization_id = o.id AND f.is_headquarters
  WHERE o.organization_type = 'manufacturer' AND o.record_type = 'REAL'
  ORDER BY o.display_name
  LIMIT 20)
ORDER BY 1, 2;
