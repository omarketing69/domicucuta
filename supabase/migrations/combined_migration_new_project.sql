-- ============================================================
-- COMBINED MIGRATION FOR NEW SUPABASE PROJECT: khhxcruhhhzuuykfeivd
-- Run this ENTIRE script in the SQL Editor at:
-- https://supabase.com/dashboard/project/khhxcruhhhzuuykfeivd/sql
-- ============================================================

-- ==================== TABLES ====================

-- Businesses table
CREATE TABLE IF NOT EXISTS public.businesses (
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
  plan TEXT NOT NULL DEFAULT 'free',
  plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  plan_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '30 days'),
  primary_color TEXT DEFAULT '#f97316',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT businesses_plan_check CHECK (plan IN ('free', 'starter', 'pro'))
);

-- Categories table
CREATE TABLE IF NOT EXISTS public.categories (
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
CREATE TABLE IF NOT EXISTS public.products (
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

-- Toppings table
CREATE TABLE IF NOT EXISTS public.toppings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Product-Toppings relation
CREATE TABLE IF NOT EXISTS public.product_toppings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  topping_id UUID NOT NULL REFERENCES public.toppings(id) ON DELETE CASCADE,
  UNIQUE(product_id, topping_id)
);

-- Orders table
CREATE TABLE IF NOT EXISTS public.orders (
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
CREATE TABLE IF NOT EXISTS public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  subtotal NUMERIC(10,2) NOT NULL
);

-- ==================== ROLES ====================

CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- ==================== PLAN PRICING ====================

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

INSERT INTO public.plan_pricing (id, label, price_monthly, description) VALUES
  ('free',    'Gratis',   0,  'Prueba gratuita 30 días'),
  ('starter', 'Starter', 10, 'Hasta 50 productos y 200 pedidos/mes'),
  ('pro',     'Pro',     30, 'Productos ilimitados, pedidos ilimitados')
ON CONFLICT (id) DO NOTHING;

-- ==================== FUNCTIONS ====================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.assign_default_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

-- ==================== TRIGGERS ====================

CREATE TRIGGER businesses_updated_at BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.assign_default_role();

-- ==================== RLS ====================

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toppings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_toppings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_pricing ENABLE ROW LEVEL SECURITY;

-- BUSINESSES policies
CREATE POLICY "Owners can manage their businesses"
  ON public.businesses FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Public can view active businesses by slug"
  ON public.businesses FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can view all businesses"
  ON public.businesses FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update all businesses"
  ON public.businesses FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

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

-- TOPPINGS policies
CREATE POLICY "Public can view active toppings"
  ON public.toppings FOR SELECT
  USING (is_active = true AND EXISTS (
    SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.is_active = true
  ));

CREATE POLICY "Owners can manage toppings"
  ON public.toppings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.businesses WHERE businesses.id = toppings.business_id AND businesses.owner_id = auth.uid()));

-- PRODUCT_TOPPINGS policies
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

-- USER_ROLES policies
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

-- PLAN_PRICING policies
CREATE POLICY "Anyone can read plan pricing"
  ON public.plan_pricing FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify plan pricing"
  ON public.plan_pricing FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ==================== STORAGE BUCKETS ====================

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('images', 'images', true)
ON CONFLICT (id) DO NOTHING;

-- LOGOS storage policies
CREATE POLICY "Public can view logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

CREATE POLICY "Owners can upload their logos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can update their logos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Owners can delete their logos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- IMAGES storage policies
CREATE POLICY "Images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'images');

CREATE POLICY "Authenticated users can upload images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'images' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'images' AND auth.role() = 'authenticated');

-- ==================== POST-MIGRATION: ADMIN BOOTSTRAP ====================
-- After running this migration, create the admin user via the Auth Admin API:
--
--   POST /auth/v1/admin/users
--   { "email": "o_rivera@hotmail.com", "password": "...", "email_confirm": true }
--
-- Then assign the admin role (replace NEW_USER_UUID with the created user's ID):
--
--   INSERT INTO public.user_roles (user_id, role)
--   VALUES ('NEW_USER_UUID', 'admin')
--   ON CONFLICT DO NOTHING;
--
-- The on_auth_user_created trigger automatically assigns the 'user' role.
-- =========================================================================
