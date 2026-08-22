-- Fix: public_read_by_tracking_code (20260716000002_production_center.sql) allowed
-- reading EVERY row in public.orders — the USING clause only checked that
-- tracking_code IS NOT NULL, which is true for virtually all orders (the column
-- has a DEFAULT that auto-generates a code), not that the caller supplied the
-- correct code. Any client holding the public anon key could read every
-- business's full order history (customer name, phone, address, items, totals)
-- with no code and no auth.
--
-- RLS row policies can't validate "the caller knows secret X" — they only see
-- the row, not the value used to filter for it. Enforcing a lookup-by-secret
-- pattern requires a SECURITY DEFINER function that takes the code as a bound
-- parameter, so it only ever returns the single row that code corresponds to.

DROP POLICY IF EXISTS public_read_by_tracking_code ON public.orders;

CREATE OR REPLACE FUNCTION public.get_order_by_tracking_code(p_tracking_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT to_jsonb(o) || jsonb_build_object(
    'order_items', COALESCE(
      (SELECT jsonb_agg(to_jsonb(oi)) FROM public.order_items oi WHERE oi.order_id = o.id),
      '[]'::jsonb
    ),
    'businesses', (
      SELECT to_jsonb(b) FROM (
        SELECT name, logo_url, primary_color, production_times
        FROM public.businesses
        WHERE id = o.business_id
      ) b
    )
  )
  INTO result
  FROM public.orders o
  WHERE o.tracking_code = upper(p_tracking_code)
  LIMIT 1;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_order_by_tracking_code(TEXT) TO anon, authenticated;
