-- =====================================================================
-- X!Y Platform — Complete Database Design (Schema Only)
-- Consolidated from migrations 001 (core, 120 tables) and 003
-- (manufacturer extension, 8 tables). Seed/reference data has been
-- split out into XY_Database_Seed_Data.sql — run this file first.
--
-- Target: PostgreSQL 16 with the pgcrypto, citext, and postgis
-- extensions available on the server.
--
-- Apply with:
--   psql "postgresql://xy:xy@localhost:5432/xy_project" -f XY_Database_Schema.sql
--   psql "postgresql://xy:xy@localhost:5432/xy_project" -f XY_Database_Seed_Data.sql
-- =====================================================================

-- ================= PART 1: CORE SCHEMA (120 tables) =================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS postgis;    -- GEOGRAPHY(Point,4326)
-- CREATE EXTENSION IF NOT EXISTS vector;  -- pgvector; enable in production, not preinstalled in this sandbox


-- ============================== DOMAIN: identity ==============================

-- Canonical reference of the 10 platform personas (P01-P10) used across the architecture diagrams, mapped to how each is actually expressed in the data model. Single source of truth reconciling the persona diagrams with organization_type / role_selected / membership_role / platform_role.
CREATE TABLE "personas" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "persona_group" TEXT NOT NULL,
    "maps_to_organization_type" TEXT,
    "maps_to_role_selected" TEXT,
    "maps_to_membership_role" TEXT,
    "maps_to_platform_role" TEXT,
    "description" TEXT,
    CONSTRAINT pk_personas PRIMARY KEY ("code"),
    CONSTRAINT chk_personas_1 CHECK (persona_group IN ('organization_side','elevated_authority','platform_side'))
);

-- Canonical natural-person identity for anyone on the platform (any org, any role).
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clerk_user_id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "display_name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-US',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "accepted_terms_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_users PRIMARY KEY ("id"),
    CONSTRAINT uq_users_clerk_user_id UNIQUE ("clerk_user_id"),
    CONSTRAINT uq_users_email UNIQUE ("email"),
    CONSTRAINT chk_users_1 CHECK (status IN ('active','suspended','deactivated'))
);

-- External login identity linked to exactly one user (supports multiple providers per person).
CREATE TABLE "user_auth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'clerk',
    "provider_subject" TEXT NOT NULL,
    "contact_verified_at" TIMESTAMPTZ,
    "last_authenticated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_user_auth_identities PRIMARY KEY ("id"),
    CONSTRAINT uq_user_auth_identities_provider_provider_subject UNIQUE ("provider", "provider_subject")
);

-- A company/tenant record — the tenant boundary for every owned row in the system.
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clerk_organization_id" TEXT,
    "legal_name" TEXT,
    "display_name" TEXT NOT NULL,
    "organization_type" TEXT NOT NULL,
    "industry_id" UUID,
    "description" TEXT,
    "website_domain" TEXT,
    "primary_geography" TEXT,
    "status" TEXT NOT NULL DEFAULT 'claim_pending',
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "created_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_organizations PRIMARY KEY ("id"),
    CONSTRAINT uq_organizations_clerk_organization_id UNIQUE ("clerk_organization_id"),
    CONSTRAINT chk_organizations_1 CHECK (status IN ('claim_pending','active','suspended','closed')),
    CONSTRAINT chk_organizations_2 CHECK (verification_status IN ('unverified','pending','verified','expired')),
    CONSTRAINT chk_organizations_3 CHECK (organization_type IN ('buyer','manufacturer','vendor','labor_supplier','channel_partner','logistics','compliance_provider','investor'))
);

-- Sensitive/registration-grade org detail, access-restricted separately from the public organizations row.
CREATE TABLE "organization_profiles" (
    "organization_id" UUID NOT NULL,
    "registration_id" TEXT,
    "tax_id" TEXT,
    "contact_email" CITEXT,
    "contact_phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "country_code" CHAR(2),
    "region_code" TEXT,
    "postal_code" TEXT,
    "service_area" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_organization_profiles PRIMARY KEY ("organization_id")
);

-- Revocable authority relationship between one user and one organization.
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "membership_role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "invited_by" UUID,
    "accepted_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_memberships PRIMARY KEY ("id"),
    CONSTRAINT uq_memberships_organization_id_user_id UNIQUE ("organization_id", "user_id"),
    CONSTRAINT chk_memberships_1 CHECK (membership_role IN ('owner','admin','member','viewer')),
    CONSTRAINT chk_memberships_2 CHECK (status IN ('active','suspended','removed'))
);

-- Time-bounded invitation to join an organization; independent lifecycle from the membership it may become.
CREATE TABLE "membership_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invited_email" CITEXT NOT NULL,
    "proposed_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invited_by_membership_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_membership_invitations PRIMARY KEY ("id"),
    CONSTRAINT uq_membership_invitations_organization_id_invited_email_status UNIQUE ("organization_id", "invited_email", "status"),
    CONSTRAINT chk_membership_invitations_1 CHECK (proposed_role IN ('owner','admin','member','viewer')),
    CONSTRAINT chk_membership_invitations_2 CHECK (status IN ('pending','accepted','expired','revoked'))
);

-- Marks a user as experiencing X!Y as a given persona. UI configuration only — grants no authority by itself.
CREATE TABLE "marketplace_role_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "role_selected" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "selected_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_marketplace_role_selections PRIMARY KEY ("id"),
    CONSTRAINT chk_marketplace_role_selections_1 CHECK (status IN ('active','inactive')),
    CONSTRAINT chk_marketplace_role_selections_2 CHECK (role_selected IN ('demand_requester','manufacturer','vendor','labor_supplier','market_lead','logistics_provider','investor','legal_compliance'))
);

-- Privileged X!Y operating authority: Verification Analyst, Matchmaking/Support Specialist, Platform Administrator, Platform Operator.
CREATE TABLE "platform_role_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "platform_role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "granted_by_user_id" UUID,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "revoked_at" TIMESTAMPTZ,
    CONSTRAINT pk_platform_role_assignments PRIMARY KEY ("id"),
    CONSTRAINT chk_platform_role_assignments_1 CHECK (platform_role IN ('verification_analyst','support_specialist','platform_administrator','platform_operator')),
    CONSTRAINT chk_platform_role_assignments_2 CHECK (status IN ('active','expired','revoked'))
);


-- ============================== DOMAIN: taxonomy ==============================

-- Single canonical, versioned, self-referencing vocabulary covering industry / process / machinery / material / certification-type terms. Replaces five separate lookup tables.
CREATE TABLE "taxonomy_terms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "term_type" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "code" TEXT,
    "parent_term_id" UUID,
    "synonyms" TEXT[],
    "taxonomy_version" TEXT NOT NULL DEFAULT 'v1',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_taxonomy_terms PRIMARY KEY ("id"),
    CONSTRAINT uq_taxonomy_terms_term_type_code_taxonomy_version UNIQUE ("term_type", "code", "taxonomy_version"),
    CONSTRAINT chk_taxonomy_terms_1 CHECK (term_type IN ('industry','process','machinery','material','certification')),
    CONSTRAINT chk_taxonomy_terms_2 CHECK (status IN ('proposed','active','deprecated','retired'))
);

-- Units of measure and their conversion group.
CREATE TABLE "units" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "conversion_group" TEXT,
    CONSTRAINT pk_units PRIMARY KEY ("id"),
    CONSTRAINT uq_units_code UNIQUE ("code")
);

-- ISO country reference.
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT pk_countries PRIMARY KEY ("code")
);

-- Sub-country region reference.
CREATE TABLE "regions" (
    "country_code" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT pk_regions PRIMARY KEY ("country_code", "code")
);


-- ============================== DOMAIN: supply ==============================

-- A physical plant/location through which an organization provides capability.
CREATE TABLE "facilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "facility_type" TEXT,
    "address" TEXT,
    "country_code" CHAR(2),
    "region_code" TEXT,
    "postal_code" TEXT,
    "location" GEOGRAPHY(Point,4326),
    "timezone" TEXT DEFAULT 'UTC',
    "contact_profile_id" UUID,
    "operating_summary" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_facilities PRIMARY KEY ("id"),
    CONSTRAINT chk_facilities_1 CHECK (visibility IN ('private','matched_participant','public')),
    CONSTRAINT chk_facilities_2 CHECK (status IN ('draft','published','hidden','suspended'))
);

-- What an organization can provide: process, equipment, material, service, or certification — classified against taxonomy_terms.
CREATE TABLE "capabilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "capability_type" TEXT NOT NULL,
    "taxonomy_term_id" UUID NOT NULL,
    "source_term" TEXT,
    "description" TEXT,
    "claim_state" TEXT NOT NULL DEFAULT 'self_declared',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "freshness_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_capabilities PRIMARY KEY ("id"),
    CONSTRAINT chk_capabilities_1 CHECK (capability_type IN ('process','equipment','material','service','certification')),
    CONSTRAINT chk_capabilities_2 CHECK (claim_state IN ('self_declared','evidence_submitted','verified','stale','suspended')),
    CONSTRAINT chk_capabilities_3 CHECK (visibility IN ('private','matched_participant','public'))
);

-- Provenance record mapping an org's own wording to the canonical taxonomy term used on a capability.
CREATE TABLE "capability_taxonomy_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "taxonomy_term_id" UUID NOT NULL,
    "taxonomy_version" TEXT NOT NULL,
    "mapping_status" TEXT NOT NULL DEFAULT 'proposed',
    "mapped_by" TEXT NOT NULL DEFAULT 'user',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_capability_taxonomy_mappings PRIMARY KEY ("id"),
    CONSTRAINT chk_capability_taxonomy_mappings_1 CHECK (mapping_status IN ('proposed','approved','retired')),
    CONSTRAINT chk_capability_taxonomy_mappings_2 CHECK (mapped_by IN ('user','ai','operator'))
);

-- Material range attached to a capability (many-to-many with quantity bounds).
CREATE TABLE "capability_materials" (
    "capability_id" UUID NOT NULL,
    "material_term_id" UUID NOT NULL,
    "min_qty" NUMERIC(18,4),
    "max_qty" NUMERIC(18,4),
    "unit_code" TEXT,
    CONSTRAINT pk_capability_materials PRIMARY KEY ("capability_id", "material_term_id"),
    CONSTRAINT chk_capability_materials_1 CHECK (max_qty IS NULL OR min_qty IS NULL OR max_qty >= min_qty)
);

-- Certifications that back a specific capability claim.
CREATE TABLE "capability_certifications" (
    "capability_id" UUID NOT NULL,
    "certification_id" UUID NOT NULL,
    "evidence_id" UUID,
    CONSTRAINT pk_capability_certifications PRIMARY KEY ("capability_id", "certification_id")
);

-- Granular, individually-sourced sub-claims within a capability (e.g. a specific tolerance figure), with confidentiality and verification tracked per claim.
CREATE TABLE "capability_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "claim_type" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'self_declared',
    "scope" TEXT,
    "confidentiality" TEXT NOT NULL DEFAULT 'restricted',
    "freshness_at" TIMESTAMPTZ,
    "verification_status" TEXT NOT NULL DEFAULT 'unverified',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_capability_claims PRIMARY KEY ("id"),
    CONSTRAINT chk_capability_claims_1 CHECK (source IN ('self_declared','agent_suggested','verified')),
    CONSTRAINT chk_capability_claims_2 CHECK (confidentiality IN ('public','matched_participant','restricted')),
    CONSTRAINT chk_capability_claims_3 CHECK (verification_status IN ('unverified','pending','verified','rejected'))
);

-- Nonbinding availability/capacity signal for a capability, as of a specific time.
CREATE TABLE "availability_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "capability_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "capacity_signal" TEXT,
    "as_of" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "recorded_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_availability_snapshots PRIMARY KEY ("id"),
    CONSTRAINT chk_availability_snapshots_1 CHECK (status IN ('current','stale','withdrawn'))
);

-- A specific physical machine listed by an organization (equipment marketplace).
CREATE TABLE "machines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "machinery_term_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "year" SMALLINT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "publication_status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_machines PRIMARY KEY ("id"),
    CONSTRAINT chk_machines_1 CHECK (status IN ('active','archived')),
    CONSTRAINT chk_machines_2 CHECK (publication_status IN ('draft','published','hidden'))
);

-- Structured spec sheet for a machine.
CREATE TABLE "machine_specs" (
    "machine_id" UUID NOT NULL,
    "spec_code" TEXT NOT NULL,
    "value_numeric" NUMERIC(18,4),
    "value_text" TEXT,
    "unit_code" TEXT,
    CONSTRAINT pk_machine_specs PRIMARY KEY ("machine_id", "spec_code")
);

-- Images attached to a machine listing.
CREATE TABLE "machine_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "machine_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "display_order" SMALLINT NOT NULL DEFAULT 0,
    "alt_text" TEXT,
    CONSTRAINT pk_machine_images PRIMARY KEY ("id")
);

-- A service (logistics, testing, design, etc.) offered by an organization, distinct from a physical capability.
CREATE TABLE "service_offerings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider_type" TEXT NOT NULL,
    "facility_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "publication_status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_service_offerings PRIMARY KEY ("id"),
    CONSTRAINT chk_service_offerings_1 CHECK (status IN ('active','archived')),
    CONSTRAINT chk_service_offerings_2 CHECK (publication_status IN ('draft','published','hidden'))
);


-- ============================== DOMAIN: inventory ==============================

-- A sellable/bookable item — either a machine or a service offering — unified for pricing/availability.
CREATE TABLE "inventory_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "item_type" TEXT NOT NULL,
    "machine_id" UUID,
    "service_offering_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_inventory_items PRIMARY KEY ("id"),
    CONSTRAINT chk_inventory_items_1 CHECK (item_type IN ('machine','service_offering')),
    CONSTRAINT chk_inventory_items_2 CHECK ((item_type='machine' AND machine_id IS NOT NULL AND service_offering_id IS NULL) OR (item_type='service_offering' AND service_offering_id IS NOT NULL AND machine_id IS NULL))
);

-- A currency-scoped, time-bounded price list owned by an organization.
CREATE TABLE "price_books" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_price_books PRIMARY KEY ("id"),
    CONSTRAINT chk_price_books_1 CHECK (status IN ('draft','active','expired')),
    CONSTRAINT chk_price_books_2 CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- A single priced line within a price book.
CREATE TABLE "price_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "price_book_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "pricing_model" TEXT NOT NULL,
    "amount" NUMERIC(18,4) NOT NULL,
    "unit_code" TEXT,
    "minimum_quantity" NUMERIC(18,4),
    CONSTRAINT pk_price_items PRIMARY KEY ("id"),
    CONSTRAINT chk_price_items_1 CHECK (resource_type IN ('machine','service_offering','capability')),
    CONSTRAINT chk_price_items_2 CHECK (pricing_model IN ('flat','per_unit','tiered')),
    CONSTRAINT chk_price_items_3 CHECK (amount >= 0)
);

-- One calendar per bookable resource.
CREATE TABLE "availability_calendars" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_availability_calendars PRIMARY KEY ("id"),
    CONSTRAINT uq_availability_calendars_resource_type_resource_id UNIQUE ("resource_type", "resource_id"),
    CONSTRAINT chk_availability_calendars_1 CHECK (status IN ('active','inactive'))
);

