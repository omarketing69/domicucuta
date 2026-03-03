
-- Businesses table (one per owner/user)
CREATE TABLE public.businesses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  whatsapp_number TEXT NOT NULL,
  address TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Categories table
CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Products table
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL,
  image_url TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_name TEXT,
  customer_phone TEXT,
  notes TEXT,
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'ready', 'completed', 'cancelled')),
  whatsapp_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Order items table
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal NUMERIC(10,2) NOT NULL
);

-- Enable RLS on all tables
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- BUSINESSES policies
CREATE POLICY "Owners can manage their businesses"
ON public.businesses FOR ALL
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Public can view active businesses by slug"
ON public.businesses FOR SELECT
USING (is_active = true);

-- CATEGORIES policies
CREATE POLICY "Owners can manage categories of their business"
ON public.categories FOR ALL
USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = categories.business_id AND owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.businesses WHERE id = categories.business_id AND owner_id = auth.uid()));

CREATE POLICY "Public can view categories of active businesses"
ON public.categories FOR SELECT
USING (is_active = true AND EXISTS (SELECT 1 FROM public.businesses WHERE id = categories.business_id AND is_active = true));

-- PRODUCTS policies
CREATE POLICY "Owners can manage products of their business"
ON public.products FOR ALL
USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = products.business_id AND owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.businesses WHERE id = products.business_id AND owner_id = auth.uid()));

CREATE POLICY "Public can view available products"
ON public.products FOR SELECT
USING (is_available = true AND EXISTS (SELECT 1 FROM public.businesses WHERE id = products.business_id AND is_active = true));

-- ORDERS policies
CREATE POLICY "Owners can view orders of their business"
ON public.orders FOR SELECT
USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = orders.business_id AND owner_id = auth.uid()));

CREATE POLICY "Owners can update orders of their business"
ON public.orders FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.businesses WHERE id = orders.business_id AND owner_id = auth.uid()));

CREATE POLICY "Anyone can insert orders"
ON public.orders FOR INSERT
WITH CHECK (true);

-- ORDER ITEMS policies
CREATE POLICY "Owners can view order items of their business"
ON public.order_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.orders o
  JOIN public.businesses b ON b.id = o.business_id
  WHERE o.id = order_items.order_id AND b.owner_id = auth.uid()
));

CREATE POLICY "Anyone can insert order items"
ON public.order_items FOR INSERT
WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
