-- =====================================================================================
-- Find test data — copy-paste queries for the Supabase SQL editor (read-only).
--
-- 1. Replace tester@example.com with the email you tested with (Ctrl+H, replace all).
-- 2. Select ONE query (from its comment to its semicolon) and press Run.
--    The SQL editor shows only the last result, so run one query at a time.
--
-- Prefer the terminal?  From backend/:  PYTHONPATH=. python -m app.lookup user tester@example.com
-- =====================================================================================


-- Q1  WHERE IS MY DATA? One row per table: how many rows this person has and when it last changed.
WITH me AS (SELECT id, clerk_user_id, email FROM users WHERE email = 'tester@example.com'),
     orgs AS (SELECT m.organization_id AS id FROM memberships m JOIN me ON m.user_id = me.id)
SELECT 'users' AS table_name, count(*) AS rows, max(u.updated_at) AS last_change FROM users u JOIN me ON u.id = me.id
UNION ALL SELECT 'marketplace_role_selections', count(*), max(selected_at) FROM marketplace_role_selections WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'memberships', count(*), max(created_at) FROM memberships WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'organizations', count(*), max(updated_at) FROM organizations WHERE id IN (SELECT id FROM orgs)
UNION ALL SELECT 'organization_profiles', count(*), max(updated_at) FROM organization_profiles WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_onboarding', count(*), max(updated_at) FROM manufacturer_onboarding WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_form_progress', count(*), max(updated_at) FROM manufacturer_form_progress WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'facilities', count(*), max(created_at) FROM facilities WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'organization_certifications', count(*), max(created_at) FROM organization_certifications WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_infrastructure', count(*), max(updated_at) FROM manufacturer_infrastructure WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_faq_answers', count(*), max(updated_at) FROM manufacturer_faq_answers WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'machines', count(*), max(created_at) FROM machines WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_availability_preferences', count(*), max(updated_at) FROM manufacturer_availability_preferences WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'manufacturer_booking_requests (received)', count(*), max(updated_at) FROM manufacturer_booking_requests WHERE manufacturer_organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'files', count(*), max(created_at) FROM files WHERE organization_id IN (SELECT id FROM orgs)
UNION ALL SELECT 'notifications', count(*), max(created_at) FROM notifications WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'visionary_profiles', count(*), max(updated_at) FROM visionary_profiles WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'visionary_projects', count(*), max(updated_at) FROM visionary_projects WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'visionary_request_drafts', count(*), max(updated_at) FROM visionary_request_drafts WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'manufacturer_booking_requests (sent)', count(*), max(updated_at) FROM manufacturer_booking_requests WHERE requested_by_user_id IN (SELECT id FROM me)
UNION ALL SELECT 'admin_accounts', count(*), max(updated_at) FROM admin_accounts WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'platform_role_assignments', count(*), max(granted_at) FROM platform_role_assignments WHERE user_id IN (SELECT id FROM me)
UNION ALL SELECT 'user_activity_events', count(*), max(created_at) FROM user_activity_events WHERE user_id IN (SELECT id FROM me) OR clerk_user_id IN (SELECT clerk_user_id FROM me)
UNION ALL SELECT 'email_deliveries', count(*), max(created_at) FROM email_deliveries WHERE to_email IN (SELECT email FROM me);


-- Q2  NEWEST SIGN-UPS: who registered last and what each one has.
SELECT u.email, u.created_at,
       (SELECT string_agg(DISTINCT r.role_selected, ',') FROM marketplace_role_selections r WHERE r.user_id = u.id AND r.status = 'active') AS roles,
       (SELECT o.display_name FROM memberships m JOIN organizations o ON o.id = m.organization_id
         WHERE m.user_id = u.id AND o.organization_type = 'manufacturer' LIMIT 1) AS manufacturer_company,
       (SELECT op.title FROM visionary_projects p JOIN opportunities op ON op.id = p.opportunity_id
         WHERE p.user_id = u.id ORDER BY p.created_at DESC LIMIT 1) AS visionary_project,
       u.status, u.last_seen_at