-- A window of stated capacity for a calendar.
CREATE TABLE "availability_windows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calendar_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "capacity" NUMERIC(18,4) NOT NULL,
    "unit_code" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "as_of_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at" TIMESTAMPTZ,
    CONSTRAINT pk_availability_windows PRIMARY KEY ("id"),
    CONSTRAINT chk_availability_windows_1 CHECK (end_at > start_at),
    CONSTRAINT chk_availability_windows_2 CHECK (status IN ('open','closed')),
    CONSTRAINT chk_availability_windows_3 CHECK (source IN ('manual','agent','imported'))
);

-- A blackout or exception override within a calendar.
CREATE TABLE "availability_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "calendar_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT pk_availability_exceptions PRIMARY KEY ("id"),
    CONSTRAINT chk_availability_exceptions_1 CHECK (end_at > start_at),
    CONSTRAINT chk_availability_exceptions_2 CHECK (status IN ('active','cancelled'))
);

-- A hold/booking against an availability window; the concurrency-safe anchor preventing double-booking.
CREATE TABLE "availability_reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "availability_window_id" UUID NOT NULL,
    "booking_id" UUID,
    "quantity" NUMERIC(18,4) NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    CONSTRAINT pk_availability_reservations PRIMARY KEY ("id"),
    CONSTRAINT chk_availability_reservations_1 CHECK (end_at > start_at),
    CONSTRAINT chk_availability_reservations_2 CHECK (quantity > 0),
    CONSTRAINT chk_availability_reservations_3 CHECK (status IN ('held','confirmed','released'))
);


-- ============================== DOMAIN: demand ==============================

-- A demand requester's private draft — the root of a sourcing need before it's structured.
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "narrative" TEXT,
    "purpose" TEXT,
    "confidentiality" TEXT NOT NULL DEFAULT 'private',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_version_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_opportunities PRIMARY KEY ("id"),
    CONSTRAINT chk_opportunities_1 CHECK (status IN ('draft','structuring','active','matched','closed','cancelled'))
);

-- Immutable snapshot of an opportunity's structured payload at a point in time.
CREATE TABLE "opportunity_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "narrative" TEXT,
    "quantity" NUMERIC(18,4),
    "quantity_unit" TEXT,
    "target_date" DATE,
    "location" TEXT,
    "budget_amount" NUMERIC(18,2),
    "budget_currency" CHAR(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_opportunity_versions PRIMARY KEY ("id"),
    CONSTRAINT uq_opportunity_versions_opportunity_id_version_no UNIQUE ("opportunity_id", "version_no"),
    CONSTRAINT chk_opportunity_versions_1 CHECK (status IN ('draft','confirmed'))
);

-- The structured requirement content confirmed for one opportunity version.
CREATE TABLE "requirement_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "confirmed_at" TIMESTAMPTZ,
    CONSTRAINT pk_requirement_sets PRIMARY KEY ("id"),
    CONSTRAINT chk_requirement_sets_1 CHECK (status IN ('draft','confirmed'))
);

-- Process preferences within a requirement set.
CREATE TABLE "requirement_processes" (
    "requirement_set_id" UUID NOT NULL,
    "process_term_id" UUID NOT NULL,
    "preference_type" TEXT NOT NULL DEFAULT 'required',
    "confidence" NUMERIC(4,3),
    CONSTRAINT pk_requirement_processes PRIMARY KEY ("requirement_set_id", "process_term_id"),
    CONSTRAINT chk_requirement_processes_1 CHECK (preference_type IN ('required','preferred','excluded'))
);

-- Material preferences within a requirement set.
CREATE TABLE "requirement_materials" (
    "requirement_set_id" UUID NOT NULL,
    "material_term_id" UUID NOT NULL,
    "preference_type" TEXT NOT NULL DEFAULT 'required',
    "quantity" NUMERIC(18,4),
    "unit_code" TEXT,
    CONSTRAINT pk_requirement_materials PRIMARY KEY ("requirement_set_id", "material_term_id"),
    CONSTRAINT chk_requirement_materials_1 CHECK (preference_type IN ('required','preferred','excluded'))
);

-- Machinery preferences within a requirement set.
CREATE TABLE "requirement_machinery" (
    "requirement_set_id" UUID NOT NULL,
    "machinery_term_id" UUID NOT NULL,
    "preference_type" TEXT NOT NULL DEFAULT 'preferred',
    CONSTRAINT pk_requirement_machinery PRIMARY KEY ("requirement_set_id", "machinery_term_id"),
    CONSTRAINT chk_requirement_machinery_1 CHECK (preference_type IN ('required','preferred','excluded'))
);

-- Certification requirements within a requirement set.
CREATE TABLE "requirement_certifications" (
    "requirement_set_id" UUID NOT NULL,
    "certification_term_id" UUID NOT NULL,
    "preference_type" TEXT NOT NULL DEFAULT 'required',
    CONSTRAINT pk_requirement_certifications PRIMARY KEY ("requirement_set_id", "certification_term_id"),
    CONSTRAINT chk_requirement_certifications_1 CHECK (preference_type IN ('required','preferred'))
);

-- Files attached as supporting material to a requirement set.
CREATE TABLE "requirement_files" (
    "requirement_set_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    CONSTRAINT pk_requirement_files PRIMARY KEY ("requirement_set_id", "file_id")
);

-- Clarifying Q&A captured while structuring a requirement.
CREATE TABLE "requirement_questions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_set_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answer_status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT pk_requirement_questions PRIMARY KEY ("id"),
    CONSTRAINT chk_requirement_questions_1 CHECK (answer_status IN ('pending','answered','skipped'))
);

-- Individual structured requirement fields. Agent Orchestrator writes rows with source='agent_suggested'; only the demand requester's confirmation flips a row to participant_confirmed.
CREATE TABLE "requirement_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_set_id" UUID NOT NULL,
    "field_name" TEXT NOT NULL,
    "field_value" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent_suggested',
    "agent_run_id" UUID,
    "confidence" NUMERIC(4,3),
    "schema_version" TEXT NOT NULL DEFAULT 'v1',
    "confirmed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_requirement_items PRIMARY KEY ("id"),
    CONSTRAINT chk_requirement_items_1 CHECK (source IN ('agent_suggested','participant_confirmed'))
);


-- ============================== DOMAIN: matching ==============================

-- One row per Agent Orchestrator run_match MCP tool invocation against a requirement set.
CREATE TABLE "match_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requirement_set_id" UUID NOT NULL,
    "agent_run_id" UUID,
    "triggered_by" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT pk_match_runs PRIMARY KEY ("id"),
    CONSTRAINT chk_match_runs_1 CHECK (triggered_by IN ('system','user','agent')),
    CONSTRAINT chk_match_runs_2 CHECK (status IN ('running','completed','failed'))
);

-- One row per candidate organization/capability considered in a match run. Eligibility is a hard filter, never overridden by score.
CREATE TABLE "matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_run_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "score" NUMERIC(6,4) NOT NULL,
    "confidence_tier" TEXT NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT true,
    "rank" INTEGER,
    "explanation_ref" TEXT,
    CONSTRAINT pk_matches PRIMARY KEY ("id"),
    CONSTRAINT chk_matches_1 CHECK (confidence_tier IN ('low','medium','high'))
);

-- Supporting evidence rows behind a match score, exposed via the Marketplace Search MCP resource get_match_evidence.
CREATE TABLE "match_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "source_ref" TEXT NOT NULL,
    "weight" NUMERIC(5,4),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_match_evidence PRIMARY KEY ("id")
);

-- A requester's curated shortlist of matches selected for outreach.
CREATE TABLE "shortlist_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID NOT NULL,
    "match_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'shortlisted',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_shortlist_entries PRIMARY KEY ("id"),
    CONSTRAINT uq_shortlist_entries_opportunity_id_match_id UNIQUE ("opportunity_id", "match_id"),
    CONSTRAINT chk_shortlist_entries_1 CHECK (status IN ('shortlisted','removed'))
);

-- Human feedback/override on a match's relevance, feeding evaluation and re-ranking.
CREATE TABLE "match_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "match_id" UUID NOT NULL,
    "user_id" UUID,
    "rating" SMALLINT,
    "override_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_match_feedback PRIMARY KEY ("id"),
    CONSTRAINT chk_match_feedback_1 CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);


-- ============================== DOMAIN: engagement ==============================

-- The central inquiry/quote/booking thread between a demand and a supply organization.
CREATE TABLE "engagements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "opportunity_id" UUID,
    "match_id" UUID,
    "demand_organization_id" UUID NOT NULL,
    "supply_organization_id" UUID NOT NULL,
    "request_type" TEXT NOT NULL DEFAULT 'inquiry',
    "type" TEXT NOT NULL DEFAULT 'sourcing',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "visibility" TEXT NOT NULL DEFAULT 'participants',
    "current_quote_id" UUID,
    "created_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_engagements PRIMARY KEY ("id"),
    CONSTRAINT chk_engagements_1 CHECK (request_type IN ('inquiry','availability_request','quote_request')),
    CONSTRAINT chk_engagements_2 CHECK (status IN ('sent','acknowledged','clarification','interested','declined','closed','expired'))
);

-- Participants on an engagement thread with per-participant disclosure level.
CREATE TABLE "engagement_participants" (
    "engagement_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "role" TEXT NOT NULL,
    "disclosure_level" TEXT NOT NULL DEFAULT 'standard',
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT pk_engagement_participants PRIMARY KEY ("engagement_id", "organization_id"),
    CONSTRAINT chk_engagement_participants_1 CHECK (role IN ('demand','supply','observer')),
    CONSTRAINT chk_engagement_participants_2 CHECK (status IN ('active','removed'))
);

-- A supply-side structured response to an engagement: acknowledgment, interest, decline, or quote.
CREATE TABLE "engagement_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "engagement_id" UUID NOT NULL,
    "response_type" TEXT NOT NULL,
    "structured_payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "submitted_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_engagement_responses PRIMARY KEY ("id"),
    CONSTRAINT chk_engagement_responses_1 CHECK (response_type IN ('acknowledgment','interest','decline','quote')),
    CONSTRAINT chk_engagement_responses_2 CHECK (status IN ('draft','submitted','superseded','withdrawn'))
);

-- A requester-initiated ask within an engagement (e.g. request more info).
CREATE TABLE "requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "engagement_id" UUID NOT NULL,
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "requested_by_user_id" UUID,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_requests PRIMARY KEY ("id"),
    CONSTRAINT chk_requests_1 CHECK (status IN ('open','fulfilled','cancelled'))
);

-- A formal quote issued within an engagement.
CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "engagement_id" UUID NOT NULL,
    "quote_no" TEXT NOT NULL,
    "revision_no" INTEGER NOT NULL DEFAULT 1,
    "currency" CHAR(3) NOT NULL,
    "subtotal" NUMERIC(18,2) NOT NULL DEFAULT 0,
    "tax" NUMERIC(18,2) NOT NULL DEFAULT 0,
    "total" NUMERIC(18,2) NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMPTZ,
    "lead_time_days" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_quotes PRIMARY KEY ("id"),
    CONSTRAINT uq_quotes_engagement_id_quote_no_revision_no UNIQUE ("engagement_id", "quote_no", "revision_no"),
    CONSTRAINT chk_quotes_1 CHECK (status IN ('draft','sent','accepted','rejected','expired','superseded')),
    CONSTRAINT chk_quotes_2 CHECK (total >= 0)
);

-- A single line item on a quote.
CREATE TABLE "quote_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "quantity" NUMERIC(18,4) NOT NULL,
    "unit_code" TEXT,
    "unit_price" NUMERIC(18,4) NOT NULL,
    "amount" NUMERIC(18,2) NOT NULL,
    CONSTRAINT pk_quote_items PRIMARY KEY ("id"),
    CONSTRAINT chk_quote_items_1 CHECK (quantity > 0),
    CONSTRAINT chk_quote_items_2 CHECK (unit_price >= 0)
);

-- A negotiable offer/counter-offer thread anchored to a quote.
CREATE TABLE "offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "offered_by_user_id" UUID,
    "offer_type" TEXT NOT NULL,
    "parent_offer_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_offers PRIMARY KEY ("id"),
    CONSTRAINT chk_offers_1 CHECK (offer_type IN ('initial','counter')),
    CONSTRAINT chk_offers_2 CHECK (status IN ('open','accepted','rejected','expired','withdrawn'))
);

-- Structured named terms attached to an offer.
CREATE TABLE "offer_terms" (
    "offer_id" UUID NOT NULL,
    "term_code" TEXT NOT NULL,
    "value_text" TEXT,
    "value_numeric" NUMERIC(18,4),
    "unit_code" TEXT,
    CONSTRAINT pk_offer_terms PRIMARY KEY ("offer_id", "term_code")
);

-- The confirmed, agreed engagement — immutable agreed terms once confirmed.
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "engagement_id" UUID NOT NULL,
    "accepted_offer_id" UUID,
    "demand_organization_id" UUID NOT NULL,
    "supply_organization_id" UUID NOT NULL,
    "start_at" TIMESTAMPTZ,
    "end_at" TIMESTAMPTZ,
    "quantity" NUMERIC(18,4),
    "unit_code" TEXT,
    "agreed_amount" NUMERIC(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_bookings PRIMARY KEY ("id"),
    CONSTRAINT chk_bookings_1 CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at),
    CONSTRAINT chk_bookings_2 CHECK (status IN ('confirmed','in_progress','completed','cancelled','disputed'))
);

-- Append-only event log for a booking's lifecycle.
CREATE TABLE "booking_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_booking_events PRIMARY KEY ("id")
);

-- A proposed/approved change to an already-confirmed booking's terms.
CREATE TABLE "booking_amendments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "previous_version" INTEGER NOT NULL,
    "new_version" INTEGER NOT NULL,
    "reason" TEXT,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_booking_amendments PRIMARY KEY ("id")
);


-- ============================== DOMAIN: projects ==============================

-- Fulfillment/execution tracking for a confirmed booking.
CREATE TABLE "projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "planned_start" DATE,
    "planned_end" DATE,
    "actual_start" DATE,
    "actual_end" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_projects PRIMARY KEY ("id"),
    CONSTRAINT chk_projects_1 CHECK (status IN ('planned','active','completed','cancelled'))
);

-- Who is party to a project.
CREATE TABLE "project_participants" (
    "project_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT pk_project_participants PRIMARY KEY ("project_id", "organization_id"),
    CONSTRAINT chk_project_participants_1 CHECK (status IN ('active','removed'))
);

-- A sequenced milestone within a project.
CREATE TABLE "milestones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "planned_at" DATE,
    "completed_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_milestones PRIMARY KEY ("id"),
    CONSTRAINT uq_milestones_project_id_sequence_no UNIQUE ("project_id", "sequence_no"),
    CONSTRAINT chk_milestones_1 CHECK (status IN ('pending','in_progress','done','skipped'))
);

-- A status update posted against a project (or a specific milestone). Agent Orchestrator's Project agent may draft these.
CREATE TABLE "project_updates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "milestone_id" UUID,
    "author_user_id" UUID,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_project_updates PRIMARY KEY ("id"),
    CONSTRAINT chk_project_updates_1 CHECK (status IN ('draft','published'))
);

-- An actionable task owned by one organization within a project.
CREATE TABLE "project_tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "project_id" UUID NOT NULL,
    "owner_org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "due_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_project_tasks PRIMARY KEY ("id"),
    CONSTRAINT chk_project_tasks_1 CHECK (status IN ('open','in_progress','done','blocked'))
);

-- Files attached to a project.
CREATE TABLE "project_files" (
    "project_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    CONSTRAINT pk_project_files PRIMARY KEY ("project_id", "file_id")
);

