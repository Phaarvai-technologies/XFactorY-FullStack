-- Manufacturer magic link (plan agreed with Praveen, 25 Nov 2026).
-- After a call, the XfactorY team enters a manufacturer's details and sends a shareable link
-- that signs the manufacturer in without a password, for 14 days or until the account is set up.
-- Additive and idempotent: safe to run more than once.

-- 1. Invitations -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS manufacturer_invitations (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    company_name          TEXT NOT NULL,                    -- company name when invited (identifier)
    email                 CITEXT NOT NULL,                  -- the person's login email (identifier)
    contact_name          TEXT NOT NULL,
    phone                 TEXT,
    code_hash             TEXT NOT NULL UNIQUE,             -- sha256 of the link code; the code itself is never stored
    clerk_user_id         TEXT,                             -- Clerk account the link signs in to
    status                TEXT NOT NULL DEFAULT 'invited',
    expires_at            TIMESTAMPTZ NOT NULL,
    opened_at             TIMESTAMPTZ,
    open_count            INTEGER NOT NULL DEFAULT 0,
    accepted_at           TIMESTAMPTZ,
    accepted_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at          TIMESTAMPTZ,
    reminders_sent        SMALLINT NOT NULL DEFAULT 0,
    last_reminded_at      TIMESTAMPTZ,
    send_count            SMALLINT NOT NULL DEFAULT 1,
    last_sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_manufacturer_invitations_status
        CHECK (status IN ('invited', 'opened', 'accepted', 'expired', 'cancelled'))
);

-- one open invitation per company + email
CREATE UNIQUE INDEX IF NOT EXISTS uq_manufacturer_invitations_open
    ON manufacturer_invitations (organization_id, email)
    WHERE status IN ('invited', 'opened');
CREATE INDEX IF NOT EXISTS ix_manufacturer_invitations_org ON manufacturer_invitations (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_manufacturer_invitations_open
    ON manufacturer_invitations (expires_at) WHERE status IN ('invited', 'opened');

ALTER TABLE manufacturer_invitations ENABLE ROW LEVEL SECURITY;

-- 2. Where a company's details came from ------------------------------------------------------
-- NULL = as created (the import, an admin entry, or the manufacturer's own forms).
-- entered_by_xfactory       = the XfactorY team entered or changed details for the manufacturer
-- confirmed_by_manufacturer = the manufacturer checked them and pressed "Confirm details"
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS details_source TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS details_source_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS details_source_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS details_reviewed_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS details_reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_org_details_source') THEN
        ALTER TABLE organizations ADD CONSTRAINT chk_org_details_source
            CHECK (details_source IS NULL OR details_source IN ('entered_by_xfactory', 'confirmed_by_manufacturer'));
    END IF;
END $$;

-- Accounts set up through the link keep users.registration_channel = 'admin_portal' (created by the
-- XfactorY team) and registration_method = 'magic_link'; link actions are recorded in
-- manufacturer_submission_events as event 'note' with details.action (invitation_sent, …), so no
-- existing check constraint is widened (migrations 021-024 re-create those checks on every run).

-- 3. Contact person entered on the admin "Add manufacturer" page (who the team spoke to; the
--    invitation goes to them). The company's contact email / phone stay in contact_email / contact_phone.
ALTER TABLE organization_profiles ADD COLUMN IF NOT EXISTS contact_person_name TEXT;
