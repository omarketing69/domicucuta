-- Add subscription plan columns to businesses
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS plan_started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '30 days');

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_plan_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_plan_check CHECK (plan IN ('free', 'starter', 'pro'));