-- A messaging thread scoped to an engagement and/or a project.
CREATE TABLE "threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "engagement_id" UUID,
    "project_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_threads PRIMARY KEY ("id"),
    CONSTRAINT chk_threads_1 CHECK (status IN ('open','archived')),
    CONSTRAINT chk_threads_2 CHECK (engagement_id IS NOT NULL OR project_id IS NOT NULL)
);

-- Membership of a thread.
CREATE TABLE "thread_participants" (
    "thread_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_thread_participants PRIMARY KEY ("thread_id", "user_id"),
    CONSTRAINT chk_thread_participants_1 CHECK (status IN ('active','removed'))
);

-- A single chat message within a thread.
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "body" TEXT,
    "client_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_messages PRIMARY KEY ("id"),
    CONSTRAINT uq_messages_thread_id_client_message_id UNIQUE ("thread_id", "client_message_id"),
    CONSTRAINT chk_messages_1 CHECK (message_type IN ('text','system','attachment')),
    CONSTRAINT chk_messages_2 CHECK (status IN ('sent','delivered','failed','redacted'))
);

-- Files attached to a message.
CREATE TABLE "message_attachments" (
    "message_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    CONSTRAINT pk_message_attachments PRIMARY KEY ("message_id", "file_id")
);

-- Per-user read cursor on a thread.
CREATE TABLE "message_reads" (
    "thread_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_message_id" UUID,
    "read_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_message_reads PRIMARY KEY ("thread_id", "user_id")
);


-- ============================== DOMAIN: files_trust ==============================

-- Metadata and security lifecycle for anything uploaded; bytes live in MinIO/S3-compatible storage.
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "uploaded_by_user_id" UUID,
    "object_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'restricted',
    "scan_status" TEXT NOT NULL DEFAULT 'initiated',
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_files PRIMARY KEY ("id"),
    CONSTRAINT uq_files_object_key UNIQUE ("object_key"),
    CONSTRAINT chk_files_1 CHECK (classification IN ('public','matched_participant','restricted')),
    CONSTRAINT chk_files_2 CHECK (scan_status IN ('initiated','quarantined','clean','rejected')),
    CONSTRAINT chk_files_3 CHECK (status IN ('active','deleted')),
    CONSTRAINT chk_files_4 CHECK (size_bytes >= 0)
);

-- Version history for a file.
CREATE TABLE "file_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "object_key" TEXT NOT NULL,
    "checksum" TEXT,
    "size_bytes" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_file_versions PRIMARY KEY ("id"),
    CONSTRAINT uq_file_versions_file_id_version_no UNIQUE ("file_id", "version_no")
);

-- Polymorphic link from a file to the resource it belongs to (evidence, message, capability, etc.).
CREATE TABLE "file_links" (
    "file_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "access_scope" TEXT NOT NULL DEFAULT 'restricted',
    CONSTRAINT pk_file_links PRIMARY KEY ("file_id", "resource_type", "resource_id")
);

-- Explicit, time-bounded, purpose-bound access grant to a private file (a.k.a. disclosure grant).
CREATE TABLE "file_access_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_id" UUID NOT NULL,
    "grantee_user_id" UUID,
    "grantee_org_id" UUID,
    "engagement_id" UUID,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_file_access_grants PRIMARY KEY ("id")
);

-- Lookup of accepted document types for uploads.
CREATE TABLE "document_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'restricted',
    "max_size_bytes" BIGINT,
    CONSTRAINT pk_document_types PRIMARY KEY ("id"),
    CONSTRAINT uq_document_types_code UNIQUE ("code")
);

-- The review of a submitted verification claim (organization, facility, or capability), run by a Verification Analyst.
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "case_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_admin_id" UUID,
    "decision_reason" TEXT,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "closed_at" TIMESTAMPTZ,
    CONSTRAINT pk_verification_cases PRIMARY KEY ("id"),
    CONSTRAINT chk_verification_cases_1 CHECK (resource_type IN ('organization','facility','capability')),
    CONSTRAINT chk_verification_cases_2 CHECK (status IN ('open','needs_information','approved','rejected','suspended','expired','appealed'))
);

-- Claim-supporting file evidence submitted for a verification case.
CREATE TABLE "verification_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID,
    "file_id" UUID NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'organization',
    "scope" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "expires_at" TIMESTAMPTZ,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_verification_evidence PRIMARY KEY ("id"),
    CONSTRAINT chk_verification_evidence_1 CHECK (status IN ('submitted','accepted','rejected'))
);

-- One row per decision event on a verification case (append-only decision trail).
CREATE TABLE "verification_decisions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "decision" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_verification_decisions PRIMARY KEY ("id"),
    CONSTRAINT chk_verification_decisions_1 CHECK (decision IN ('approve','reject','request_info','suspend'))
);

-- The resulting public trust badge: a time-bounded decision that a claim/scope was verified. Renewal never overwrites history — a new row is inserted.
CREATE TABLE "verified_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "verification_case_id" UUID NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ,
    CONSTRAINT pk_verified_claims PRIMARY KEY ("id"),
    CONSTRAINT chk_verified_claims_1 CHECK (subject_type IN ('organization','facility','capability')),
    CONSTRAINT chk_verified_claims_2 CHECK (status IN ('active','expired','revoked')),
    CONSTRAINT chk_verified_claims_3 CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- Lookup of standard certification names (ISO 9001, IATF 16949, ...). Distinct from organization_certifications, which is the per-org claim.
CREATE TABLE "certification_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT pk_certification_types PRIMARY KEY ("id"),
    CONSTRAINT uq_certification_types_code UNIQUE ("code"),
    CONSTRAINT chk_certification_types_1 CHECK (status IN ('active','retired'))
);

-- A structured per-organization certification claim (e.g. this org's ISO 9001), with scope, issuer, and validity.
CREATE TABLE "organization_certifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "facility_id" UUID,
    "certification_type_id" UUID NOT NULL,
    "issuer" TEXT,
    "evidence_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'declared',
    "valid_from" DATE,
    "valid_until" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_organization_certifications PRIMARY KEY ("id"),
    CONSTRAINT chk_organization_certifications_1 CHECK (status IN ('declared','evidence_submitted','verified','expired','suspended')),
    CONSTRAINT chk_organization_certifications_2 CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

-- A post-booking rating left by one party about the other.
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "reviewer_org_id" UUID NOT NULL,
    "reviewee_org_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_reviews PRIMARY KEY ("id"),
    CONSTRAINT uq_reviews_booking_id_reviewer_org_id UNIQUE ("booking_id", "reviewer_org_id"),
    CONSTRAINT chk_reviews_1 CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT chk_reviews_2 CHECK (status IN ('draft','published','hidden'))
);

-- Multi-dimensional sub-ratings on a review (quality, timeliness, communication, ...).
CREATE TABLE "review_dimensions" (
    "review_id" UUID NOT NULL,
    "dimension_code" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    CONSTRAINT pk_review_dimensions PRIMARY KEY ("review_id", "dimension_code"),
    CONSTRAINT chk_review_dimensions_1 CHECK (rating BETWEEN 1 AND 5)
);

-- The reviewee's public response to a review.
CREATE TABLE "review_responses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "responder_user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_review_responses PRIMARY KEY ("id")
);

-- A published provider profile (logistics, service, or other non-manufacturing provider) for an organization.
CREATE TABLE "provider_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "provider_type" TEXT NOT NULL,
    "headline" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "publication_status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_provider_profiles PRIMARY KEY ("id"),
    CONSTRAINT uq_provider_profiles_organization_id_provider_type UNIQUE ("organization_id", "provider_type"),
    CONSTRAINT chk_provider_profiles_1 CHECK (status IN ('active','archived')),
    CONSTRAINT chk_provider_profiles_2 CHECK (publication_status IN ('draft','published','hidden'))
);

-- A service offered under a provider profile.
CREATE TABLE "provider_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_profile_id" UUID NOT NULL,
    "service_type" TEXT NOT NULL,
    "description" TEXT,
    "pricing_model" TEXT,
    "base_price" NUMERIC(18,2),
    "currency" CHAR(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    CONSTRAINT pk_provider_services PRIMARY KEY ("id"),
    CONSTRAINT chk_provider_services_1 CHECK (status IN ('active','archived'))
);

-- Geographic service area for a provider service.
CREATE TABLE "provider_service_areas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_service_id" UUID NOT NULL,
    "country_code" CHAR(2),
    "region_code" TEXT,
    "location" GEOGRAPHY(Point,4326),
    "radius_km" NUMERIC(8,2),
    CONSTRAINT pk_provider_service_areas PRIMARY KEY ("id")
);

-- Link between a provider profile and the capabilities it supports.
CREATE TABLE "provider_capabilities" (
    "provider_profile_id" UUID NOT NULL,
    "capability_id" UUID NOT NULL,
    CONSTRAINT pk_provider_capabilities PRIMARY KEY ("provider_profile_id", "capability_id")
);

-- A request for a provider's service on a specific project.
CREATE TABLE "provider_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_profile_id" UUID NOT NULL,
    "requester_org_id" UUID NOT NULL,
    "project_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_provider_requests PRIMARY KEY ("id"),
    CONSTRAINT chk_provider_requests_1 CHECK (status IN ('open','quoted','accepted','declined','cancelled'))
);

-- A quote issued in response to a provider request.
CREATE TABLE "provider_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_request_id" UUID NOT NULL,
    "amount" NUMERIC(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "valid_until" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT pk_provider_quotes PRIMARY KEY ("id"),
    CONSTRAINT chk_provider_quotes_1 CHECK (status IN ('sent','accepted','rejected','expired')),
    CONSTRAINT chk_provider_quotes_2 CHECK (amount >= 0)
);


-- ============================== DOMAIN: notify ==============================

-- In-app/email/SMS alert sent to a user or operator.
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "notification_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_app',
    "related_type" TEXT,
    "related_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notifications PRIMARY KEY ("id"),
    CONSTRAINT chk_notifications_1 CHECK (channel IN ('in_app','email','sms')),
    CONSTRAINT chk_notifications_2 CHECK (status IN ('queued','sent','delivered','failed','read','dismissed'))
);

-- Per-user, per-channel, per-event-type opt-in/out.
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT pk_notification_preferences PRIMARY KEY ("user_id", "channel", "event_type"),
    CONSTRAINT chk_notification_preferences_1 CHECK (channel IN ('in_app','email','sms'))
);

-- One delivery attempt/record per outbound notification send.
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_notification_deliveries PRIMARY KEY ("id"),
    CONSTRAINT chk_notification_deliveries_1 CHECK (channel IN ('in_app','email','sms')),
    CONSTRAINT chk_notification_deliveries_2 CHECK (status IN ('queued','sent','delivered','failed'))
);


-- ============================== DOMAIN: payments ==============================

-- A payment transaction tied to a booking.
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "booking_id" UUID,
    "type" TEXT NOT NULL,
    "amount" NUMERIC(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "external_reference" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_transactions PRIMARY KEY ("id"),
    CONSTRAINT uq_transactions_provider_external_reference UNIQUE ("provider", "external_reference"),
    CONSTRAINT chk_transactions_1 CHECK (type IN ('charge','payout','commission')),
    CONSTRAINT chk_transactions_2 CHECK (status IN ('pending','succeeded','failed','refunded'))
);

-- One attempt to execute a transaction against the payment provider (idempotent).
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "provider_request_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_payment_attempts PRIMARY KEY ("id"),
    CONSTRAINT uq_payment_attempts_transaction_id_idempotency_key UNIQUE ("transaction_id", "idempotency_key"),
    CONSTRAINT chk_payment_attempts_1 CHECK (status IN ('pending','succeeded','failed'))
);

-- A refund against a transaction.
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "amount" NUMERIC(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT,
    "provider_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_refunds PRIMARY KEY ("id"),
    CONSTRAINT chk_refunds_1 CHECK (status IN ('pending','succeeded','failed')),
    CONSTRAINT chk_refunds_2 CHECK (amount > 0)
);

-- Raw webhook events received from the payment provider.
CREATE TABLE "provider_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "external_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_hash" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "processed_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'received',
    CONSTRAINT pk_provider_events PRIMARY KEY ("id"),
    CONSTRAINT uq_provider_events_provider_external_event_id UNIQUE ("provider", "external_event_id"),
    CONSTRAINT chk_provider_events_1 CHECK (status IN ('received','processed','failed'))
);

-- Append-only double-entry ledger line for a transaction.
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "account_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" NUMERIC(18,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_ledger_entries PRIMARY KEY ("id"),
    CONSTRAINT chk_ledger_entries_1 CHECK (direction IN ('debit','credit')),
    CONSTRAINT chk_ledger_entries_2 CHECK (amount > 0)
);


-- ============================== DOMAIN: reliability ==============================

-- Transactional outbox — an event written in the same transaction as the business change, published asynchronously.
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_outbox_events PRIMARY KEY ("id"),
    CONSTRAINT chk_outbox_events_1 CHECK (status IN ('pending','published','failed'))
);

-- A background job (Celery/Redis) with status and retry tracking.
CREATE TABLE "jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_type" TEXT NOT NULL,
    "organization_id" UUID,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "result_ref" TEXT,
    CONSTRAINT pk_jobs PRIMARY KEY ("id"),
    CONSTRAINT chk_jobs_1 CHECK (status IN ('queued','running','completed','failed','dead_letter'))
);

-- One attempt row per job execution attempt.
CREATE TABLE "job_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "provider" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT pk_job_attempts PRIMARY KEY ("id"),
    CONSTRAINT uq_job_attempts_job_id_attempt_no UNIQUE ("job_id", "attempt_no")
);

-- Idempotency record preventing duplicate execution of a client-retried mutation.
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_ref" TEXT,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotency_keys PRIMARY KEY ("id"),
    CONSTRAINT uq_idempotency_keys_organization_id_operation_key UNIQUE ("organization_id", "operation", "key")
);


-- ============================== DOMAIN: admin ==============================

-- Append-only record of every material action or decision — participant or operator, human or agent. Cross-cutting: written by every module.
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "organization_context_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "old_value_redacted" JSONB,
    "new_value_redacted" JSONB,
    "reason_code" TEXT,
    "case_id" UUID,
    "correlation_id" TEXT,
    "ip" INET,
    CONSTRAINT pk_audit_logs PRIMARY KEY ("id"),
    CONSTRAINT chk_audit_logs_1 CHECK (actor_type IN ('user','membership','platform_role','agent','service'))
);

-- Trust & safety report, investigation, action, and appeal record for any content.
CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "subject_type" TEXT NOT NULL,
    "subject_id" UUID NOT NULL,
    "reported_by" UUID,
    "assigned_platform_role_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'open',
    "action_taken" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "closed_at" TIMESTAMPTZ,
    CONSTRAINT pk_moderation_cases PRIMARY KEY ("id"),
    CONSTRAINT chk_moderation_cases_1 CHECK (subject_type IN ('organization','facility','capability','message')),
    CONSTRAINT chk_moderation_cases_2 CHECK (status IN ('open','assigned','actioned','appealed','closed'))
);

-- Participant assistance or product/data issue ticket.
CREATE TABLE "support_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "organization_id" UUID,
    "assigned_platform_role_id" UUID,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "resolved_at" TIMESTAMPTZ,
    CONSTRAINT pk_support_cases PRIMARY KEY ("id"),
    CONSTRAINT chk_support_cases_1 CHECK (status IN ('open','assigned','blocked','resolved','reopened'))
);

