CREATE TABLE IF NOT EXISTS public.plan_pricing (
  id text PRIMARY KEY,
  label text NOT NULL,
  price_monthly numeric NOT NULL DEFAULT 0,
  max_products integer,
  max_orders_monthly integer,
  is_active boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_pricing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plan pricing"
  ON public.plan_pricing FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify plan pricing"
  ON public.plan_pricing FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.plan_pricing (id, label, price_monthly, description) VALUES
  ('free',    'Gratis',   0,  'Prueba gratuita 30 días'),
  ('starter', 'Starter', 10, 'Hasta 50 productos y 200 pedidos/mes'),
  ('pro',     'Pro',     30, 'Productos ilimitados, pedidos ilimitados')
ON CONFLICT (id) DO NOTHING;