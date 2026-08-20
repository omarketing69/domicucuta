-- Centro de Producción Inteligente

-- orders: tracking, pausa, tiempo acumulado de pausa
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tracking_code TEXT DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pause_reason TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tracking_code
  ON public.orders(tracking_code)
  WHERE tracking_code IS NOT NULL;

-- businesses: tiempos de producción configurables por etapa
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS production_times JSONB NOT NULL
  DEFAULT '{"reception":2,"preparation":18,"packaging":5,"handoff":3,"delivery":20}'::jsonb;

-- Política pública: cualquier usuario puede leer un pedido por tracking_code
-- (el código es un hash aleatorio imposible de adivinar)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'orders' AND policyname = 'public_read_by_tracking_code'
  ) THEN
    CREATE POLICY public_read_by_tracking_code ON public.orders
      FOR SELECT USING (tracking_code IS NOT NULL);
  END IF;
END $$;
