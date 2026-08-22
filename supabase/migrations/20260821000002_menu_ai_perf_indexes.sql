-- Missing indexes on FK columns hit by the menu-agent/ai-agent hot paths on
-- every chat turn: products/categories filtered by business_id, and orders
-- looked up by customer_phone for the WhatsApp customer-memory context
-- (ai-agent's `.or('customer_phone.eq.X,customer_phone.eq.Y')` query).
-- Postgres does not auto-index foreign key columns.

CREATE INDEX IF NOT EXISTS idx_products_business_id ON public.products(business_id);
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON public.categories(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON public.orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
