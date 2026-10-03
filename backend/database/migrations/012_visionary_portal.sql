-- Visionaries portal (demand side): profile, project, manufacturing requests.
-- Additive and safe to run repeatedly. Run after 011_welcome_email.sql.
--
-- Reuses the existing model wherever it fits:
--   users / organizations (type 'buyer') / memberships  -> who the Visionary is
--   marketplace_role_selections ('demand_requester')     -> the Visionary persona
--   opportunities                                        -> the Visionary's project
--   engagements + engagement_participants                -> Visionary <-> Manufacturer link
--   manufacturer_booking_requests                        -> the request the Manufacturer
--                                                           dashboard already lists
-- New tables only hold what the Visionary screens collect and nothing else stores.
-- Manufacturer and Admin tables are not altered; existing data is untouched.

-- Unit used for requested quantities ("units"). manufacturer_booking_requests.unit_code
-- references units(code).
INSERT INTO units (code, dimension, conversion_group)
VALUES ('units', 'count', 'count')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Step 1 "Let's Start With You": one profile per user.
-- organization_id = the user's own 'buyer' organization (created with the profile),
-- used as the demand side of every request the Visionary sends.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visionary_profiles (
    user_id           UUID PRIMARY KEY,
    organization_id   UUID NOT NULL,
    full_name         TEXT NOT NULL,
    role_title        TEXT NOT NULL,
    organization_name TEXT,
    location          TEXT NOT NULL,
    introduction      TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_visionary_profiles_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_visionary_profiles_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
    CONSTRAINT uq_visionary_profiles_org UNIQUE (organization_id),
    CONSTRAINT chk_visionary_profiles_name CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_visionary_profiles_role CHECK (char_length(btrim(role_title)) BETWEEN 1 AND 120),
    CONSTRAINT chk_visionary_profiles_org_name CHECK (organization_name IS NULL OR char_length(organization_name) <= 160),
    CONSTRAINT chk_visionary_profiles_location CHECK (char_length(btrim(location)) BETWEEN 1 AND 120),
    CONSTRAINT chk_visionary_profiles_intro CHECK (introduction IS NULL OR char_length(introduction) <= 300)
);

-- ---------------------------------------------------------------------------
-- Steps 2-4: the project. Identity, title and lifecycle live on `opportunities`
-- (title = project name, narrative = idea description, status draft -> active ->
-- matched). This table holds the Visionary-specific fields, one row per opportunity.
-- Fields are nullable because each step is saved as it is completed ("Previous"
-- also saves what was typed); completeness is checked when a request is sent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visionary_projects (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id           UUID NOT NULL,
    user_id                  UUID NOT NULL,
    product                  TEXT,
    industry                 TEXT,
    project_stage            TEXT,
    manufacturing_location   TEXT,
    quantity                 INTEGER,
    quantity_unit            TEXT NOT NULL DEFAULT 'units',
    budget_amount            NUMERIC(14,2),
    budget_currency          CHAR(3) NOT NULL DEFAULT 'INR',
    timeline                 TEXT,
    additional_requirements  TEXT,
    idea_saved_at            TIMESTAMPTZ,
    stage_saved_at           TIMESTAMPTZ,
    requirements_saved_at    TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_visionary_projects_opportunity
        FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE CASCADE,
    CONSTRAINT fk_visionary_projects_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT uq_visionary_projects_opportunity UNIQUE (opportunity_id),
    CONSTRAINT chk_visionary_projects_product CHECK (product IS NULL OR char_length(product) <= 160),
    CONSTRAINT chk_visionary_projects_industry CHECK (industry IS NULL OR char_length(industry) <= 120),
    CONSTRAINT chk_visionary_projects_stage CHECK (project_stage IS NULL OR project_stage IN
        ('Idea Stage','Design Stage','Prototype Stage','Ready for Manufacturing')),
    CONSTRAINT chk_visionary_projects_location CHECK (manufacturing_location IS NULL OR char_length(manufacturing_location) <= 120),
    CONSTRAINT chk_visionary_projects_quantity CHECK (quantity IS NULL OR quantity > 0),
    CONSTRAINT chk_visionary_projects_unit CHECK (quantity_unit = 'units'),
    CONSTRAINT chk_visionary_projects_budget CHECK (budget_amount IS NULL OR budget_amount > 0),
    CONSTRAINT chk_visionary_projects_currency CHECK (budget_currency = 'INR'),
    CONSTRAINT chk_visionary_projects_timeline CHECK (timeline IS NULL OR timeline IN
        ('immediately','within_1_month','1_3_months','3_6_months')),
    CONSTRAINT chk_visionary_projects_additional CHECK (additional_requirements IS NULL OR char_length(additional_requirements) <= 500)
);

