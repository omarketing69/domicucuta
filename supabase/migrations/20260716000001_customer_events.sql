-- Fase 6 — Memoria Universal del Cliente
-- customer_events: registro unificado de comunicaciones cross-channel por cliente

CREATE TABLE IF NOT EXISTS public.customer_events (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID        NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_phone TEXT       NOT NULL,
  channel       TEXT        NOT NULL DEFAULT 'whatsapp',   -- whatsapp | twilio_sms | twilio_voice | email | manual
  direction     TEXT        NOT NULL DEFAULT 'outbound',   -- outbound | inbound
  summary       TEXT        NOT NULL,                      -- mensaje o descripción del evento
  metadata      JSONB       NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_events_biz_phone
  ON public.customer_events (business_id, customer_phone, created_at DESC);

ALTER TABLE public.customer_events ENABLE ROW LEVEL SECURITY;

-- El dueño del negocio puede leer e insertar eventos de sus propios clientes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'customer_events'
      AND policyname = 'owner_can_manage_customer_events'
  ) THEN
    CREATE POLICY owner_can_manage_customer_events
      ON public.customer_events
      FOR ALL
      USING (
        EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b.id = customer_events.business_id
            AND b.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.businesses b
          WHERE b.id = customer_events.business_id
            AND b.owner_id = auth.uid()
        )
      );
  END IF;
END $$;
