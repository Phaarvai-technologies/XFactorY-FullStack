-- Additive support for UI fields not represented by the canonical schema.
-- Run after XY_Database_Schema(5).sql and its seed file.

ALTER TABLE facilities
  ADD COLUMN IF NOT EXISTS sez_status TEXT,
  ADD COLUMN IF NOT EXISTS serviceable_areas TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS manufacturer_availability_preferences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  calendar JSONB NOT NULL DEFAULT '{}',
  recurring JSONB,
  capacity JSONB,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION xy_set_manufacturer_api_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_manufacturer_availability_preferences_updated_at
  ON manufacturer_availability_preferences;
CREATE TRIGGER trg_manufacturer_availability_preferences_updated_at
  BEFORE UPDATE ON manufacturer_availability_preferences
  FOR EACH ROW EXECUTE FUNCTION xy_set_manufacturer_api_updated_at();

ALTER TABLE manufacturer_availability_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE organization_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_infrastructure ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_faq_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturer_booking_requests ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('manufacturer-assets','manufacturer-assets',true,10485760,
        ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=true,file_size_limit=10485760,
  allowed_mime_types=EXCLUDED.allowed_mime_types;
