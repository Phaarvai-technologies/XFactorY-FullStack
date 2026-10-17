-- 024_enable_row_level_security.sql
-- Turns on Row Level Security for every table in the public schema that does not have it yet.
--
-- Why: on Supabase, tables in "public" are reachable through the Data API (PostgREST) with the
-- project's anon / authenticated keys. With RLS on and no policies, those keys can read or
-- change nothing. The X!Y backend connects as the table owner (postgres), which is not subject
-- to RLS, so the application keeps working exactly as before.
--
-- Changes no data, columns or policies. Safe to run again (tables that already have RLS are
-- skipped). Only tables owned by the role running it are changed (e.g. PostGIS's
-- spatial_ref_sys, owned by another role, is left alone).
-- Run on the dev database first, then production.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind IN ('r', 'p')
      AND NOT c.relrowsecurity
      AND c.relname <> 'spatial_ref_sys'
      AND pg_get_userbyid(c.relowner) = current_user
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS enabled on %', r.relname;
  END LOOP;
END $$;

-- Check afterwards (should list nothing except spatial_ref_sys):
-- SELECT relname FROM pg_class
-- WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND NOT relrowsecurity;
