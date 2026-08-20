-- ============================================================
-- Migration: Reservations System
-- Adds business_type, services table, bookings table, and
-- a tightly scoped SECURITY DEFINER RPC for validated
-- anonymous booking creation.
--
-- Security model:
--   - bookings INSERT: only via create_booking RPC (no open policy)
--   - Google OAuth tokens: stored in business_google_tokens (owner-only)
--     NOT in businesses (which has a public SELECT policy)
--   - create_booking RPC: validates active business + reservations mode,
--     verifies service belongs to business, derives name/price/duration
--     from DB (never from caller), enforces pending status, validates
--     person count against service max_persons.
-- ============================================================

-- ==================== BUSINESSES COLUMNS ====================
ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS business_type TEXT NOT NULL DEFAULT 'products';
-- NOTE: google_calendar_refresh_token is NOT stored on businesses (public row).
-- It lives in business_google_tokens (owner-only table below).

-- ==================== SERVICES TABLE ====================
CREATE TABLE IF NOT EXISTS public.services (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  max_persons INTEGER NOT NULL DEFAULT 1,
  image_url TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ==================== BOOKINGS TABLE ====================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.services(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  service_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  customer_name TEXT,
  customer_phone TEXT,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  duration_minutes INTEGER,
  num_persons INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  google_calendar_event_id TEXT,
  whatsapp_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ==================== GOOGLE TOKENS TABLE (owner-only) ====================
-- Keeps sensitive OAuth credentials out of the publicly selectable businesses row.
CREATE TABLE IF NOT EXISTS public.business_google_tokens (
  business_id UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ==================== TRIGGERS ====================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'services_updated_at') THEN
    CREATE TRIGGER services_updated_at
      BEFORE UPDATE ON public.services
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_updated_at') THEN
    CREATE TRIGGER bookings_updated_at
      BEFORE UPDATE ON public.bookings
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END; $$;

-- ==================== RLS ====================
ALTER TABLE public.services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_google_tokens ENABLE ROW LEVEL SECURITY;

-- services: owners full control, public can read available services
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='services' AND policyname='Owners can manage services') THEN
    CREATE POLICY "Owners can manage services"
      ON public.services FOR ALL
      USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = services.business_id AND owner_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.businesses WHERE id = services.business_id AND owner_id = auth.uid()));
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='services' AND policyname='Public can view available services') THEN
    CREATE POLICY "Public can view available services"
      ON public.services FOR SELECT
      USING (
        is_available = true
        AND EXISTS (SELECT 1 FROM public.businesses WHERE id = services.business_id AND is_active = true)
      );
  END IF;
END; $$;

-- bookings: owners can view/update; INSERT only via create_booking RPC (no public INSERT policy)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='Owners can view bookings of their business') THEN
    CREATE POLICY "Owners can view bookings of their business"
      ON public.bookings FOR SELECT
      USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = bookings.business_id AND owner_id = auth.uid()));
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='bookings' AND policyname='Owners can update bookings of their business') THEN
    CREATE POLICY "Owners can update bookings of their business"
      ON public.bookings FOR UPDATE
      USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = bookings.business_id AND owner_id = auth.uid()));
  END IF;
END; $$;

-- business_google_tokens: owner-only
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='business_google_tokens' AND policyname='Owner only google tokens') THEN
    CREATE POLICY "Owner only google tokens"
      ON public.business_google_tokens FOR ALL
      USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = business_id AND owner_id = auth.uid()))
      WITH CHECK (EXISTS (SELECT 1 FROM public.businesses WHERE id = business_id AND owner_id = auth.uid()));
  END IF;
END; $$;

-- ==================== VALIDATED BOOKING RPC ====================
-- SECURITY DEFINER function — runs as owner, bypasses RLS for the INSERT.
--
-- Validation:
--   1. p_booking_date and p_booking_time must be non-null (ISO values enforced by caller)
--   2. Business must exist, be active, and have business_type = 'reservations'
--   3. Service must belong to that business and be available
--      - looked up by p_service_id first; falls back to name match if null
--      - if no match found → EXCEPTION (no zero-price fallback)
--   4. p_num_persons must not exceed service.max_persons
--   5. Service name, price, duration derived from DB — caller-provided values ignored
--   6. status is always forced to 'pending'
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
BEGIN
  -- Require valid temporal fields (must be real ISO values, not descriptive strings)
  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'booking_date and booking_time are required and must be valid ISO date/time values';
  END IF;

  -- Validate business
  SELECT id, is_active, business_type INTO v_business
  FROM public.businesses WHERE id = p_business_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found or inactive';
  END IF;
  IF (v_business.business_type)::text != 'reservations' THEN
    RAISE EXCEPTION 'Business is not in reservations mode';
  END IF;

  -- Validate and resolve service (all fields sourced from DB)
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
    -- Name-based fallback — no empty/zero fallback; must find a real match
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

  -- Validate person count against service maximum
  IF COALESCE(p_num_persons, 1) > v_service.max_persons THEN
    RAISE EXCEPTION 'Requested % persons exceeds the service maximum of %',
      COALESCE(p_num_persons, 1), v_service.max_persons;
  END IF;

  -- Insert booking — status always 'pending'; name/price/duration always from DB
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
    v_service.name,   -- from DB, not caller
    v_service.price,  -- from DB, not caller
    NULLIF(trim(COALESCE(p_customer_name, '')), ''),
    NULLIF(regexp_replace(COALESCE(p_customer_phone, ''), '[^0-9+]', '', 'g'), ''),
    p_booking_date,
    p_booking_time,
    v_service.duration_minutes,  -- from DB
    GREATEST(1, COALESCE(p_num_persons, 1)),
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    'pending'
  );
  RETURN v_booking_id;
END;
$fn$;

-- Grant execute to public callers; INSERT bypasses RLS via SECURITY DEFINER
GRANT EXECUTE ON FUNCTION public.create_booking(UUID, UUID, TEXT, TEXT, TEXT, DATE, TIME, INTEGER, TEXT)
  TO anon, authenticated;

-- ==================== REALTIME ====================
ALTER PUBLICATION supabase_realtime ADD TABLE public.services;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
