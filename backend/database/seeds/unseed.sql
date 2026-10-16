-- =============================================================================
-- unseed.sql — remove ONLY the rows created by seed_part1.sql / seed_part2.sql
-- =============================================================================
-- Removes imported organizations (source_ref LIKE 'india_mfr_research:%') that are still
-- untouched: status 'claim_pending', unverified, no creator, no members. Any imported org that
-- someone has since claimed, verified or joined is KEPT.
-- Also removes those orgs' admin_internal_notes, facilities and organization_profiles.
-- If any other table references one of these orgs, the whole script fails and rolls back —
-- nothing is deleted.
-- The countries row 'IN' is left in place (it may be used elsewhere).
-- Run:  python database\seeds\run_seed.py database\seeds\unseed.sql
-- =============================================================================
BEGIN;

CREATE TEMP TABLE unseed_orgs ON COMMIT DROP AS
SELECT o.id
  FROM public.organizations o
 WHERE o.source_ref LIKE 'india_mfr_research:%'
   AND o.entry_source = 'IMPORTED'
   AND o.status = 'claim_pending'
   AND o.verification_status = 'unverified'
   AND o.created_by_user_id IS NULL
   AND o.clerk_organization_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.organization_id = o.id);

SELECT count(*) AS organizations_to_remove FROM unseed_orgs;

DELETE FROM public.admin_internal_notes n USING unseed_orgs u WHERE n.manufacturer_id = u.id;
DELETE FROM public.facilities f          USING unseed_orgs u WHERE f.organization_id = u.id;
DELETE FROM public.organization_profiles p USING unseed_orgs u WHERE p.organization_id = u.id;
DELETE FROM public.organizations o       USING unseed_orgs u WHERE o.id = u.id;

SELECT count(*) AS imported_orgs_remaining
  FROM public.organizations WHERE source_ref LIKE 'india_mfr_research:%';

COMMIT;
