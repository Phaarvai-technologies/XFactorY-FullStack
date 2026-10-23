-- Visionary "Manufacturing needs": the machines / manufacturing capabilities the project needs
-- (the multi-select on that step, e.g. Injection Moulding + CNC Machining). Until now they were kept
-- only in the browser tab (sessionStorage), so they were lost on another device / a new tab and
-- the backend could not match manufacturers on them. Additive and idempotent.
ALTER TABLE visionary_projects
    ADD COLUMN IF NOT EXISTS required_machines TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_visionary_projects_required_machines') THEN
        ALTER TABLE visionary_projects ADD CONSTRAINT chk_visionary_projects_required_machines
            CHECK (cardinality(required_machines) <= 30);
    END IF;
END $$;
