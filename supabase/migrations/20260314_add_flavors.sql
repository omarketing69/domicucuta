-- Tabla de sabores por negocio
CREATE TABLE public.flavors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabla de relación producto <-> sabores disponibles
CREATE TABLE public.product_flavors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  flavor_id UUID NOT NULL REFERENCES public.flavors(id) ON DELETE CASCADE,
  UNIQUE(product_id, flavor_id)
);

-- RLS flavors
ALTER TABLE public.flavors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view active flavors"
  ON public.flavors FOR SELECT
  USING (is_active = true AND EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = flavors.business_id AND businesses.is_active = true
  ));

CREATE POLICY "Owners can manage flavors"
  ON public.flavors FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = flavors.business_id AND businesses.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = flavors.business_id AND businesses.owner_id = auth.uid()
  ));

-- RLS product_flavors
ALTER TABLE public.product_flavors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view product flavors"
  ON public.product_flavors FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_flavors.product_id AND b.is_active = true
  ));

CREATE POLICY "Owners can manage product flavors"
  ON public.product_flavors FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_flavors.product_id AND b.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products p
    JOIN public.businesses b ON b.id = p.business_id
    WHERE p.id = product_flavors.product_id AND b.owner_id = auth.uid()
  ));
