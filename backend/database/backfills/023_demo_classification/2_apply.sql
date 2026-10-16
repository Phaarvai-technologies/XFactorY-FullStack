-- =============================================================================
-- 023 / 2_apply.sql — ONE-TIME: classify the existing manufacturer records as DEMO.
-- =============================================================================
-- Before running:
--   1. Apply migration 023 (python -m app.migrate).
--   2. Run 1_preview.sql and review section E.
--   3. Edit the two marked places below: expected_count, and (optionally) the KEEP-REAL ids.
--   4. Run it BEFORE importing the real manufacturer data (see DEMO_REAL_DATA.md, deployment order).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 2_apply.sql
--   (or: python run_seed.py 2_apply.sql ; dry run: SEED_DRY_RUN=1 python run_seed.py 2_apply.sql)
--
-- What it changes: organizations.record_type 'REAL' -> 'DEMO' for the records in SCOPE (same rules
-- as 1_preview.sql), nothing else. updated_at is left alone so "last updated" lists do not change.
-- Every change is written to record_type_classification_log (with a snapshot of status, approval
-- and owners) and to admin_change_history (visible in the admin portal's history tab).
-- It refuses to run a second time, and refuses if the count differs from what you approved.
-- One transaction: any error leaves nothing changed.
-- =============================================================================
BEGIN;

-- >>> EDIT 1: the in_scope_total you reviewed in 1_preview.sql (section B) MINUS the ids you keep REAL.
CREATE TEMP TABLE demo_params ON COMMIT DROP AS
SELECT 23::integer AS expected_count,
       '023_existing_manufacturers_demo'::text AS run_label;

-- >>> EDIT 2 (optional): ids from the preview that are genuine companies and must stay REAL.
CREATE TEMP TABLE demo_keep_real (id uuid PRIMARY KEY) ON COMMIT DROP;
-- INSERT INTO demo_keep_real (id) VALUES
--   ('00000000-0000-0000-0000-000000000000'),
--   ('00000000-0000-0000-0000-000000000001');

DO $$
DECLARE
  v_expected int; v_label text; v_found int; v_unknown int;
BEGIN
  SELECT expected_count, run_label INTO v_expected, v_label FROM demo_params;
  IF v_expected IS NULL THEN
    RAISE EXCEPTION '023 apply: set expected_count (EDIT 1) to the number reviewed in 1_preview.sql';
  END IF;
  IF to_regclass('public.record_type_classification_log') IS NULL THEN
    RAISE EXCEPTION '023 apply: run migration 023_record_type_classification.sql first';
  END IF;
  IF EXISTS (SELECT 1 FROM record_type_classification_log WHERE run_label = v_label AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION '023 apply: already applied (run_label %). It runs only once; later records are classified '
                    'in the admin portal. Use 4_rollback.sql first if you really need to redo it.', v_label;
  END IF;
  SELECT count(*) INTO v_unknown FROM demo_keep_real k
   WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = k.id AND o.organization_type = 'manufacturer');
  IF v_unknown > 0 THEN
    RAISE EXCEPTION '023 apply: % KEEP-REAL id(s) are not manufacturer organizations - check EDIT 2', v_unknown;
  END IF;
END $$;

-- Freeze the scope once (row locks: nobody can change these rows until COMMIT).
CREATE TEMP TABLE demo_scope ON COMMIT DROP AS
SELECT o.id,
       CASE WHEN o.onboarding_source IS NOT NULL THEN 'existing manufacturer (' || o.onboarding_source || ')'
            ELSE 'existing manufacturer (source unknown)' END AS rule,
       jsonb_build_object(
         'status', o.status, 'verification_status', o.verification_status, 'is_archived', o.is_archived,
         'created_by_user_id', o.created_by_user_id, 'entry_source', o.entry_source,
         'onboarding_source', o.onboarding_source,
         'approval', (SELECT mo.status FROM manufacturer_onboarding mo WHERE mo.organization_id = o.id),
         'members', coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', m.user_id, 'role', m.membership_role,
                                                                   'status', m.status) ORDER BY m.user_id)
                              FROM memberships m WHERE m.organization_id = o.id), '[]'::jsonb)
       ) AS snapshot
