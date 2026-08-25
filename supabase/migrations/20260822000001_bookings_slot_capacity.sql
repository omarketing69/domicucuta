-- ============================================================
-- Migration: Booking slot capacity + drop unused Google Calendar scaffolding
--
-- 1. create_booking previously had no protection against two customers
--    booking the same service/date/time — it only checked the new
--    booking's own num_persons against the service's max_persons, never
--    against bookings that already exist for that exact slot. This
--    replaces the function to add a per-slot capacity check, guarded by
--    a transactional advisory lock so two concurrent requests for the
--    same slot can't both pass the check before either commits.
-- 2. Drops the Google Calendar OAuth scaffolding (bookings.
--    google_calendar_event_id, business_google_tokens) added in
--    20260731000001_reservations_system.sql — never populated by any
--    function; the product now uses a read-only iCal feed instead of
--    per-tenant Google OAuth (see business-calendar-ics edge function).
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_booking(
  p_business_id   UUID,
  p_service_id    UUID,
  p_service_name  TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_booking_date  DATE,
  p_booking_time  TIME,
  p_num_persons   INTEGER,
  p_notes         TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_booking_id UUID;
  v_service    RECORD;
  v_business   RECORD;
  v_persons    INTEGER;
  v_existing_persons INTEGER;
BEGIN
  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'booking_date and booking_time are required and must be valid ISO date/time values';
  END IF;

  SELECT id, is_active, business_type INTO v_business
  FROM public.businesses WHERE id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found or inactive';
  END IF;
  IF (v_business.business_type)::text != 'reservations' THEN
    RAISE EXCEPTION 'Business is not in reservations mode';
  END IF;

  IF p_service_id IS NOT NULL THEN
    SELECT id, name, price, duration_minutes, max_persons, is_available INTO v_service
    FROM public.services WHERE id = p_service_id AND business_id = p_business_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Service ID not found for this business';
    END IF;
    IF NOT v_service.is_available THEN
      RAISE EXCEPTION 'Service is not currently available';
    END IF;
  ELSE
    SELECT id, name, price, duration_minutes, max_persons INTO v_service
    FROM public.services
    WHERE business_id = p_business_id
      AND name ILIKE p_service_name
      AND is_available = true
    ORDER BY position LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No available service matching "%" found for this business', p_service_name;
    END IF;
  END IF;

  v_persons := GREATEST(1, COALESCE(p_num_persons, 1));

  IF v_persons > v_service.max_persons THEN
    RAISE EXCEPTION 'Requested % persons exceeds the service maximum of %',
      v_persons, v_service.max_persons;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_business_id::text || ':' || v_service.id::text || ':' ||
                      p_booking_date::text || ':' || p_booking_time::text, 0)
  );

  SELECT COALESCE(SUM(num_persons), 0) INTO v_existing_persons
  FROM public.bookings
  WHERE business_id = p_business_id
    AND service_id = v_service.id
    AND booking_date = p_booking_date
    AND booking_time = p_booking_time
    AND status IN ('pending', 'confirmed');

  IF v_existing_persons + v_persons > v_service.max_persons THEN
    RAISE EXCEPTION 'SLOT_FULL: Ese horario ya está reservado para "%", elige otro horario', v_service.name;
  END IF;

  v_booking_id := gen_random_uuid();
  INSERT INTO public.bookings (
    id, business_id, service_id, service_name, service_price,
    customer_name, customer_phone,
    booking_date, booking_time, duration_minutes,
    num_persons, notes, status
  ) VALUES (
    v_booking_id,
    p_business_id,
    v_service.id,
    v_service.name,
    v_service.price,
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9+]', '', 'g'), ''),
    p_booking_date,
    p_booking_time,
    v_service.duration_minutes,
    v_persons,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending'
  );
  RETURN v_booking_id;
END;
$fn$;

ALTER TABLE public.bookings DROP COLUMN IF EXISTS google_calendar_event_id;
DROP TABLE IF EXISTS public.business_google_tokens;