FROM users u ORDER BY u.created_at DESC LIMIT 20;


-- Q3  ACCOUNT: the users row and the companies this person belongs to.
SELECT u.id AS user_id, u.email, u.clerk_user_id, u.display_name, u.phone, u.date_of_birth, u.status, u.created_at, u.last_seen_at,
       o.id AS organization_id, o.display_name AS company, o.organization_type, m.membership_role, o.record_type, o.is_archived
FROM users u LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN organizations o ON o.id = m.organization_id
WHERE u.email = 'tester@example.com';


-- Q4  MANUFACTURER PROFILE: company, contact, onboarding progress (one row).
SELECT o.id AS organization_id, o.display_name, p.contact_email, p.contact_phone, p.country_name, p.company_category,
       p.business_type, p.organization_size, p.establishment_year, p.production_capacity_label, p.about_company,
       ob.completion_percentage, ob.status AS onboarding_status, ob.personal_information_completed AS personal,
       ob.company_information_completed AS company, ob.location_completed AS location,
       ob.certification_completed AS certification, ob.infrastructure_completed AS infrastructure, ob.faq_completed AS faq,
       ob.updated_at
FROM users u JOIN memberships m ON m.user_id = u.id
JOIN organizations o ON o.id = m.organization_id AND o.organization_type = 'manufacturer'
LEFT JOIN organization_profiles p ON p.organization_id = o.id
LEFT JOIN manufacturer_onboarding ob ON ob.organization_id = o.id
WHERE u.email = 'tester@example.com';


-- Q5  MANUFACTURER LOCATION + CERTIFICATIONS: address, serviceable areas, certificates.
SELECT 'facility' AS kind, f.name AS name, concat_ws(', ', f.address_line1, f.city, f.state_province, f.country_name, f.postal_code) AS detail,
       f.serviceable_areas::text AS extra, f.created_at
FROM users u JOIN memberships m ON m.user_id = u.id JOIN facilities f ON f.organization_id = m.organization_id
WHERE u.email = 'tester@example.com'
UNION ALL
SELECT 'certification', ct.name, oc.status, oc.document_file_name, oc.created_at
FROM users u JOIN memberships m ON m.user_id = u.id JOIN organization_certifications oc ON oc.organization_id = m.organization_id
JOIN certification_types ct ON ct.id = oc.certification_type_id
WHERE u.email = 'tester@example.com';


-- Q6  MACHINERY: every machine with its type, status and how many specs / images it has.
SELECT mc.id AS machine_id, mc.name, t.term AS machine_type, mc.status, mc.publication_status,
       (SELECT count(*) FROM machine_specs s WHERE s.machine_id = mc.id) AS specs,
       (SELECT count(*) FROM machine_images i WHERE i.machine_id = mc.id) AS images, mc.created_at
FROM users u JOIN memberships m ON m.user_id = u.id JOIN machines mc ON mc.organization_id = m.organization_id
LEFT JOIN taxonomy_terms t ON t.id = mc.machinery_term_id
WHERE u.email = 'tester@example.com' ORDER BY mc.created_at;


-- Q7  WIZARD PROGRESS + AVAILABILITY: where the profile / machinery wizards stopped, saved calendar and capacity.
SELECT 'wizard: ' || fp.form_key AS item, fp.current_step::text AS step, fp.completed_steps::text AS done, fp.status, fp.updated_at
FROM users u JOIN memberships m ON m.user_id = u.id JOIN manufacturer_form_progress fp ON fp.organization_id = m.organization_id
WHERE u.email = 'tester@example.com'
UNION ALL
SELECT 'availability', a.recurring::text, a.capacity::text, left(a.calendar::text, 120), a.updated_at
FROM users u JOIN memberships m ON m.user_id = u.id JOIN manufacturer_availability_preferences a ON a.organization_id = m.organization_id
WHERE u.email = 'tester@example.com';