FROM organizations o
WHERE o.organization_type = 'manufacturer'
  AND o.record_type = 'REAL'
  AND o.created_at < now()                                    -- now() = start of this transaction
  AND (o.source_ref IS NULL OR o.source_ref NOT LIKE 'india_mfr_research:%')
  AND NOT EXISTS (SELECT 1 FROM demo_keep_real k WHERE k.id = o.id);

DO $$ BEGIN PERFORM 1 FROM organizations o JOIN demo_scope s ON s.id = o.id FOR UPDATE OF o; END $$;

DO $$
DECLARE v_expected int; v_found int;
BEGIN
  SELECT expected_count INTO v_expected FROM demo_params;
  SELECT count(*) INTO v_found FROM demo_scope;
  IF v_found <> v_expected THEN
    RAISE EXCEPTION '023 apply: % records in scope now, but expected_count is %. Re-run 1_preview.sql and review '
                    'the difference before applying.', v_found, v_expected;
  END IF;
END $$;

INSERT INTO record_type_classification_log (run_label, organization_id, old_record_type, new_record_type, rule, snapshot)
SELECT p.run_label, s.id, 'REAL', 'DEMO', s.rule, s.snapshot FROM demo_scope s CROSS JOIN demo_params p
ON CONFLICT (run_label, organization_id) DO UPDATE      -- only after a full 4_rollback.sql
  SET rule = EXCLUDED.rule, snapshot = EXCLUDED.snapshot, applied_at = now(), rolled_back_at = NULL;

UPDATE organizations o SET record_type = 'DEMO'                -- updated_at intentionally unchanged
FROM demo_scope s WHERE o.id = s.id AND o.record_type = 'REAL';

INSERT INTO admin_change_history (manufacturer_id, field_changed, old_value, new_value, changed_by, reason)
SELECT s.id, 'Record type', 'REAL', 'DEMO', NULL,
       'One-time classification of existing records as demo data (023_existing_manufacturers_demo)'
FROM demo_scope s;

-- In-transaction checks: abort everything on any mismatch.
DO $$
DECLARE v_n int; v_bad int;
BEGIN
  SELECT count(*) INTO v_n FROM demo_scope;
  SELECT count(*) INTO v_bad FROM demo_scope s JOIN organizations o ON o.id = s.id WHERE o.record_type <> 'DEMO';
  IF v_bad > 0 THEN RAISE EXCEPTION '023 apply: % records did not change', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM demo_scope s JOIN organizations o ON o.id = s.id
   WHERE o.status IS DISTINCT FROM s.snapshot->>'status'
      OR o.verification_status IS DISTINCT FROM s.snapshot->>'verification_status'
      OR o.created_by_user_id::text IS DISTINCT FROM s.snapshot->>'created_by_user_id'
      OR o.onboarding_source IS DISTINCT FROM s.snapshot->>'onboarding_source';
  IF v_bad > 0 THEN RAISE EXCEPTION '023 apply: % records changed more than record_type', v_bad; END IF;
  SELECT count(*) INTO v_bad FROM organizations o
   WHERE o.organization_type <> 'manufacturer' AND o.record_type = 'DEMO'
     AND EXISTS (SELECT 1 FROM demo_scope s WHERE s.id = o.id);
  IF v_bad > 0 THEN RAISE EXCEPTION '023 apply: non-manufacturer organizations in scope'; END IF;
  RAISE NOTICE '023 apply OK: % manufacturer records classified DEMO', v_n;
END $$;

SELECT count(*) AS classified_demo FROM demo_scope;

COMMIT;
