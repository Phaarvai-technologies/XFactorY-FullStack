-- Step-by-step saving for the Manufacturer portal's multi-step forms.
-- One row per form instance: the Company Profile wizard (record = the
-- organization) and each Machinery wizard draft (record = the machine).
-- Additive and safe to run repeatedly.

CREATE TABLE IF NOT EXISTS manufacturer_form_progress (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  form_key         TEXT NOT NULL CHECK (form_key IN ('company_profile', 'machinery')),
  record_id        UUID NOT NULL,                       -- organization id / machine id
  client_key       UUID,                                -- idempotency key of the first save
  current_step     SMALLINT NOT NULL DEFAULT 1 CHECK (current_step >= 1),
  completed_steps  SMALLINT[] NOT NULL DEFAULT '{}',
  total_steps      SMALLINT NOT NULL CHECK (total_steps >= 1),
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one progress record per form instance -> no duplicates
  CONSTRAINT uq_form_progress_record UNIQUE (organization_id, form_key, record_id),
  -- a repeated "first step" submission can't create a second draft
  CONSTRAINT uq_form_progress_client_key UNIQUE (organization_id, client_key)
);

CREATE INDEX IF NOT EXISTS ix_form_progress_open
  ON manufacturer_form_progress (organization_id, form_key, updated_at DESC)
  WHERE status = 'draft';

ALTER TABLE manufacturer_form_progress ENABLE ROW LEVEL SECURITY;
