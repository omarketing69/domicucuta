-- ============================================================
-- pg_cron scheduling for DomiCircusPop WhatsApp CRM automation
-- ============================================================
-- Creates scheduled jobs for:
--   1. followup-scheduler evaluate (no_reply rules)    — every hour
--   2. bulk-send process_scheduled (queued campaigns) — every 15 min
--
-- PREREQUISITES (one-time, via Supabase Dashboard → Database → Extensions):
--   Enable: pg_cron, pg_net
--
-- After applying this migration, activate the jobs by setting the
-- service-role key in _scheduler_config:
--   UPDATE public._scheduler_config SET svc_key = '<YOUR_SERVICE_ROLE_KEY>';
-- ============================================================

-- Enable required extensions (no-op if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Config table: stores the service-role key for pg_cron HTTP calls ──────────
-- RLS is enabled; only service_role can read/write this table.
-- Anon + authenticated roles have no access.
CREATE TABLE IF NOT EXISTS public._scheduler_config (
  id      int  PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
  svc_key text                                        -- Supabase service_role JWT
);
ALTER TABLE public._scheduler_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "_scheduler_config_service" ON public._scheduler_config;
CREATE POLICY "_scheduler_config_service"
  ON public._scheduler_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Insert singleton row (no-op if already present)
INSERT INTO public._scheduler_config(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ── Remove existing jobs before re-creating (idempotent) ──────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'followup-scheduler-evaluate') THEN
    PERFORM cron.unschedule('followup-scheduler-evaluate');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bulk-send-process-scheduled') THEN
    PERFORM cron.unschedule('bulk-send-process-scheduled');
  END IF;
END $$;

-- ── Job 1: Evaluate no_reply rules + send pending follow-up instances ──────────
-- Runs every hour at minute :00.
-- Calls POST /followup-scheduler with action=evaluate using service-role auth.
SELECT cron.schedule(
  'followup-scheduler-evaluate',
  '0 * * * *',
  $job$
  DO $DO$
  DECLARE
    _key text;
    _url text := 'https://khhxcruhhhzuuykfeivd.supabase.co/functions/v1/followup-scheduler';
  BEGIN
    SELECT svc_key INTO _key FROM public._scheduler_config WHERE id = 1;
    IF _key IS NOT NULL AND _key <> '' THEN
      PERFORM net.http_post(
        url         := _url,
        headers     := ('{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}')::jsonb,
        body        := '{"action":"evaluate"}'::jsonb,
        timeout_milliseconds := 30000
      );
    END IF;
  END $DO$;
  $job$
);

-- ── Job 2: Process scheduled broadcast campaigns ───────────────────────────────
-- Runs every 15 minutes.
-- Calls POST /bulk-send?action=process_scheduled using service-role auth.
SELECT cron.schedule(
  'bulk-send-process-scheduled',
  '*/15 * * * *',
  $job$
  DO $DO$
  DECLARE
    _key text;
    _url text := 'https://khhxcruhhhzuuykfeivd.supabase.co/functions/v1/bulk-send?action=process_scheduled';
  BEGIN
    SELECT svc_key INTO _key FROM public._scheduler_config WHERE id = 1;
    IF _key IS NOT NULL AND _key <> '' THEN
      PERFORM net.http_post(
        url         := _url,
        headers     := ('{"Content-Type":"application/json","Authorization":"Bearer ' || _key || '"}')::jsonb,
        body        := '{}'::jsonb,
        timeout_milliseconds := 120000
      );
    END IF;
  END $DO$;
  $job$
);
