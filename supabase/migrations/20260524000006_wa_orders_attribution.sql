-- ============================================================
-- WhatsApp → Order attribution
-- ============================================================
-- Adds wa_attributed boolean to orders table.
-- A trigger auto-sets it true on INSERT when the customer had
-- an active WA conversation in the previous 24h for this business.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wa_attributed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_orders_wa_attributed
  ON public.orders(business_id, wa_attributed, created_at DESC);

-- Auto-attribute function
CREATE OR REPLACE FUNCTION public.auto_wa_attribute_order()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_phone IS NOT NULL THEN
    NEW.wa_attributed := EXISTS (
      SELECT 1
      FROM public.wa_conversations wc
      JOIN public.wa_contacts ct ON ct.id = wc.contact_id
      WHERE wc.business_id = NEW.business_id
        AND ct.phone       = NEW.customer_phone
        AND wc.last_message_at >= NOW() - INTERVAL '24 hours'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_wa_attribute_order ON public.orders;
CREATE TRIGGER trg_auto_wa_attribute_order
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_wa_attribute_order();
