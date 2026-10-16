-- list_demo.sql — READ ONLY. Lists every Demo / Test manufacturer company.
-- Run:  python database\seeds\run_seed.py database\seeds\list_demo.sql

SELECT record_type, count(*) AS companies
FROM organizations WHERE organization_type = 'manufacturer'
GROUP BY record_type ORDER BY record_type;

SELECT o.display_name, o.record_type, o.created_at::date AS created,
       (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id) AS approval,
       o.id
FROM organizations o
WHERE o.organization_type = 'manufacturer' AND o.record_type <> 'REAL'
ORDER BY o.display_name;
