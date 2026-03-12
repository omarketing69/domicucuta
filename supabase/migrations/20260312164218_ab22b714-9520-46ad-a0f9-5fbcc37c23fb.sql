
-- Tabla de toppings por negocio
CREATE TABLE public.toppings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabla de relación producto <-> toppings disponibles
CREATE TABLE public.product_toppings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  topping_id UUID NOT NULL REFERENCES public.toppings(id) ON DELETE CASCADE,
  UNIQUE(product_id, topping_id)
);

-- RLS toppings
ALTER TABLE public.toppings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active toppings"
  ON public.toppings FOR SELECT
  USING (is_active = true AND EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.is_active = true
  ));

CREATE POLICY "Owners can manage toppings"
  ON public.toppings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.owner_id = auth.uid()
  ));

-- RLS product_toppings
ALTER TABLE public.product_toppings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view product toppings"
  ON public.product_toppings FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_toppings.product_id AND b.is_active = true
  ));

CREATE POLICY "Owners can manage product toppings"
  ON public.product_toppings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_toppings.product_id AND b.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_toppings.product_id AND b.owner_id = auth.uid()
  ));
