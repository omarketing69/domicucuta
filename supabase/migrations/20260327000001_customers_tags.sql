-- Add tags array column to customers table
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}' NOT NULL;

-- Index for tag filtering
CREATE INDEX IF NOT EXISTS idx_customers_tags ON public.customers USING gin(tags);
