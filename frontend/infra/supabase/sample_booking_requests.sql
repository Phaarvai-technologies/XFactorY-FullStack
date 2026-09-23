-- Optional demo data: the four sample bookings the frontend used to hardcode
-- (INITIAL_BOOKINGS), stored as real rows in manufacturer_booking_requests.
--
-- 1. Run this file once (Supabase SQL editor) to create the function.
-- 2. For a manufacturer who has completed the details form:
--        SELECT xy_seed_sample_bookings('manufacturer@example.com');
--    Returns how many bookings were added. Running it again adds nothing.

CREATE OR REPLACE FUNCTION xy_seed_sample_bookings(p_email TEXT)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  v_user UUID;
  v_org UUID;
  v_buyer UUID;
  v_engagement UUID;
  v_added INTEGER := 0;
  r RECORD;
BEGIN
  SELECT id INTO v_user FROM users WHERE email = p_email::citext;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No user with email %', p_email;
  END IF;

  SELECT o.id INTO v_org
  FROM memberships m JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = v_user AND m.status = 'active' AND o.organization_type = 'manufacturer'
  ORDER BY (o.created_by_user_id = v_user) DESC, m.created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'User % has no manufacturer organization yet (fill the Manufacturer details form first)', p_email;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      (1, 'Orion Textiles',    'CNC Machining — batch run',    DATE '2026-09-20', 'new'),
      (2, 'BluePeak Foods',    'Cold storage — 2 weeks',       DATE '2026-09-25', 'accepted'),
      (3, 'Vertex Auto Parts', 'Injection molding line',       DATE '2026-10-02', 'confirmed'),
      (4, 'Nimbus Packaging',  'Warehouse space — 500 sq ft',  DATE '2026-09-18', 'cancelled')
    ) AS t(ord, buyer, item, start_date, status)
  LOOP
    SELECT id INTO v_buyer FROM organizations
    WHERE display_name = r.buyer AND organization_type = 'buyer' LIMIT 1;
    IF v_buyer IS NULL THEN
      INSERT INTO organizations (display_name, organization_type, status)
      VALUES (r.buyer, 'buyer', 'active') RETURNING id INTO v_buyer;
    END IF;

    CONTINUE WHEN EXISTS (
      SELECT 1 FROM manufacturer_booking_requests
      WHERE manufacturer_organization_id = v_org AND demand_organization_id = v_buyer
        AND requirements = r.item
    );

    INSERT INTO engagements (demand_organization_id, supply_organization_id, request_type)
    VALUES (v_buyer, v_org, 'availability_request') RETURNING id INTO v_engagement;

    INSERT INTO manufacturer_booking_requests
      (request_number, engagement_id, demand_organization_id, manufacturer_organization_id,
       requested_start_date, requirements, status, cancelled_at, created_at)
    VALUES
      ('DEMO-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), v_engagement,
       v_buyer, v_org, r.start_date, r.item, r.status,
       CASE WHEN r.status = 'cancelled' THEN now() END,
       now() - make_interval(secs => r.ord));  -- keeps the original list order
    v_added := v_added + 1;
  END LOOP;
  RETURN v_added;
END;
$$;