-- Q8  VISIONARY: profile, project and every request sent to a manufacturer.
SELECT vp.full_name, vp.organization_name, op.title AS project, op.status AS project_status, pr.product, pr.industry,
       pr.project_stage, pr.quantity, pr.budget_amount, pr.timeline,
       br.request_number, mfr.display_name AS sent_to_manufacturer, d.machine_name, br.status AS request_status, br.created_at AS sent_at
FROM users u
LEFT JOIN visionary_profiles vp ON vp.user_id = u.id
LEFT JOIN visionary_projects pr ON pr.user_id = u.id
LEFT JOIN opportunities op ON op.id = pr.opportunity_id
LEFT JOIN visionary_request_details d ON d.project_id = pr.id
LEFT JOIN manufacturer_booking_requests br ON br.id = d.booking_request_id
LEFT JOIN organizations mfr ON mfr.id = br.manufacturer_organization_id
WHERE u.email = 'tester@example.com';


-- Q9  ONE REQUEST, BOTH SIDES: replace the request number (shown to the visionary and the manufacturer).
SELECT br.request_number, br.status, vu.email AS visionary, mfr.display_name AS manufacturer, d.machine_name,
       br.requested_capacity AS quantity, d.budget_amount, d.timeline, br.created_at, br.responded_at,
       (SELECT string_agg(coalesce(e.from_status, '-') || '>' || e.to_status, ', ' ORDER BY e.created_at)
          FROM manufacturer_booking_request_events e WHERE e.booking_request_id = br.id) AS status_history
FROM manufacturer_booking_requests br
LEFT JOIN users vu ON vu.id = br.requested_by_user_id
LEFT JOIN organizations mfr ON mfr.id = br.manufacturer_organization_id
LEFT JOIN visionary_request_details d ON d.booking_request_id = br.id
WHERE br.request_number = 'REQ-20261001-05DA2C';


-- Q10 ADMIN: admin account, roles and recent sign-ins (no password hashes or tokens).
SELECT u.email, a.status AS account_status, a.must_change_password, a.failed_attempts, a.locked_until, a.last_login_at,
       r.platform_role, r.status AS role_status, r.granted_at, r.revoked_at
FROM users u LEFT JOIN admin_accounts a ON a.user_id = u.id LEFT JOIN platform_role_assignments r ON r.user_id = u.id
WHERE u.email = 'tester@example.com' ORDER BY r.granted_at DESC;


-- Q11 WHAT WENT WRONG: failed API calls and emails for this person, newest first.
SELECT e.created_at, 'api error' AS what, e.method || ' ' || e.path AS detail, e.status_code::text AS status, e.detail AS message
FROM user_activity_events e JOIN users u ON u.id = e.user_id OR u.clerk_user_id = e.clerk_user_id
WHERE u.email = 'tester@example.com'
UNION ALL
SELECT d.created_at, 'email', d.template, d.status, d.error
FROM email_deliveries d WHERE d.to_email = 'tester@example.com'
ORDER BY created_at DESC LIMIT 30;


-- Q12 LATEST FAILED CALLS FOR EVERYONE (same as Admin -> Support -> Recent errors).
SELECT e.created_at, coalesce(u.email, e.clerk_user_id) AS who, e.method, e.path, e.status_code, e.detail, e.request_id
FROM user_activity_events e LEFT JOIN users u ON u.id = e.user_id
WHERE e.kind = 'error' ORDER BY e.created_at DESC LIMIT 30;


-- Q13 NOTIFICATIONS: what the admin portal sent this person (bell on the manufacturer dashboard).
SELECT n.created_at, n.notification_type AS kind, n.title, n.body, n.read_at, n.popup_shown_at
FROM notifications n JOIN users u ON u.id = n.user_id
WHERE u.email = 'tester@example.com' ORDER BY n.created_at DESC;