CREATE INDEX IF NOT EXISTS ix_visionary_projects_user
    ON visionary_projects (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- "Create Manufacturing Request" -> "Send Request to Manufacturer".
-- The request itself is a manufacturer_booking_requests row (the Manufacturer
-- dashboard's booking list reads it unchanged); this table holds the fields the
-- request form adds, plus the names as they were when the request was sent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visionary_request_details (
    booking_request_id       UUID PRIMARY KEY,
    project_id               UUID NOT NULL,
    machine_name             TEXT NOT NULL,
    machine_id               UUID,
    required_duration        TEXT NOT NULL,
    manufacturing_location   TEXT NOT NULL,
    budget_amount            NUMERIC(14,2) NOT NULL,
    budget_currency          CHAR(3) NOT NULL DEFAULT 'INR',
    timeline                 TEXT NOT NULL,
    additional_requirements  TEXT,
    project_name             TEXT NOT NULL,
    visionary_name           TEXT NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_visionary_request_details_request
        FOREIGN KEY (booking_request_id) REFERENCES manufacturer_booking_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_visionary_request_details_project
        FOREIGN KEY (project_id) REFERENCES visionary_projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_visionary_request_details_machine
        FOREIGN KEY (machine_id) REFERENCES machines(id) ON DELETE SET NULL,
    CONSTRAINT chk_visionary_request_machine CHECK (char_length(btrim(machine_name)) BETWEEN 1 AND 160),
    CONSTRAINT chk_visionary_request_duration CHECK (required_duration IN
        ('1_week','2_weeks','1_month','2_months','3_months','6_months')),
    CONSTRAINT chk_visionary_request_location CHECK (char_length(btrim(manufacturing_location)) BETWEEN 1 AND 120),
    CONSTRAINT chk_visionary_request_budget CHECK (budget_amount > 0),
    CONSTRAINT chk_visionary_request_currency CHECK (budget_currency = 'INR'),
    CONSTRAINT chk_visionary_request_timeline CHECK (timeline IN
        ('immediately','within_1_month','1_3_months','3_6_months')),
    CONSTRAINT chk_visionary_request_additional CHECK (additional_requirements IS NULL OR char_length(additional_requirements) <= 500)
);

CREATE INDEX IF NOT EXISTS ix_visionary_request_details_project
    ON visionary_request_details (project_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Request form "Save": one draft per Visionary and Manufacturer, removed when the
-- request is sent (same behaviour as before, now kept on the server).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visionary_request_drafts (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                        UUID NOT NULL,
    manufacturer_organization_id   UUID NOT NULL,
    machine_name                   TEXT,
    quantity                       INTEGER,
    required_duration              TEXT,
    manufacturing_location         TEXT,
    budget_amount                  NUMERIC(14,2),
    timeline                       TEXT,
    additional_requirements        TEXT,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_visionary_request_drafts_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_visionary_request_drafts_org
        FOREIGN KEY (manufacturer_organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT uq_visionary_request_drafts UNIQUE (user_id, manufacturer_organization_id),
    CONSTRAINT chk_visionary_draft_machine CHECK (machine_name IS NULL OR char_length(machine_name) <= 160),
    CONSTRAINT chk_visionary_draft_quantity CHECK (quantity IS NULL OR quantity > 0),
    CONSTRAINT chk_visionary_draft_duration CHECK (required_duration IS NULL OR required_duration IN
        ('1_week','2_weeks','1_month','2_months','3_months','6_months')),
    CONSTRAINT chk_visionary_draft_location CHECK (manufacturing_location IS NULL OR char_length(manufacturing_location) <= 120),
    CONSTRAINT chk_visionary_draft_budget CHECK (budget_amount IS NULL OR budget_amount > 0),
    CONSTRAINT chk_visionary_draft_timeline CHECK (timeline IS NULL OR timeline IN
        ('immediately','within_1_month','1_3_months','3_6_months')),
    CONSTRAINT chk_visionary_draft_additional CHECK (additional_requirements IS NULL OR char_length(additional_requirements) <= 500)
);

-- Visionary request history ("My Project", "Request summary").
CREATE INDEX IF NOT EXISTS ix_mbr_requested_by
    ON manufacturer_booking_requests (requested_by_user_id, created_at DESC);

-- updated_at maintenance (xy_set_updated_at() comes from XY_Database_Schema.sql).
DROP TRIGGER IF EXISTS trg_visionary_profiles_updated_at ON visionary_profiles;
CREATE TRIGGER trg_visionary_profiles_updated_at
    BEFORE UPDATE ON visionary_profiles FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
DROP TRIGGER IF EXISTS trg_visionary_projects_updated_at ON visionary_projects;
CREATE TRIGGER trg_visionary_projects_updated_at
    BEFORE UPDATE ON visionary_projects FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
DROP TRIGGER IF EXISTS trg_visionary_request_drafts_updated_at ON visionary_request_drafts;
CREATE TRIGGER trg_visionary_request_drafts_updated_at
    BEFORE UPDATE ON visionary_request_drafts FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();

-- Same as the Manufacturer tables (004): only the backend's database role reads and
-- writes these; Supabase's public API roles get nothing.
ALTER TABLE visionary_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE visionary_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE visionary_request_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE visionary_request_drafts ENABLE ROW LEVEL SECURITY;
