-- Add extended fields to plan_pricing for rich pricing page content
ALTER TABLE public.plan_pricing
  ADD COLUMN IF NOT EXISTS features TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS badge_text TEXT,
  ADD COLUMN IF NOT EXISTS period_text TEXT DEFAULT 'mes',
  ADD COLUMN IF NOT EXISTS cta_text TEXT,
  ADD COLUMN IF NOT EXISTS highlight BOOLEAN DEFAULT false;

-- Seed default values for existing plans (only if features not yet set)
UPDATE public.plan_pricing SET
  features = ARRAY['Menú público con tu link único','Hasta 20 productos','Hasta 3 categorías','Pedidos por WhatsApp','Panel de administración','Válido 30 días'],
  period_text = '30 días',
  cta_text = 'Empezar gratis',
  highlight = false
WHERE id = 'free' AND (features IS NULL OR features = '{}');

UPDATE public.plan_pricing SET
  features = ARRAY['Todo lo del plan Gratis','Productos ilimitados','Categorías ilimitadas','Pedidos en tiempo real','Historial de pedidos completo','Soporte prioritario'],
  badge_text = 'Más popular',
  period_text = 'mes',
  cta_text = 'Elegir Starter',
  highlight = true
WHERE id = 'starter' AND (features IS NULL OR features = '{}');

UPDATE public.plan_pricing SET
  features = ARRAY['Todo lo del plan Starter','Múltiples sucursales','Imágenes en productos y categorías','Logo del negocio personalizado','Análisis de ventas avanzado','Onboarding dedicado'],
  period_text = 'mes',
  cta_text = 'Elegir Pro',
  highlight = false
WHERE id = 'pro' AND (features IS NULL OR features = '{}');