-- General-purpose administrative case queue (non-verification, non-moderation, non-support).
CREATE TABLE "admin_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_type" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" UUID,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_to" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "closed_at" TIMESTAMPTZ,
    CONSTRAINT pk_admin_cases PRIMARY KEY ("id"),
    CONSTRAINT chk_admin_cases_1 CHECK (priority IN ('low','normal','high','urgent')),
    CONSTRAINT chk_admin_cases_2 CHECK (status IN ('open','assigned','closed'))
);

-- One row per action taken by an operator within an admin case.
CREATE TABLE "admin_actions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_admin_actions PRIMARY KEY ("id")
);

-- Raw product analytics event stream.
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "event_type" TEXT NOT NULL,
    "actor_org_id" UUID,
    "actor_user_id" UUID,
    "resource_type" TEXT,
    "resource_id" UUID,
    "properties" JSONB,
    CONSTRAINT pk_analytics_events PRIMARY KEY ("id")
);

-- Pre-aggregated daily metric rollups.
CREATE TABLE "daily_metrics" (
    "metric_date" DATE NOT NULL,
    "metric_name" TEXT NOT NULL,
    "dimension_json" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "value" NUMERIC(18,4) NOT NULL,
    CONSTRAINT pk_daily_metrics PRIMARY KEY ("metric_date", "metric_name", "dimension_json")
);


-- ============================== DOMAIN: agent ==============================

-- One row per Agent Orchestrator capability (Requirement, Matching, Manufacturing, Project, Payment, Quote, Support/Admin, Notification).
CREATE TABLE "agent_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowed_tools" TEXT[],
    "default_tier" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_agent_definitions PRIMARY KEY ("id"),
    CONSTRAINT uq_agent_definitions_code_version UNIQUE ("code", "version"),
    CONSTRAINT chk_agent_definitions_1 CHECK (default_tier IN ('small','default','complex'))
);

-- A specific versioned prompt template.
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prompt_code" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "template_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_prompt_versions PRIMARY KEY ("id"),
    CONSTRAINT uq_prompt_versions_prompt_code_version UNIQUE ("prompt_code", "version"),
    CONSTRAINT chk_prompt_versions_1 CHECK (status IN ('draft','approved','retired'))
);

-- A model/tier snapshot the router can select — covers both hosted models and self-hosted Ollama/vLLM tiers. No provider secrets stored here.
CREATE TABLE "model_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "snapshot_name" TEXT,
    "configuration_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_model_versions PRIMARY KEY ("id"),
    CONSTRAINT chk_model_versions_1 CHECK (status IN ('active','deprecated'))
);

-- One row per Agent Orchestrator invocation.
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "organization_id" UUID,
    "agent_definition_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "prompt_version_id" UUID,
    "model_version_id" UUID,
    "model_tier" TEXT NOT NULL DEFAULT 'default',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completed_at" TIMESTAMPTZ,
    "result_ref" TEXT,
    "error_code" TEXT,
    CONSTRAINT pk_agent_runs PRIMARY KEY ("id"),
    CONSTRAINT chk_agent_runs_1 CHECK (status IN ('running','completed','failed','cancelled')),
    CONSTRAINT chk_agent_runs_2 CHECK (model_tier IN ('small','default','complex'))
);

-- Message trace (system/user/assistant/tool turns) for an agent run.
CREATE TABLE "agent_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "content_classification" TEXT NOT NULL DEFAULT 'restricted',
    "content_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_agent_messages PRIMARY KEY ("id"),
    CONSTRAINT chk_agent_messages_1 CHECK (role IN ('system','user','assistant','tool'))
);

-- One row per MCP tool call the orchestrator makes (get_capability, run_match, draft_engagement, ...). Records authorization outcome so a denied call is as visible as an allowed one.
CREATE TABLE "agent_tool_calls" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "mcp_server_code" TEXT NOT NULL,
    "tool_code" TEXT NOT NULL,
    "arguments_redacted" JSONB,
    "authorization_outcome" TEXT NOT NULL,
    "approval_id" UUID,
    "result_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT pk_agent_tool_calls PRIMARY KEY ("id"),
    CONSTRAINT chk_agent_tool_calls_1 CHECK (authorization_outcome IN ('allowed','denied')),
    CONSTRAINT chk_agent_tool_calls_2 CHECK (status IN ('pending','completed','failed'))
);

-- The human-in-the-loop gate. A proposed material action is not executed until this row is decided — single-use, actor-bound, expiring.
CREATE TABLE "agent_approvals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "tool_code" TEXT NOT NULL,
    "proposed_action_hash" TEXT NOT NULL,
    "requested_by" UUID,
    "approved_by" UUID,
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_agent_approvals PRIMARY KEY ("id"),
    CONSTRAINT chk_agent_approvals_1 CHECK (decision IN ('pending','approved','rejected','expired'))
);

-- Human correction/rating on an agent run's output.
CREATE TABLE "agent_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "user_id" UUID,
    "rating" SMALLINT,
    "correction_ref" TEXT,
    "labels" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_agent_feedback PRIMARY KEY ("id"),
    CONSTRAINT chk_agent_feedback_1 CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

-- Offline/online quality score for an agent run against a versioned dataset and evaluator.
CREATE TABLE "agent_evaluations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "dataset_version" TEXT,
    "evaluation_type" TEXT NOT NULL,
    "score" NUMERIC(6,4),
    "passed" BOOLEAN,
    "details_ref" TEXT,
    "evaluator_version" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_agent_evaluations PRIMARY KEY ("id")
);

-- Token- and cost-level accounting per run, per org, and per model.
CREATE TABLE "ai_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_run_id" UUID NOT NULL,
    "organization_id" UUID,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cached_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "tool_cost" NUMERIC(12,6) NOT NULL DEFAULT 0,
    "estimated_cost" NUMERIC(12,6),
    "actual_cost" NUMERIC(12,6),
    "latency_ms" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_ai_usage_events PRIMARY KEY ("id")
);

-- A soft/hard spend limit for a scope (organization, agent_definition, or platform) and period.
CREATE TABLE "ai_budgets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "soft_limit" NUMERIC(14,2),
    "hard_limit" NUMERIC(14,2),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'active',
    "override_policy" TEXT,
    CONSTRAINT pk_ai_budgets PRIMARY KEY ("id"),
    CONSTRAINT uq_ai_budgets_scope_type_scope_id_period_start UNIQUE ("scope_type", "scope_id", "period_start"),
    CONSTRAINT chk_ai_budgets_1 CHECK (scope_type IN ('organization','agent_definition','platform')),
    CONSTRAINT chk_ai_budgets_2 CHECK (status IN ('active','exceeded','closed')),
    CONSTRAINT chk_ai_budgets_3 CHECK (period_end >= period_start)
);

-- Per-provider, per-model, effective-dated cost rate card.
CREATE TABLE "ai_cost_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "input_rate" NUMERIC(12,8),
    "cached_input_rate" NUMERIC(12,8),
    "cache_write_rate" NUMERIC(12,8),
    "output_rate" NUMERIC(12,8),
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    CONSTRAINT pk_ai_cost_rates PRIMARY KEY ("id"),
    CONSTRAINT uq_ai_cost_rates_provider_model_name_effective_from UNIQUE ("provider", "model_name", "effective_from")
);

-- Prompt/response cache hit/miss accounting. No raw cache content stored — hash only.
CREATE TABLE "ai_cache_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID,
    "agent_run_id" UUID,
    "cache_type" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "policy_version" TEXT,
    "saved_tokens" INTEGER,
    "estimated_savings" NUMERIC(12,6),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_ai_cache_events PRIMARY KEY ("id"),
    CONSTRAINT chk_ai_cache_events_1 CHECK (outcome IN ('hit','miss'))
);


-- ============================== FOREIGN KEYS ==============================

