-- =============================================================================
-- 023 / 4_rollback.sql — undo the one-time DEMO classification (2_apply.sql).
-- =============================================================================
-- Restores record_type 'REAL' on exactly the records 2_apply.sql changed, EXCEPT records whose
-- classification an admin has changed since (their later decision is kept; they are listed).
-- Nothing is deleted. The log rows are kept and marked rolled_back_at; each restore is also
-- written to admin_change_history. One transaction.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 4_rollback.sql
-- =============================================================================
BEGIN;

CREATE TEMP TABLE rb ON COMMIT DROP AS
SELECT l.id AS log_id, l.organization_id, o.record_type AS current_type,
       EXISTS (SELECT 1 FROM admin_change_history h WHERE h.manufacturer_id = l.organization_id
               AND h.field_changed = 'Record type' AND h.created_at > l.applied_at
               AND h.reason IS DISTINCT FROM
                   'One-time classification of existing records as demo data (023_existing_manufacturers_demo)')
         AS changed_by_admin_since
FROM record_type_classification_log l JOIN organizations o ON o.id = l.organization_id
WHERE l.run_label = '023_existing_manufacturers_demo' AND l.rolled_back_at IS NULL;

DO $$ BEGIN PERFORM 1 FROM organizations o JOIN rb r ON r.organization_id = o.id FOR UPDATE OF o; END $$;

-- Kept as they are (an admin decided since the run)
SELECT r.organization_id, o.display_name, r.current_type AS kept_record_type
FROM rb r JOIN organizations o ON o.id = r.organization_id
WHERE r.changed_by_admin_since OR r.current_type <> 'DEMO';

UPDATE organizations o SET record_type = 'REAL'
FROM rb r WHERE o.id = r.organization_id AND r.current_type = 'DEMO' AND NOT r.changed_by_admin_since;

INSERT INTO admin_change_history (manufacturer_id, field_changed, old_value, new_value, changed_by, reason)
SELECT r.organization_id, 'Record type', 'DEMO', 'REAL', NULL,
       'Rollback of the one-time demo classification (023_existing_manufacturers_demo)'
FROM rb r WHERE r.current_type = 'DEMO' AND NOT r.changed_by_admin_since;

UPDATE record_type_classification_log l SET rolled_back_at = now() FROM rb r WHERE l.id = r.log_id;

SELECT count(*) FILTER (WHERE current_type = 'DEMO' AND NOT changed_by_admin_since) AS restored_real,
       count(*) FILTER (WHERE current_type <> 'DEMO' OR changed_by_admin_since) AS kept_admin_decision
FROM rb;

COMMIT;