ALTER TABLE "user_auth_identities" ADD CONSTRAINT fk_user_auth_identities_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "organizations" ADD CONSTRAINT fk_organizations_industry_id FOREIGN KEY ("industry_id") REFERENCES "taxonomy_terms" ("id") ON DELETE SET NULL;
ALTER TABLE "organizations" ADD CONSTRAINT fk_organizations_created_by_user_id FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "organization_profiles" ADD CONSTRAINT fk_organization_profiles_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "organization_profiles" ADD CONSTRAINT fk_organization_profiles_country_code FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE SET NULL;
ALTER TABLE "memberships" ADD CONSTRAINT fk_memberships_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT fk_memberships_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT fk_memberships_invited_by FOREIGN KEY ("invited_by") REFERENCES "memberships" ("id") ON DELETE SET NULL;
ALTER TABLE "membership_invitations" ADD CONSTRAINT fk_membership_invitations_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "membership_invitations" ADD CONSTRAINT fk_membership_invitations_invited_by_membership_id FOREIGN KEY ("invited_by_membership_id") REFERENCES "memberships" ("id") ON DELETE SET NULL;
ALTER TABLE "marketplace_role_selections" ADD CONSTRAINT fk_marketplace_role_selections_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT fk_platform_role_assignments_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT fk_platform_role_assignments_granted_by_user_id FOREIGN KEY ("granted_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "taxonomy_terms" ADD CONSTRAINT fk_taxonomy_terms_parent_term_id FOREIGN KEY ("parent_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE SET NULL;
ALTER TABLE "regions" ADD CONSTRAINT fk_regions_country_code FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE CASCADE;
ALTER TABLE "facilities" ADD CONSTRAINT fk_facilities_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "facilities" ADD CONSTRAINT fk_facilities_country_code FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE SET NULL;
ALTER TABLE "capabilities" ADD CONSTRAINT fk_capabilities_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "capabilities" ADD CONSTRAINT fk_capabilities_facility_id FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id") ON DELETE SET NULL;
ALTER TABLE "capabilities" ADD CONSTRAINT fk_capabilities_taxonomy_term_id FOREIGN KEY ("taxonomy_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "capability_taxonomy_mappings" ADD CONSTRAINT fk_capability_taxonomy_mappings_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "capability_taxonomy_mappings" ADD CONSTRAINT fk_capability_taxonomy_mappings_taxonomy_term_id FOREIGN KEY ("taxonomy_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "capability_materials" ADD CONSTRAINT fk_capability_materials_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "capability_materials" ADD CONSTRAINT fk_capability_materials_material_term_id FOREIGN KEY ("material_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "capability_materials" ADD CONSTRAINT fk_capability_materials_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "capability_certifications" ADD CONSTRAINT fk_capability_certifications_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "capability_certifications" ADD CONSTRAINT fk_capability_certifications_certification_id FOREIGN KEY ("certification_id") REFERENCES "organization_certifications" ("id") ON DELETE CASCADE;
ALTER TABLE "capability_certifications" ADD CONSTRAINT fk_capability_certifications_evidence_id FOREIGN KEY ("evidence_id") REFERENCES "verification_evidence" ("id") ON DELETE SET NULL;
ALTER TABLE "capability_claims" ADD CONSTRAINT fk_capability_claims_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_snapshots" ADD CONSTRAINT fk_availability_snapshots_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_snapshots" ADD CONSTRAINT fk_availability_snapshots_recorded_by_membership_id FOREIGN KEY ("recorded_by_membership_id") REFERENCES "memberships" ("id") ON DELETE SET NULL;
ALTER TABLE "machines" ADD CONSTRAINT fk_machines_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "machines" ADD CONSTRAINT fk_machines_facility_id FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id") ON DELETE SET NULL;
ALTER TABLE "machines" ADD CONSTRAINT fk_machines_machinery_term_id FOREIGN KEY ("machinery_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "machine_specs" ADD CONSTRAINT fk_machine_specs_machine_id FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE CASCADE;
ALTER TABLE "machine_specs" ADD CONSTRAINT fk_machine_specs_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "machine_images" ADD CONSTRAINT fk_machine_images_machine_id FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE CASCADE;
ALTER TABLE "machine_images" ADD CONSTRAINT fk_machine_images_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "service_offerings" ADD CONSTRAINT fk_service_offerings_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "service_offerings" ADD CONSTRAINT fk_service_offerings_facility_id FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_items" ADD CONSTRAINT fk_inventory_items_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT fk_inventory_items_facility_id FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id") ON DELETE SET NULL;
ALTER TABLE "inventory_items" ADD CONSTRAINT fk_inventory_items_machine_id FOREIGN KEY ("machine_id") REFERENCES "machines" ("id") ON DELETE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT fk_inventory_items_service_offering_id FOREIGN KEY ("service_offering_id") REFERENCES "service_offerings" ("id") ON DELETE CASCADE;
ALTER TABLE "price_books" ADD CONSTRAINT fk_price_books_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "price_items" ADD CONSTRAINT fk_price_items_price_book_id FOREIGN KEY ("price_book_id") REFERENCES "price_books" ("id") ON DELETE CASCADE;
ALTER TABLE "price_items" ADD CONSTRAINT fk_price_items_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "availability_calendars" ADD CONSTRAINT fk_availability_calendars_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_windows" ADD CONSTRAINT fk_availability_windows_calendar_id FOREIGN KEY ("calendar_id") REFERENCES "availability_calendars" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_windows" ADD CONSTRAINT fk_availability_windows_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "availability_exceptions" ADD CONSTRAINT fk_availability_exceptions_calendar_id FOREIGN KEY ("calendar_id") REFERENCES "availability_calendars" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_reservations" ADD CONSTRAINT fk_availability_reservations_availability_window_id FOREIGN KEY ("availability_window_id") REFERENCES "availability_windows" ("id") ON DELETE CASCADE;
ALTER TABLE "availability_reservations" ADD CONSTRAINT fk_availability_reservations_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE SET NULL;
ALTER TABLE "opportunities" ADD CONSTRAINT fk_opportunities_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT fk_opportunities_created_by_user_id FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "opportunities" ADD CONSTRAINT fk_opportunities_owner_user_id FOREIGN KEY ("owner_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "opportunity_versions" ADD CONSTRAINT fk_opportunity_versions_opportunity_id FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_sets" ADD CONSTRAINT fk_requirement_sets_opportunity_id FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_sets" ADD CONSTRAINT fk_requirement_sets_version_id FOREIGN KEY ("version_id") REFERENCES "opportunity_versions" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_processes" ADD CONSTRAINT fk_requirement_processes_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_processes" ADD CONSTRAINT fk_requirement_processes_process_term_id FOREIGN KEY ("process_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "requirement_materials" ADD CONSTRAINT fk_requirement_materials_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_materials" ADD CONSTRAINT fk_requirement_materials_material_term_id FOREIGN KEY ("material_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "requirement_materials" ADD CONSTRAINT fk_requirement_materials_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "requirement_machinery" ADD CONSTRAINT fk_requirement_machinery_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_machinery" ADD CONSTRAINT fk_requirement_machinery_machinery_term_id FOREIGN KEY ("machinery_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "requirement_certifications" ADD CONSTRAINT fk_requirement_certifications_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_certifications" ADD CONSTRAINT fk_requirement_certifications_certification_term_id FOREIGN KEY ("certification_term_id") REFERENCES "taxonomy_terms" ("id") ON DELETE RESTRICT;
ALTER TABLE "requirement_files" ADD CONSTRAINT fk_requirement_files_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_files" ADD CONSTRAINT fk_requirement_files_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_questions" ADD CONSTRAINT fk_requirement_questions_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_items" ADD CONSTRAINT fk_requirement_items_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "requirement_items" ADD CONSTRAINT fk_requirement_items_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE SET NULL;
ALTER TABLE "match_runs" ADD CONSTRAINT fk_match_runs_requirement_set_id FOREIGN KEY ("requirement_set_id") REFERENCES "requirement_sets" ("id") ON DELETE CASCADE;
ALTER TABLE "match_runs" ADD CONSTRAINT fk_match_runs_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE SET NULL;
ALTER TABLE "matches" ADD CONSTRAINT fk_matches_match_run_id FOREIGN KEY ("match_run_id") REFERENCES "match_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT fk_matches_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "matches" ADD CONSTRAINT fk_matches_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "match_evidence" ADD CONSTRAINT fk_match_evidence_match_id FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE CASCADE;
ALTER TABLE "shortlist_entries" ADD CONSTRAINT fk_shortlist_entries_opportunity_id FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE CASCADE;
ALTER TABLE "shortlist_entries" ADD CONSTRAINT fk_shortlist_entries_match_id FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE CASCADE;
ALTER TABLE "shortlist_entries" ADD CONSTRAINT fk_shortlist_entries_added_by_user_id FOREIGN KEY ("added_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "match_feedback" ADD CONSTRAINT fk_match_feedback_match_id FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE CASCADE;
ALTER TABLE "match_feedback" ADD CONSTRAINT fk_match_feedback_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "engagements" ADD CONSTRAINT fk_engagements_opportunity_id FOREIGN KEY ("opportunity_id") REFERENCES "opportunities" ("id") ON DELETE SET NULL;
ALTER TABLE "engagements" ADD CONSTRAINT fk_engagements_match_id FOREIGN KEY ("match_id") REFERENCES "matches" ("id") ON DELETE SET NULL;
ALTER TABLE "engagements" ADD CONSTRAINT fk_engagements_demand_organization_id FOREIGN KEY ("demand_organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "engagements" ADD CONSTRAINT fk_engagements_supply_organization_id FOREIGN KEY ("supply_organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "engagements" ADD CONSTRAINT fk_engagements_created_by_user_id FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "engagement_participants" ADD CONSTRAINT fk_engagement_participants_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE CASCADE;
ALTER TABLE "engagement_participants" ADD CONSTRAINT fk_engagement_participants_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "engagement_participants" ADD CONSTRAINT fk_engagement_participants_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "engagement_responses" ADD CONSTRAINT fk_engagement_responses_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE CASCADE;
ALTER TABLE "engagement_responses" ADD CONSTRAINT fk_engagement_responses_submitted_by_membership_id FOREIGN KEY ("submitted_by_membership_id") REFERENCES "memberships" ("id") ON DELETE SET NULL;
ALTER TABLE "requests" ADD CONSTRAINT fk_requests_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE CASCADE;
ALTER TABLE "requests" ADD CONSTRAINT fk_requests_requested_by_user_id FOREIGN KEY ("requested_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "quotes" ADD CONSTRAINT fk_quotes_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT fk_quote_items_quote_id FOREIGN KEY ("quote_id") REFERENCES "quotes" ("id") ON DELETE CASCADE;
ALTER TABLE "quote_items" ADD CONSTRAINT fk_quote_items_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "offers" ADD CONSTRAINT fk_offers_quote_id FOREIGN KEY ("quote_id") REFERENCES "quotes" ("id") ON DELETE CASCADE;
ALTER TABLE "offers" ADD CONSTRAINT fk_offers_offered_by_user_id FOREIGN KEY ("offered_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "offers" ADD CONSTRAINT fk_offers_parent_offer_id FOREIGN KEY ("parent_offer_id") REFERENCES "offers" ("id") ON DELETE SET NULL;
ALTER TABLE "offer_terms" ADD CONSTRAINT fk_offer_terms_offer_id FOREIGN KEY ("offer_id") REFERENCES "offers" ("id") ON DELETE CASCADE;
ALTER TABLE "offer_terms" ADD CONSTRAINT fk_offer_terms_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_accepted_offer_id FOREIGN KEY ("accepted_offer_id") REFERENCES "offers" ("id") ON DELETE SET NULL;
ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_demand_organization_id FOREIGN KEY ("demand_organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_supply_organization_id FOREIGN KEY ("supply_organization_id") REFERENCES "organizations" ("id") ON DELETE RESTRICT;
ALTER TABLE "bookings" ADD CONSTRAINT fk_bookings_unit_code FOREIGN KEY ("unit_code") REFERENCES "units" ("code") ON DELETE SET NULL;
ALTER TABLE "booking_events" ADD CONSTRAINT fk_booking_events_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE;
ALTER TABLE "booking_events" ADD CONSTRAINT fk_booking_events_actor_user_id FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "booking_amendments" ADD CONSTRAINT fk_booking_amendments_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE;
ALTER TABLE "booking_amendments" ADD CONSTRAINT fk_booking_amendments_approved_by FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "projects" ADD CONSTRAINT fk_projects_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT fk_projects_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "project_participants" ADD CONSTRAINT fk_project_participants_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;
ALTER TABLE "project_participants" ADD CONSTRAINT fk_project_participants_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "project_participants" ADD CONSTRAINT fk_project_participants_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "milestones" ADD CONSTRAINT fk_milestones_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;
ALTER TABLE "project_updates" ADD CONSTRAINT fk_project_updates_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;
ALTER TABLE "project_updates" ADD CONSTRAINT fk_project_updates_milestone_id FOREIGN KEY ("milestone_id") REFERENCES "milestones" ("id") ON DELETE SET NULL;
ALTER TABLE "project_updates" ADD CONSTRAINT fk_project_updates_author_user_id FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "project_tasks" ADD CONSTRAINT fk_project_tasks_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;
ALTER TABLE "project_tasks" ADD CONSTRAINT fk_project_tasks_owner_org_id FOREIGN KEY ("owner_org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "project_files" ADD CONSTRAINT fk_project_files_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE;
ALTER TABLE "project_files" ADD CONSTRAINT fk_project_files_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "threads" ADD CONSTRAINT fk_threads_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE SET NULL;
ALTER TABLE "threads" ADD CONSTRAINT fk_threads_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL;
ALTER TABLE "thread_participants" ADD CONSTRAINT fk_thread_participants_thread_id FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE;
ALTER TABLE "thread_participants" ADD CONSTRAINT fk_thread_participants_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "thread_participants" ADD CONSTRAINT fk_thread_participants_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT fk_messages_thread_id FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT fk_messages_sender_user_id FOREIGN KEY ("sender_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "message_attachments" ADD CONSTRAINT fk_message_attachments_message_id FOREIGN KEY ("message_id") REFERENCES "messages" ("id") ON DELETE CASCADE;
ALTER TABLE "message_attachments" ADD CONSTRAINT fk_message_attachments_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "message_reads" ADD CONSTRAINT fk_message_reads_thread_id FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE;
ALTER TABLE "message_reads" ADD CONSTRAINT fk_message_reads_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "message_reads" ADD CONSTRAINT fk_message_reads_last_read_message_id FOREIGN KEY ("last_read_message_id") REFERENCES "messages" ("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD CONSTRAINT fk_files_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "files" ADD CONSTRAINT fk_files_uploaded_by_user_id FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "file_versions" ADD CONSTRAINT fk_file_versions_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "file_links" ADD CONSTRAINT fk_file_links_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "file_access_grants" ADD CONSTRAINT fk_file_access_grants_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "file_access_grants" ADD CONSTRAINT fk_file_access_grants_grantee_user_id FOREIGN KEY ("grantee_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "file_access_grants" ADD CONSTRAINT fk_file_access_grants_grantee_org_id FOREIGN KEY ("grantee_org_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "file_access_grants" ADD CONSTRAINT fk_file_access_grants_engagement_id FOREIGN KEY ("engagement_id") REFERENCES "engagements" ("id") ON DELETE SET NULL;
ALTER TABLE "verification_cases" ADD CONSTRAINT fk_verification_cases_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "verification_cases" ADD CONSTRAINT fk_verification_cases_assigned_admin_id FOREIGN KEY ("assigned_admin_id") REFERENCES "platform_role_assignments" ("id") ON DELETE SET NULL;
ALTER TABLE "verification_evidence" ADD CONSTRAINT fk_verification_evidence_case_id FOREIGN KEY ("case_id") REFERENCES "verification_cases" ("id") ON DELETE SET NULL;
ALTER TABLE "verification_evidence" ADD CONSTRAINT fk_verification_evidence_file_id FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE;
ALTER TABLE "verification_evidence" ADD CONSTRAINT fk_verification_evidence_created_by FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "verification_decisions" ADD CONSTRAINT fk_verification_decisions_case_id FOREIGN KEY ("case_id") REFERENCES "verification_cases" ("id") ON DELETE CASCADE;
ALTER TABLE "verification_decisions" ADD CONSTRAINT fk_verification_decisions_decided_by FOREIGN KEY ("decided_by") REFERENCES "platform_role_assignments" ("id") ON DELETE RESTRICT;
ALTER TABLE "verified_claims" ADD CONSTRAINT fk_verified_claims_verification_case_id FOREIGN KEY ("verification_case_id") REFERENCES "verification_cases" ("id") ON DELETE CASCADE;
ALTER TABLE "organization_certifications" ADD CONSTRAINT fk_organization_certifications_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "organization_certifications" ADD CONSTRAINT fk_organization_certifications_facility_id FOREIGN KEY ("facility_id") REFERENCES "facilities" ("id") ON DELETE SET NULL;
ALTER TABLE "organization_certifications" ADD CONSTRAINT fk_organization_certifications_certification_type_id FOREIGN KEY ("certification_type_id") REFERENCES "certification_types" ("id") ON DELETE RESTRICT;
ALTER TABLE "organization_certifications" ADD CONSTRAINT fk_organization_certifications_evidence_id FOREIGN KEY ("evidence_id") REFERENCES "verification_evidence" ("id") ON DELETE SET NULL;
ALTER TABLE "reviews" ADD CONSTRAINT fk_reviews_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT fk_reviews_reviewer_org_id FOREIGN KEY ("reviewer_org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "reviews" ADD CONSTRAINT fk_reviews_reviewee_org_id FOREIGN KEY ("reviewee_org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "review_dimensions" ADD CONSTRAINT fk_review_dimensions_review_id FOREIGN KEY ("review_id") REFERENCES "reviews" ("id") ON DELETE CASCADE;
ALTER TABLE "review_responses" ADD CONSTRAINT fk_review_responses_review_id FOREIGN KEY ("review_id") REFERENCES "reviews" ("id") ON DELETE CASCADE;
ALTER TABLE "review_responses" ADD CONSTRAINT fk_review_responses_responder_user_id FOREIGN KEY ("responder_user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "provider_profiles" ADD CONSTRAINT fk_provider_profiles_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_services" ADD CONSTRAINT fk_provider_services_provider_profile_id FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profiles" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_service_areas" ADD CONSTRAINT fk_provider_service_areas_provider_service_id FOREIGN KEY ("provider_service_id") REFERENCES "provider_services" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_service_areas" ADD CONSTRAINT fk_provider_service_areas_country_code FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE SET NULL;
ALTER TABLE "provider_capabilities" ADD CONSTRAINT fk_provider_capabilities_provider_profile_id FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profiles" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_capabilities" ADD CONSTRAINT fk_provider_capabilities_capability_id FOREIGN KEY ("capability_id") REFERENCES "capabilities" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_requests" ADD CONSTRAINT fk_provider_requests_provider_profile_id FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profiles" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_requests" ADD CONSTRAINT fk_provider_requests_requester_org_id FOREIGN KEY ("requester_org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "provider_requests" ADD CONSTRAINT fk_provider_requests_project_id FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL;
ALTER TABLE "provider_quotes" ADD CONSTRAINT fk_provider_quotes_provider_request_id FOREIGN KEY ("provider_request_id") REFERENCES "provider_requests" ("id") ON DELETE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT fk_notifications_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT fk_notification_preferences_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT fk_notification_deliveries_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT fk_transactions_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT fk_transactions_booking_id FOREIGN KEY ("booking_id") REFERENCES "bookings" ("id") ON DELETE SET NULL;
ALTER TABLE "payment_attempts" ADD CONSTRAINT fk_payment_attempts_transaction_id FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT fk_refunds_transaction_id FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT fk_ledger_entries_transaction_id FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE RESTRICT;
ALTER TABLE "jobs" ADD CONSTRAINT fk_jobs_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "job_attempts" ADD CONSTRAINT fk_job_attempts_job_id FOREIGN KEY ("job_id") REFERENCES "jobs" ("id") ON DELETE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT fk_idempotency_keys_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "audit_logs" ADD CONSTRAINT fk_audit_logs_organization_context_id FOREIGN KEY ("organization_context_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "moderation_cases" ADD CONSTRAINT fk_moderation_cases_reported_by FOREIGN KEY ("reported_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "moderation_cases" ADD CONSTRAINT fk_moderation_cases_assigned_platform_role_id FOREIGN KEY ("assigned_platform_role_id") REFERENCES "platform_role_assignments" ("id") ON DELETE SET NULL;
ALTER TABLE "support_cases" ADD CONSTRAINT fk_support_cases_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE;
ALTER TABLE "support_cases" ADD CONSTRAINT fk_support_cases_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "support_cases" ADD CONSTRAINT fk_support_cases_assigned_platform_role_id FOREIGN KEY ("assigned_platform_role_id") REFERENCES "platform_role_assignments" ("id") ON DELETE SET NULL;
ALTER TABLE "admin_cases" ADD CONSTRAINT fk_admin_cases_assigned_to FOREIGN KEY ("assigned_to") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "admin_actions" ADD CONSTRAINT fk_admin_actions_case_id FOREIGN KEY ("case_id") REFERENCES "admin_cases" ("id") ON DELETE CASCADE;
ALTER TABLE "admin_actions" ADD CONSTRAINT fk_admin_actions_admin_user_id FOREIGN KEY ("admin_user_id") REFERENCES "users" ("id") ON DELETE RESTRICT;
ALTER TABLE "prompt_versions" ADD CONSTRAINT fk_prompt_versions_approved_by FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_runs" ADD CONSTRAINT fk_agent_runs_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_runs" ADD CONSTRAINT fk_agent_runs_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_runs" ADD CONSTRAINT fk_agent_runs_agent_definition_id FOREIGN KEY ("agent_definition_id") REFERENCES "agent_definitions" ("id") ON DELETE RESTRICT;
ALTER TABLE "agent_runs" ADD CONSTRAINT fk_agent_runs_prompt_version_id FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_versions" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_runs" ADD CONSTRAINT fk_agent_runs_model_version_id FOREIGN KEY ("model_version_id") REFERENCES "model_versions" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_messages" ADD CONSTRAINT fk_agent_messages_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT fk_agent_tool_calls_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "agent_approvals" ADD CONSTRAINT fk_agent_approvals_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "agent_approvals" ADD CONSTRAINT fk_agent_approvals_requested_by FOREIGN KEY ("requested_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_approvals" ADD CONSTRAINT fk_agent_approvals_approved_by FOREIGN KEY ("approved_by") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_feedback" ADD CONSTRAINT fk_agent_feedback_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "agent_feedback" ADD CONSTRAINT fk_agent_feedback_user_id FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL;
ALTER TABLE "agent_evaluations" ADD CONSTRAINT fk_agent_evaluations_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT fk_ai_usage_events_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE CASCADE;
ALTER TABLE "ai_usage_events" ADD CONSTRAINT fk_ai_usage_events_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "ai_cache_events" ADD CONSTRAINT fk_ai_cache_events_organization_id FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON DELETE SET NULL;
ALTER TABLE "ai_cache_events" ADD CONSTRAINT fk_ai_cache_events_agent_run_id FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs" ("id") ON DELETE SET NULL;

-- ============================== INDEXES ==============================

CREATE INDEX ix_users_status ON "users" ("status");
CREATE INDEX ix_user_auth_identities_user_id ON "user_auth_identities" ("user_id");
CREATE INDEX ix_organizations_organization_type_status ON "organizations" ("organization_type", "status");
CREATE INDEX ix_organizations_industry_id ON "organizations" ("industry_id");
CREATE INDEX ix_organizations_created_by_user_id ON "organizations" (created_by_user_id);
CREATE INDEX ix_organization_profiles_country_code ON "organization_profiles" (country_code);
CREATE INDEX ix_memberships_user_id_status ON "memberships" ("user_id", "status");
CREATE INDEX ix_memberships_user_id ON "memberships" (user_id);
CREATE INDEX ix_memberships_organization_id ON "memberships" (organization_id);
CREATE INDEX ix_memberships_invited_by ON "memberships" (invited_by);
CREATE INDEX ix_membership_invitations_expires_at ON "membership_invitations" ("expires_at");
CREATE INDEX ix_membership_invitations_organization_id ON "membership_invitations" (organization_id);
CREATE INDEX ix_membership_invitations_invited_by_membership_id ON "membership_invitations" (invited_by_membership_id);
CREATE INDEX ix_marketplace_role_selections_user_id_status ON "marketplace_role_selections" ("user_id", "status");
CREATE INDEX ix_marketplace_role_selections_user_id ON "marketplace_role_selections" (user_id);
CREATE INDEX ix_platform_role_assignments_user_id_status ON "platform_role_assignments" ("user_id", "status");
CREATE INDEX ix_platform_role_assignments_user_id ON "platform_role_assignments" (user_id);
CREATE INDEX ix_platform_role_assignments_granted_by_user_id ON "platform_role_assignments" (granted_by_user_id);
CREATE INDEX ix_taxonomy_terms_term_type_status ON "taxonomy_terms" ("term_type", "status");
CREATE INDEX ix_taxonomy_terms_parent_term_id ON "taxonomy_terms" ("parent_term_id");
CREATE INDEX ix_regions_country_code ON "regions" (country_code);
CREATE INDEX ix_facilities_organization_id_status ON "facilities" ("organization_id", "status");
CREATE INDEX ix_facilities_location ON "facilities" ("location");
CREATE INDEX ix_facilities_organization_id ON "facilities" (organization_id);
CREATE INDEX ix_facilities_country_code ON "facilities" (country_code);
CREATE INDEX ix_capabilities_organization_id_status ON "capabilities" ("organization_id", "status");
CREATE INDEX ix_capabilities_facility_id ON "capabilities" ("facility_id");
CREATE INDEX ix_capabilities_taxonomy_term_id ON "capabilities" ("taxonomy_term_id");
CREATE INDEX ix_capabilities_organization_id ON "capabilities" (organization_id);
CREATE INDEX ix_capability_taxonomy_mappings_capability_id ON "capability_taxonomy_mappings" ("capability_id");
CREATE INDEX ix_capability_taxonomy_mappings_taxonomy_term_id ON "capability_taxonomy_mappings" (taxonomy_term_id);
CREATE INDEX ix_capability_materials_capability_id ON "capability_materials" (capability_id);
CREATE INDEX ix_capability_materials_material_term_id ON "capability_materials" (material_term_id);
CREATE INDEX ix_capability_materials_unit_code ON "capability_materials" (unit_code);
CREATE INDEX ix_capability_certifications_capability_id ON "capability_certifications" (capability_id);
CREATE INDEX ix_capability_certifications_certification_id ON "capability_certifications" (certification_id);
CREATE INDEX ix_capability_certifications_evidence_id ON "capability_certifications" (evidence_id);
CREATE INDEX ix_capability_claims_capability_id ON "capability_claims" ("capability_id");
CREATE INDEX ix_capability_claims_verification_status ON "capability_claims" ("verification_status");
CREATE INDEX ix_availability_snapshots_capability_id_as_of ON "availability_snapshots" ("capability_id", "as_of");
CREATE INDEX ix_availability_snapshots_capability_id ON "availability_snapshots" (capability_id);
CREATE INDEX ix_availability_snapshots_recorded_by_membership_id ON "availability_snapshots" (recorded_by_membership_id);
CREATE INDEX ix_machines_organization_id ON "machines" ("organization_id");
CREATE INDEX ix_machines_facility_id ON "machines" ("facility_id");
CREATE INDEX ix_machines_machinery_term_id ON "machines" ("machinery_term_id");
CREATE INDEX ix_machines_publication_status ON "machines" ("publication_status");
CREATE INDEX ix_machine_specs_machine_id ON "machine_specs" (machine_id);
CREATE INDEX ix_machine_specs_unit_code ON "machine_specs" (unit_code);
CREATE INDEX ix_machine_images_machine_id_display_order ON "machine_images" ("machine_id", "display_order");
CREATE INDEX ix_machine_images_machine_id ON "machine_images" (machine_id);
CREATE INDEX ix_machine_images_file_id ON "machine_images" (file_id);
CREATE INDEX ix_service_offerings_organization_id_publication_status ON "service_offerings" ("organization_id", "publication_status");
CREATE INDEX ix_service_offerings_organization_id ON "service_offerings" (organization_id);
CREATE INDEX ix_service_offerings_facility_id ON "service_offerings" (facility_id);
CREATE INDEX ix_inventory_items_organization_id_status ON "inventory_items" ("organization_id", "status");
CREATE INDEX ix_inventory_items_facility_id_status ON "inventory_items" ("facility_id", "status");
CREATE INDEX ix_inventory_items_organization_id ON "inventory_items" (organization_id);
CREATE INDEX ix_inventory_items_facility_id ON "inventory_items" (facility_id);
CREATE INDEX ix_inventory_items_machine_id ON "inventory_items" (machine_id);
CREATE INDEX ix_inventory_items_service_offering_id ON "inventory_items" (service_offering_id);
CREATE INDEX ix_price_books_organization_id_status_effective_from ON "price_books" ("organization_id", "status", "effective_from");
CREATE INDEX ix_price_books_organization_id ON "price_books" (organization_id);
CREATE INDEX ix_price_items_price_book_id ON "price_items" ("price_book_id");
CREATE INDEX ix_price_items_resource_type_resource_id ON "price_items" ("resource_type", "resource_id");
CREATE INDEX ix_price_items_unit_code ON "price_items" (unit_code);
CREATE INDEX ix_availability_calendars_organization_id ON "availability_calendars" (organization_id);
CREATE INDEX ix_availability_windows_calendar_id_start_at ON "availability_windows" ("calendar_id", "start_at");
CREATE INDEX ix_availability_windows_calendar_id ON "availability_windows" (calendar_id);
CREATE INDEX ix_availability_windows_unit_code ON "availability_windows" (unit_code);
CREATE INDEX ix_availability_exceptions_calendar_id_start_at ON "availability_exceptions" ("calendar_id", "start_at");
CREATE INDEX ix_availability_exceptions_calendar_id ON "availability_exceptions" (calendar_id);
CREATE INDEX ix_availability_reservations_availability_window_id_status ON "availability_reservations" ("availability_window_id", "status");
CREATE INDEX ix_availability_reservations_availability_window_id ON "availability_reservations" (availability_window_id);
CREATE INDEX ix_availability_reservations_booking_id ON "availability_reservations" (booking_id);
CREATE INDEX ix_opportunities_organization_id_status ON "opportunities" ("organization_id", "status");
CREATE INDEX ix_opportunities_owner_user_id ON "opportunities" ("owner_user_id");
CREATE INDEX ix_opportunities_organization_id ON "opportunities" (organization_id);
CREATE INDEX ix_opportunities_created_by_user_id ON "opportunities" (created_by_user_id);
CREATE INDEX ix_opportunity_versions_opportunity_id ON "opportunity_versions" (opportunity_id);
CREATE INDEX ix_requirement_sets_opportunity_id_status ON "requirement_sets" ("opportunity_id", "status");
CREATE INDEX ix_requirement_sets_opportunity_id ON "requirement_sets" (opportunity_id);
CREATE INDEX ix_requirement_sets_version_id ON "requirement_sets" (version_id);
CREATE INDEX ix_requirement_processes_requirement_set_id ON "requirement_processes" (requirement_set_id);
CREATE INDEX ix_requirement_processes_process_term_id ON "requirement_processes" (process_term_id);
CREATE INDEX ix_requirement_materials_requirement_set_id ON "requirement_materials" (requirement_set_id);
CREATE INDEX ix_requirement_materials_material_term_id ON "requirement_materials" (material_term_id);
CREATE INDEX ix_requirement_materials_unit_code ON "requirement_materials" (unit_code);
CREATE INDEX ix_requirement_machinery_requirement_set_id ON "requirement_machinery" (requirement_set_id);
CREATE INDEX ix_requirement_machinery_machinery_term_id ON "requirement_machinery" (machinery_term_id);
CREATE INDEX ix_requirement_certifications_requirement_set_id ON "requirement_certifications" (requirement_set_id);
CREATE INDEX ix_requirement_certifications_certification_term_id ON "requirement_certifications" (certification_term_id);
CREATE INDEX ix_requirement_files_requirement_set_id ON "requirement_files" (requirement_set_id);
CREATE INDEX ix_requirement_files_file_id ON "requirement_files" (file_id);
CREATE INDEX ix_requirement_questions_requirement_set_id ON "requirement_questions" ("requirement_set_id");
CREATE INDEX ix_requirement_items_requirement_set_id ON "requirement_items" ("requirement_set_id");
CREATE INDEX ix_requirement_items_source ON "requirement_items" ("source");
CREATE INDEX ix_requirement_items_agent_run_id ON "requirement_items" (agent_run_id);
CREATE INDEX ix_match_runs_requirement_set_id_status ON "match_runs" ("requirement_set_id", "status");
CREATE INDEX ix_match_runs_requirement_set_id ON "match_runs" (requirement_set_id);
CREATE INDEX ix_match_runs_agent_run_id ON "match_runs" (agent_run_id);
CREATE INDEX ix_matches_match_run_id_score ON "matches" ("match_run_id", "score");
CREATE INDEX ix_matches_organization_id ON "matches" ("organization_id");
CREATE INDEX ix_matches_match_run_id ON "matches" (match_run_id);
CREATE INDEX ix_matches_capability_id ON "matches" (capability_id);
CREATE INDEX ix_match_evidence_match_id_evidence_type ON "match_evidence" ("match_id", "evidence_type");
CREATE INDEX ix_match_evidence_match_id ON "match_evidence" (match_id);
CREATE INDEX ix_shortlist_entries_opportunity_id ON "shortlist_entries" (opportunity_id);
CREATE INDEX ix_shortlist_entries_match_id ON "shortlist_entries" (match_id);
CREATE INDEX ix_shortlist_entries_added_by_user_id ON "shortlist_entries" (added_by_user_id);
CREATE INDEX ix_match_feedback_match_id ON "match_feedback" ("match_id");
CREATE INDEX ix_match_feedback_user_id ON "match_feedback" (user_id);
CREATE INDEX ix_engagements_demand_organization_id_status ON "engagements" ("demand_organization_id", "status");
CREATE INDEX ix_engagements_supply_organization_id_status ON "engagements" ("supply_organization_id", "status");
CREATE INDEX ix_engagements_opportunity_id ON "engagements" (opportunity_id);
CREATE INDEX ix_engagements_match_id ON "engagements" (match_id);
CREATE INDEX ix_engagements_demand_organization_id ON "engagements" (demand_organization_id);
CREATE INDEX ix_engagements_supply_organization_id ON "engagements" (supply_organization_id);
CREATE INDEX ix_engagements_created_by_user_id ON "engagements" (created_by_user_id);
CREATE INDEX ix_engagement_participants_engagement_id ON "engagement_participants" (engagement_id);
CREATE INDEX ix_engagement_participants_organization_id ON "engagement_participants" (organization_id);
CREATE INDEX ix_engagement_participants_user_id ON "engagement_participants" (user_id);
CREATE INDEX ix_engagement_responses_engagement_id_status ON "engagement_responses" ("engagement_id", "status");
CREATE INDEX ix_engagement_responses_engagement_id ON "engagement_responses" (engagement_id);
CREATE INDEX ix_engagement_responses_submitted_by_membership_id ON "engagement_responses" (submitted_by_membership_id);
CREATE INDEX ix_requests_engagement_id_status ON "requests" ("engagement_id", "status");
CREATE INDEX ix_requests_engagement_id ON "requests" (engagement_id);
CREATE INDEX ix_requests_requested_by_user_id ON "requests" (requested_by_user_id);
CREATE INDEX ix_quotes_engagement_id_status ON "quotes" ("engagement_id", "status");
CREATE INDEX ix_quotes_engagement_id ON "quotes" (engagement_id);
CREATE INDEX ix_quote_items_quote_id ON "quote_items" ("quote_id");
CREATE INDEX ix_quote_items_unit_code ON "quote_items" (unit_code);
CREATE INDEX ix_offers_quote_id_status ON "offers" ("quote_id", "status");
CREATE INDEX ix_offers_quote_id ON "offers" (quote_id);
CREATE INDEX ix_offers_offered_by_user_id ON "offers" (offered_by_user_id);
CREATE INDEX ix_offers_parent_offer_id ON "offers" (parent_offer_id);
CREATE INDEX ix_offer_terms_offer_id ON "offer_terms" (offer_id);
CREATE INDEX ix_offer_terms_unit_code ON "offer_terms" (unit_code);
CREATE INDEX ix_bookings_demand_organization_id ON "bookings" ("demand_organization_id");
CREATE INDEX ix_bookings_supply_organization_id ON "bookings" ("supply_organization_id");
CREATE INDEX ix_bookings_status ON "bookings" ("status");
CREATE INDEX ix_bookings_engagement_id ON "bookings" (engagement_id);
CREATE INDEX ix_bookings_accepted_offer_id ON "bookings" (accepted_offer_id);
CREATE INDEX ix_bookings_unit_code ON "bookings" (unit_code);
CREATE INDEX ix_booking_events_booking_id_created_at ON "booking_events" ("booking_id", "created_at");
CREATE INDEX ix_booking_events_booking_id ON "booking_events" (booking_id);
CREATE INDEX ix_booking_events_actor_user_id ON "booking_events" (actor_user_id);
CREATE INDEX ix_booking_amendments_booking_id_created_at ON "booking_amendments" ("booking_id", "created_at");
CREATE INDEX ix_booking_amendments_booking_id ON "booking_amendments" (booking_id);
CREATE INDEX ix_booking_amendments_approved_by ON "booking_amendments" (approved_by);
CREATE INDEX ix_projects_organization_id_status ON "projects" ("organization_id", "status");
CREATE INDEX ix_projects_booking_id ON "projects" ("booking_id");
CREATE INDEX ix_projects_organization_id ON "projects" (organization_id);
CREATE INDEX ix_project_participants_project_id ON "project_participants" (project_id);
CREATE INDEX ix_project_participants_organization_id ON "project_participants" (organization_id);
CREATE INDEX ix_project_participants_user_id ON "project_participants" (user_id);
CREATE INDEX ix_milestones_project_id ON "milestones" (project_id);
CREATE INDEX ix_project_updates_project_id_created_at ON "project_updates" ("project_id", "created_at");
CREATE INDEX ix_project_updates_project_id ON "project_updates" (project_id);
CREATE INDEX ix_project_updates_milestone_id ON "project_updates" (milestone_id);
CREATE INDEX ix_project_updates_author_user_id ON "project_updates" (author_user_id);
CREATE INDEX ix_project_tasks_project_id_status ON "project_tasks" ("project_id", "status");
CREATE INDEX ix_project_tasks_owner_org_id_status ON "project_tasks" ("owner_org_id", "status");
CREATE INDEX ix_project_tasks_project_id ON "project_tasks" (project_id);
CREATE INDEX ix_project_tasks_owner_org_id ON "project_tasks" (owner_org_id);
CREATE INDEX ix_project_files_project_id ON "project_files" (project_id);
CREATE INDEX ix_project_files_file_id ON "project_files" (file_id);
CREATE INDEX ix_threads_engagement_id ON "threads" ("engagement_id");
CREATE INDEX ix_threads_project_id ON "threads" ("project_id");
CREATE INDEX ix_thread_participants_thread_id ON "thread_participants" (thread_id);
CREATE INDEX ix_thread_participants_organization_id ON "thread_participants" (organization_id);
CREATE INDEX ix_thread_participants_user_id ON "thread_participants" (user_id);
CREATE INDEX ix_messages_thread_id_created_at ON "messages" ("thread_id", "created_at");
CREATE INDEX ix_messages_thread_id ON "messages" (thread_id);
CREATE INDEX ix_messages_sender_user_id ON "messages" (sender_user_id);
CREATE INDEX ix_message_attachments_message_id ON "message_attachments" (message_id);
CREATE INDEX ix_message_attachments_file_id ON "message_attachments" (file_id);
CREATE INDEX ix_message_reads_thread_id ON "message_reads" (thread_id);
CREATE INDEX ix_message_reads_user_id ON "message_reads" (user_id);
CREATE INDEX ix_message_reads_last_read_message_id ON "message_reads" (last_read_message_id);
CREATE INDEX ix_files_organization_id ON "files" ("organization_id");
CREATE INDEX ix_files_scan_status ON "files" ("scan_status");
CREATE INDEX ix_files_uploaded_by_user_id ON "files" (uploaded_by_user_id);
CREATE INDEX ix_file_versions_file_id ON "file_versions" (file_id);
CREATE INDEX ix_file_links_resource_type_resource_id ON "file_links" ("resource_type", "resource_id");
CREATE INDEX ix_file_links_file_id ON "file_links" (file_id);
CREATE INDEX ix_file_access_grants_file_id_expires_at ON "file_access_grants" ("file_id", "expires_at");
CREATE INDEX ix_file_access_grants_file_id ON "file_access_grants" (file_id);
CREATE INDEX ix_file_access_grants_grantee_user_id ON "file_access_grants" (grantee_user_id);
CREATE INDEX ix_file_access_grants_grantee_org_id ON "file_access_grants" (grantee_org_id);
CREATE INDEX ix_file_access_grants_engagement_id ON "file_access_grants" (engagement_id);
CREATE INDEX ix_verification_cases_organization_id_status ON "verification_cases" ("organization_id", "status");
CREATE INDEX ix_verification_cases_status_opened_at ON "verification_cases" ("status", "opened_at");
CREATE INDEX ix_verification_cases_organization_id ON "verification_cases" (organization_id);
CREATE INDEX ix_verification_cases_assigned_admin_id ON "verification_cases" (assigned_admin_id);
CREATE INDEX ix_verification_evidence_case_id_status ON "verification_evidence" ("case_id", "status");
CREATE INDEX ix_verification_evidence_expires_at ON "verification_evidence" ("expires_at");
CREATE INDEX ix_verification_evidence_case_id ON "verification_evidence" (case_id);
CREATE INDEX ix_verification_evidence_file_id ON "verification_evidence" (file_id);
CREATE INDEX ix_verification_evidence_created_by ON "verification_evidence" (created_by);
CREATE INDEX ix_verification_decisions_case_id_decided_at ON "verification_decisions" ("case_id", "decided_at");
CREATE INDEX ix_verification_decisions_case_id ON "verification_decisions" (case_id);
CREATE INDEX ix_verification_decisions_decided_by ON "verification_decisions" (decided_by);
CREATE INDEX ix_verified_claims_subject_type_subject_id_status ON "verified_claims" ("subject_type", "subject_id", "status");
CREATE INDEX ix_verified_claims_verification_case_id ON "verified_claims" (verification_case_id);
CREATE INDEX ix_organization_certifications_organization_id_status ON "organization_certifications" ("organization_id", "status");
CREATE INDEX ix_organization_certifications_organization_id ON "organization_certifications" (organization_id);
CREATE INDEX ix_organization_certifications_facility_id ON "organization_certifications" (facility_id);
CREATE INDEX ix_organization_certifications_certification_type_id ON "organization_certifications" (certification_type_id);
CREATE INDEX ix_organization_certifications_evidence_id ON "organization_certifications" (evidence_id);
CREATE INDEX ix_reviews_booking_id ON "reviews" (booking_id);
CREATE INDEX ix_reviews_reviewer_org_id ON "reviews" (reviewer_org_id);
CREATE INDEX ix_reviews_reviewee_org_id ON "reviews" (reviewee_org_id);
CREATE INDEX ix_review_dimensions_review_id ON "review_dimensions" (review_id);
CREATE INDEX ix_review_responses_review_id ON "review_responses" (review_id);
CREATE INDEX ix_review_responses_responder_user_id ON "review_responses" (responder_user_id);
CREATE INDEX ix_provider_profiles_organization_id ON "provider_profiles" (organization_id);
CREATE INDEX ix_provider_services_provider_profile_id_status ON "provider_services" ("provider_profile_id", "status");
CREATE INDEX ix_provider_services_provider_profile_id ON "provider_services" (provider_profile_id);
CREATE INDEX ix_provider_service_areas_location ON "provider_service_areas" ("location");
CREATE INDEX ix_provider_service_areas_provider_service_id ON "provider_service_areas" (provider_service_id);
CREATE INDEX ix_provider_service_areas_country_code ON "provider_service_areas" (country_code);
CREATE INDEX ix_provider_capabilities_provider_profile_id ON "provider_capabilities" (provider_profile_id);
CREATE INDEX ix_provider_capabilities_capability_id ON "provider_capabilities" (capability_id);
CREATE INDEX ix_provider_requests_provider_profile_id_status ON "provider_requests" ("provider_profile_id", "status");
CREATE INDEX ix_provider_requests_provider_profile_id ON "provider_requests" (provider_profile_id);
CREATE INDEX ix_provider_requests_requester_org_id ON "provider_requests" (requester_org_id);
CREATE INDEX ix_provider_requests_project_id ON "provider_requests" (project_id);
CREATE INDEX ix_provider_quotes_provider_request_id_status ON "provider_quotes" ("provider_request_id", "status");
CREATE INDEX ix_provider_quotes_provider_request_id ON "provider_quotes" (provider_request_id);
CREATE INDEX ix_notifications_user_id_status ON "notifications" ("user_id", "status");
CREATE INDEX ix_notifications_related_type_related_id ON "notifications" ("related_type", "related_id");
CREATE INDEX ix_notifications_user_id ON "notifications" (user_id);
CREATE INDEX ix_notification_preferences_user_id ON "notification_preferences" (user_id);
CREATE INDEX ix_notification_deliveries_user_id_created_at ON "notification_deliveries" ("user_id", "created_at");
CREATE INDEX ix_notification_deliveries_status_created_at ON "notification_deliveries" ("status", "created_at");
CREATE INDEX ix_notification_deliveries_user_id ON "notification_deliveries" (user_id);
CREATE INDEX ix_transactions_organization_id_status ON "transactions" ("organization_id", "status");
CREATE INDEX ix_transactions_booking_id ON "transactions" ("booking_id");
CREATE INDEX ix_transactions_organization_id ON "transactions" (organization_id);
CREATE INDEX ix_payment_attempts_transaction_id ON "payment_attempts" (transaction_id);
CREATE INDEX ix_refunds_transaction_id_status ON "refunds" ("transaction_id", "status");
CREATE INDEX ix_refunds_transaction_id ON "refunds" (transaction_id);
CREATE INDEX ix_ledger_entries_transaction_id ON "ledger_entries" ("transaction_id");
CREATE INDEX ix_outbox_events_status_available_at ON "outbox_events" ("status", "available_at");
CREATE INDEX ix_jobs_status_available_at ON "jobs" ("status", "available_at");
CREATE INDEX ix_jobs_organization_id ON "jobs" (organization_id);
CREATE INDEX ix_job_attempts_job_id ON "job_attempts" (job_id);
CREATE INDEX ix_idempotency_keys_expires_at ON "idempotency_keys" ("expires_at");
CREATE INDEX ix_idempotency_keys_organization_id ON "idempotency_keys" (organization_id);
CREATE INDEX ix_audit_logs_entity_type_entity_id ON "audit_logs" ("entity_type", "entity_id");
CREATE INDEX ix_audit_logs_actor_type_actor_id ON "audit_logs" ("actor_type", "actor_id");
CREATE INDEX ix_audit_logs_occurred_at ON "audit_logs" ("occurred_at");
CREATE INDEX ix_audit_logs_correlation_id ON "audit_logs" ("correlation_id");
CREATE INDEX ix_audit_logs_organization_context_id ON "audit_logs" (organization_context_id);
CREATE INDEX ix_moderation_cases_status ON "moderation_cases" ("status");
CREATE INDEX ix_moderation_cases_subject_type_subject_id ON "moderation_cases" ("subject_type", "subject_id");
CREATE INDEX ix_moderation_cases_reported_by ON "moderation_cases" (reported_by);
CREATE INDEX ix_moderation_cases_assigned_platform_role_id ON "moderation_cases" (assigned_platform_role_id);
CREATE INDEX ix_support_cases_status ON "support_cases" ("status");
CREATE INDEX ix_support_cases_user_id ON "support_cases" ("user_id");
CREATE INDEX ix_support_cases_organization_id ON "support_cases" (organization_id);
CREATE INDEX ix_support_cases_assigned_platform_role_id ON "support_cases" (assigned_platform_role_id);
CREATE INDEX ix_admin_cases_status_priority ON "admin_cases" ("status", "priority");
CREATE INDEX ix_admin_cases_assigned_to ON "admin_cases" (assigned_to);
CREATE INDEX ix_admin_actions_case_id ON "admin_actions" ("case_id");
CREATE INDEX ix_admin_actions_admin_user_id ON "admin_actions" (admin_user_id);
CREATE INDEX ix_analytics_events_event_type_occurred_at ON "analytics_events" ("event_type", "occurred_at");
CREATE INDEX ix_prompt_versions_approved_by ON "prompt_versions" (approved_by);
CREATE INDEX ix_agent_runs_organization_id_status ON "agent_runs" ("organization_id", "status");
CREATE INDEX ix_agent_runs_user_id ON "agent_runs" ("user_id");
CREATE INDEX ix_agent_runs_started_at ON "agent_runs" ("started_at");
CREATE INDEX ix_agent_runs_organization_id ON "agent_runs" (organization_id);
CREATE INDEX ix_agent_runs_agent_definition_id ON "agent_runs" (agent_definition_id);
CREATE INDEX ix_agent_runs_prompt_version_id ON "agent_runs" (prompt_version_id);
CREATE INDEX ix_agent_runs_model_version_id ON "agent_runs" (model_version_id);
CREATE INDEX ix_agent_messages_agent_run_id_created_at ON "agent_messages" ("agent_run_id", "created_at");
CREATE INDEX ix_agent_messages_agent_run_id ON "agent_messages" (agent_run_id);
CREATE INDEX ix_agent_tool_calls_agent_run_id_tool_code ON "agent_tool_calls" ("agent_run_id", "tool_code");
CREATE INDEX ix_agent_tool_calls_status ON "agent_tool_calls" ("status");
CREATE INDEX ix_agent_tool_calls_agent_run_id ON "agent_tool_calls" (agent_run_id);
CREATE INDEX ix_agent_approvals_agent_run_id ON "agent_approvals" ("agent_run_id");
CREATE INDEX ix_agent_approvals_decision_expires_at ON "agent_approvals" ("decision", "expires_at");
CREATE INDEX ix_agent_approvals_requested_by ON "agent_approvals" (requested_by);
CREATE INDEX ix_agent_approvals_approved_by ON "agent_approvals" (approved_by);
CREATE INDEX ix_agent_feedback_agent_run_id ON "agent_feedback" ("agent_run_id");
CREATE INDEX ix_agent_feedback_user_id ON "agent_feedback" (user_id);
CREATE INDEX ix_agent_evaluations_agent_run_id_evaluation_type ON "agent_evaluations" ("agent_run_id", "evaluation_type");
CREATE INDEX ix_agent_evaluations_agent_run_id ON "agent_evaluations" (agent_run_id);
CREATE INDEX ix_ai_usage_events_organization_id_created_at ON "ai_usage_events" ("organization_id", "created_at");
CREATE INDEX ix_ai_usage_events_model_name_created_at ON "ai_usage_events" ("model_name", "created_at");
CREATE INDEX ix_ai_usage_events_agent_run_id ON "ai_usage_events" ("agent_run_id");
CREATE INDEX ix_ai_usage_events_organization_id ON "ai_usage_events" (organization_id);
CREATE INDEX ix_ai_cache_events_organization_id_created_at ON "ai_cache_events" ("organization_id", "created_at");
CREATE INDEX ix_ai_cache_events_organization_id ON "ai_cache_events" (organization_id);
CREATE INDEX ix_ai_cache_events_agent_run_id ON "ai_cache_events" (agent_run_id);

-- ============== PART 2: MANUFACTURER EXTENSION (8 tables) ==============

-- X!Y manufacturer-side additive migration
-- Prerequisite: XY_Database_Schema(3).sql

BEGIN;

-- ---------------------------------------------------------------------
-- Personal fields required by the manufacturer sign-up screen.
-- Clerk remains the authentication/session source of truth.
-- ---------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS date_of_birth DATE,
    ADD COLUMN IF NOT EXISTS avatar_file_id UUID;

ALTER TABLE users
    ADD CONSTRAINT chk_users_date_of_birth
    CHECK (date_of_birth IS NULL OR date_of_birth <= created_at::date);

ALTER TABLE users
    ADD CONSTRAINT fk_users_avatar_file_id
    FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Company profile fields from manufacturer onboarding.
-- Restricted registration data stays in organization_profiles.
-- ---------------------------------------------------------------------
ALTER TABLE organization_profiles
    ADD COLUMN IF NOT EXISTS logo_file_id UUID,
    ADD COLUMN IF NOT EXISTS cover_file_id UUID,
    ADD COLUMN IF NOT EXISTS company_category TEXT,
    ADD COLUMN IF NOT EXISTS business_type TEXT,
    ADD COLUMN IF NOT EXISTS organization_size TEXT,
    ADD COLUMN IF NOT EXISTS establishment_year SMALLINT,
    ADD COLUMN IF NOT EXISTS employee_count INTEGER,
    ADD COLUMN IF NOT EXISTS about_company TEXT,
    ADD COLUMN IF NOT EXISTS vision TEXT,
    ADD COLUMN IF NOT EXISTS mission TEXT,
    ADD COLUMN IF NOT EXISTS stated_production_capacity NUMERIC(18,4),
    ADD COLUMN IF NOT EXISTS production_capacity_unit_code TEXT;

ALTER TABLE organization_profiles
    ADD CONSTRAINT chk_org_profiles_establishment_year
        CHECK (establishment_year IS NULL OR establishment_year BETWEEN 1700 AND EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER),
    ADD CONSTRAINT chk_org_profiles_employee_count
        CHECK (employee_count IS NULL OR employee_count >= 0),
    ADD CONSTRAINT chk_org_profiles_production_capacity
        CHECK (stated_production_capacity IS NULL OR stated_production_capacity >= 0),
    ADD CONSTRAINT fk_org_profiles_logo_file_id
        FOREIGN KEY (logo_file_id) REFERENCES files(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_org_profiles_cover_file_id
        FOREIGN KEY (cover_file_id) REFERENCES files(id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_org_profiles_capacity_unit
        FOREIGN KEY (production_capacity_unit_code) REFERENCES units(code) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- Facility address fields not represented separately in the base table.
-- `location` remains the PostGIS point used for geographic matching.
-- ---------------------------------------------------------------------
ALTER TABLE facilities
    ADD COLUMN IF NOT EXISTS address_line1 TEXT,
    ADD COLUMN IF NOT EXISTS address_line2 TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS state_province TEXT,
    ADD COLUMN IF NOT EXISTS service_radius_km NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS is_headquarters BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE facilities
    ADD CONSTRAINT chk_facilities_service_radius
    CHECK (service_radius_km IS NULL OR service_radius_km >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_facilities_one_headquarters
    ON facilities (organization_id)
    WHERE is_headquarters = TRUE AND status <> 'suspended';

CREATE INDEX IF NOT EXISTS ix_facilities_location_gist
    ON facilities USING GIST (location);

CREATE INDEX IF NOT EXISTS ix_facilities_geography_search
    ON facilities (country_code, region_code, city);

-- ---------------------------------------------------------------------
-- Manufacturer onboarding progress. UI steps are persisted independently
-- from organization approval/verification status.
-- ---------------------------------------------------------------------
CREATE TABLE manufacturer_onboarding (
    organization_id UUID PRIMARY KEY,
    current_step TEXT NOT NULL DEFAULT 'personal_information',
    personal_information_completed BOOLEAN NOT NULL DEFAULT FALSE,
    company_information_completed BOOLEAN NOT NULL DEFAULT FALSE,
    location_completed BOOLEAN NOT NULL DEFAULT FALSE,
    certification_completed BOOLEAN NOT NULL DEFAULT FALSE,
    infrastructure_completed BOOLEAN NOT NULL DEFAULT FALSE,
    faq_completed BOOLEAN NOT NULL DEFAULT FALSE,
    completion_percentage SMALLINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id UUID,
    rejection_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_manufacturer_onboarding_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_manufacturer_onboarding_reviewer
        FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_manufacturer_onboarding_step CHECK (
        current_step IN ('personal_information','company_information','location','certification','infrastructure','faq','completed')
    ),
    CONSTRAINT chk_manufacturer_onboarding_percent CHECK (completion_percentage BETWEEN 0 AND 100),
    CONSTRAINT chk_manufacturer_onboarding_status CHECK (
        status IN ('draft','in_progress','submitted','under_review','approved','changes_requested','rejected')
    )
);

CREATE INDEX ix_manufacturer_onboarding_status
    ON manufacturer_onboarding(status, updated_at DESC);

-- ---------------------------------------------------------------------
-- Reusable infrastructure question/catalog and manufacturer answers.
-- ---------------------------------------------------------------------
CREATE TABLE infrastructure_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    answer_type TEXT NOT NULL DEFAULT 'boolean',
    unit_code TEXT,
    display_order SMALLINT NOT NULL DEFAULT 0,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_infrastructure_items_unit
        FOREIGN KEY (unit_code) REFERENCES units(code) ON DELETE SET NULL,
    CONSTRAINT chk_infrastructure_items_category CHECK (
        category IN ('electricity','water','storage','packing','waste_disposal','quality_assurance','safety','other')
    ),
    CONSTRAINT chk_infrastructure_items_answer_type CHECK (
        answer_type IN ('boolean','text','number','single_choice','multiple_choice','json')
    ),
    CONSTRAINT chk_infrastructure_items_status CHECK (status IN ('active','retired'))
);

CREATE TABLE manufacturer_infrastructure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    facility_id UUID,
    infrastructure_item_id UUID NOT NULL,
    boolean_value BOOLEAN,
    text_value TEXT,
    numeric_value NUMERIC(18,4),
    option_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_file_id UUID,
    verification_status TEXT NOT NULL DEFAULT 'self_declared',
    verified_at TIMESTAMPTZ,
    updated_by_membership_id UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_manufacturer_infrastructure_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_manufacturer_infrastructure_facility
        FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
    CONSTRAINT fk_manufacturer_infrastructure_item
        FOREIGN KEY (infrastructure_item_id) REFERENCES infrastructure_items(id) ON DELETE RESTRICT,
    CONSTRAINT fk_manufacturer_infrastructure_evidence
        FOREIGN KEY (evidence_file_id) REFERENCES files(id) ON DELETE SET NULL,
    CONSTRAINT fk_manufacturer_infrastructure_member
        FOREIGN KEY (updated_by_membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
    CONSTRAINT uq_manufacturer_infrastructure
        UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, infrastructure_item_id),
    CONSTRAINT chk_manufacturer_infra_verification CHECK (
        verification_status IN ('self_declared','evidence_submitted','verified','rejected','expired')
    )
);

CREATE INDEX ix_manufacturer_infrastructure_org_facility
    ON manufacturer_infrastructure(organization_id, facility_id);

-- ---------------------------------------------------------------------
-- Configurable manufacturer FAQ questionnaire and answers.
-- ---------------------------------------------------------------------
CREATE TABLE manufacturer_faq_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_code TEXT NOT NULL UNIQUE,
    question_text TEXT NOT NULL,
    help_text TEXT,
    answer_type TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    display_order SMALLINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_manufacturer_faq_answer_type CHECK (
        answer_type IN ('boolean','text','number','single_choice','multiple_choice')
    ),
    CONSTRAINT chk_manufacturer_faq_status CHECK (status IN ('active','retired'))
);

CREATE TABLE manufacturer_faq_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    facility_id UUID,
    question_id UUID NOT NULL,
    boolean_value BOOLEAN,
    text_value TEXT,
    numeric_value NUMERIC(18,4),
    option_values JSONB NOT NULL DEFAULT '[]'::jsonb,
    answered_by_membership_id UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_manufacturer_faq_answer_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_manufacturer_faq_answer_facility
        FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE CASCADE,
    CONSTRAINT fk_manufacturer_faq_answer_question
        FOREIGN KEY (question_id) REFERENCES manufacturer_faq_questions(id) ON DELETE RESTRICT,
    CONSTRAINT fk_manufacturer_faq_answer_member
        FOREIGN KEY (answered_by_membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
    CONSTRAINT uq_manufacturer_faq_answer
        UNIQUE NULLS NOT DISTINCT (organization_id, facility_id, question_id)
);

-- ---------------------------------------------------------------------
-- Manufacturer-facing published capacity aggregate.
-- Atomic availability and pricing remain owned by the existing tables.
-- ---------------------------------------------------------------------
CREATE TABLE manufacturer_capacity_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    facility_id UUID,
    capability_id UUID NOT NULL,
    availability_calendar_id UUID NOT NULL,
    availability_window_id UUID NOT NULL,
    price_book_id UUID,
    price_item_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    available_capacity NUMERIC(18,4) NOT NULL,
    unit_code TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    pricing_model TEXT NOT NULL DEFAULT 'per_unit',
    currency CHAR(3),
    standard_price NUMERIC(18,4),
    special_price NUMERIC(18,4),
    minimum_booking_quantity NUMERIC(18,4),
    publication_status TEXT NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    created_by_membership_id UUID,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_capacity_listing_org
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_capacity_listing_facility
        FOREIGN KEY (facility_id) REFERENCES facilities(id) ON DELETE SET NULL,
    CONSTRAINT fk_capacity_listing_capability
        FOREIGN KEY (capability_id) REFERENCES capabilities(id) ON DELETE RESTRICT,
    CONSTRAINT fk_capacity_listing_calendar
        FOREIGN KEY (availability_calendar_id) REFERENCES availability_calendars(id) ON DELETE RESTRICT,
    CONSTRAINT fk_capacity_listing_window
        FOREIGN KEY (availability_window_id) REFERENCES availability_windows(id) ON DELETE RESTRICT,
    CONSTRAINT fk_capacity_listing_price_book
        FOREIGN KEY (price_book_id) REFERENCES price_books(id) ON DELETE SET NULL,
    CONSTRAINT fk_capacity_listing_price_item
        FOREIGN KEY (price_item_id) REFERENCES price_items(id) ON DELETE SET NULL,
    CONSTRAINT fk_capacity_listing_unit
        FOREIGN KEY (unit_code) REFERENCES units(code) ON DELETE RESTRICT,
    CONSTRAINT fk_capacity_listing_creator
        FOREIGN KEY (created_by_membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
    CONSTRAINT chk_capacity_listing_capacity CHECK (available_capacity > 0),
    CONSTRAINT chk_capacity_listing_dates CHECK (end_date >= start_date),
    CONSTRAINT chk_capacity_listing_pricing_model CHECK (
        pricing_model IN ('flat','per_unit','tiered','hourly','daily','negotiable')
    ),
    CONSTRAINT chk_capacity_listing_prices CHECK (
        standard_price IS NULL OR standard_price >= 0
    ),
    CONSTRAINT chk_capacity_listing_special_price CHECK (
        special_price IS NULL OR special_price >= 0
    ),
    CONSTRAINT chk_capacity_listing_minimum CHECK (
        minimum_booking_quantity IS NULL OR minimum_booking_quantity > 0
    ),
    CONSTRAINT chk_capacity_listing_publication CHECK (
        publication_status IN ('draft','published','paused','fully_booked','expired','withdrawn')
    )
);

CREATE UNIQUE INDEX uq_capacity_listing_window
    ON manufacturer_capacity_listings(availability_window_id);
CREATE INDEX ix_capacity_listing_discovery
    ON manufacturer_capacity_listings(publication_status, start_date, end_date);
CREATE INDEX ix_capacity_listing_org
    ON manufacturer_capacity_listings(organization_id, publication_status);

-- ---------------------------------------------------------------------
-- Manufacturer request queue. This is a workflow projection over an
-- engagement; a confirmed commercial agreement is still `bookings`.
-- ---------------------------------------------------------------------
CREATE TABLE manufacturer_booking_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number TEXT NOT NULL UNIQUE,
    engagement_id UUID NOT NULL UNIQUE,
    capacity_listing_id UUID,
    demand_organization_id UUID NOT NULL,
    manufacturer_organization_id UUID NOT NULL,
    requested_by_user_id UUID,
    requested_capacity NUMERIC(18,4),
    unit_code TEXT,
    requested_start_date DATE,
    requested_end_date DATE,
    requirements TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    manufacturer_response TEXT,
    decline_reason TEXT,
    return_reason TEXT,
    responded_by_membership_id UUID,
    responded_at TIMESTAMPTZ,
    confirmed_booking_id UUID,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_mbr_engagement
        FOREIGN KEY (engagement_id) REFERENCES engagements(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mbr_listing
        FOREIGN KEY (capacity_listing_id) REFERENCES manufacturer_capacity_listings(id) ON DELETE SET NULL,
    CONSTRAINT fk_mbr_demand_org
        FOREIGN KEY (demand_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mbr_manufacturer_org
        FOREIGN KEY (manufacturer_organization_id) REFERENCES organizations(id) ON DELETE RESTRICT,
    CONSTRAINT fk_mbr_requester
        FOREIGN KEY (requested_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mbr_unit
        FOREIGN KEY (unit_code) REFERENCES units(code) ON DELETE SET NULL,
    CONSTRAINT fk_mbr_responder
        FOREIGN KEY (responded_by_membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
    CONSTRAINT fk_mbr_booking
        FOREIGN KEY (confirmed_booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
    CONSTRAINT chk_mbr_capacity CHECK (requested_capacity IS NULL OR requested_capacity > 0),
    CONSTRAINT chk_mbr_dates CHECK (
        requested_end_date IS NULL OR requested_start_date IS NULL OR requested_end_date >= requested_start_date
    ),
    CONSTRAINT chk_mbr_status CHECK (
        status IN ('new','accepted','declined','returned','confirmation_pending','confirmed','booked','cancelled')
    )
);

CREATE INDEX ix_mbr_manufacturer_queue
    ON manufacturer_booking_requests(manufacturer_organization_id, status, created_at DESC);
CREATE INDEX ix_mbr_demand_history
    ON manufacturer_booking_requests(demand_organization_id, created_at DESC);

CREATE TABLE manufacturer_booking_request_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_request_id UUID NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_user_id UUID,
    actor_membership_id UUID,
    reason TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_mbr_events_request
        FOREIGN KEY (booking_request_id) REFERENCES manufacturer_booking_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_mbr_events_user
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_mbr_events_membership
        FOREIGN KEY (actor_membership_id) REFERENCES memberships(id) ON DELETE SET NULL,
    CONSTRAINT chk_mbr_events_status CHECK (
        to_status IN ('new','accepted','declined','returned','confirmation_pending','confirmed','booked','cancelled')
    )
);

CREATE INDEX ix_mbr_events_timeline
    ON manufacturer_booking_request_events(booking_request_id, created_at);

-- ---------------------------------------------------------------------
-- Utility triggers.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION xy_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION xy_record_manufacturer_booking_request_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO manufacturer_booking_request_events
            (booking_request_id, from_status, to_status, actor_user_id, reason)
        VALUES (NEW.id, NULL, NEW.status, NEW.requested_by_user_id, 'Request created');
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO manufacturer_booking_request_events
            (booking_request_id, from_status, to_status, actor_user_id,
             actor_membership_id, reason)
        VALUES
            (NEW.id, OLD.status, NEW.status,
             COALESCE((SELECT user_id FROM memberships WHERE id = NEW.responded_by_membership_id),
                      NEW.requested_by_user_id),
             NEW.responded_by_membership_id,
             COALESCE(NEW.decline_reason, NEW.return_reason,
                      NEW.cancellation_reason, NEW.manufacturer_response));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_manufacturer_onboarding_updated_at
    BEFORE UPDATE ON manufacturer_onboarding
    FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
CREATE TRIGGER trg_manufacturer_infrastructure_updated_at
    BEFORE UPDATE ON manufacturer_infrastructure
    FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
CREATE TRIGGER trg_manufacturer_faq_answers_updated_at
    BEFORE UPDATE ON manufacturer_faq_answers
    FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
CREATE TRIGGER trg_manufacturer_capacity_listings_updated_at
    BEFORE UPDATE ON manufacturer_capacity_listings
    FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
CREATE TRIGGER trg_manufacturer_booking_requests_updated_at
    BEFORE UPDATE ON manufacturer_booking_requests
    FOR EACH ROW EXECUTE FUNCTION xy_set_updated_at();
CREATE TRIGGER trg_manufacturer_booking_request_event
    AFTER INSERT OR UPDATE OF status ON manufacturer_booking_requests
    FOR EACH ROW EXECUTE FUNCTION xy_record_manufacturer_booking_request_event();

COMMIT;
