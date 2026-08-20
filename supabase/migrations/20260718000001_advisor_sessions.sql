-- Director de Ventas IA — session memory per business
CREATE TABLE IF NOT EXISTS advisor_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title            TEXT,
  messages         JSONB NOT NULL DEFAULT '[]',
  context_snapshot JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE advisor_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advisor_sessions_owner" ON advisor_sessions
  FOR ALL USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_advisor_sessions_business
  ON advisor_sessions(business_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_advisor_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_advisor_sessions_updated_at
  BEFORE UPDATE ON advisor_sessions
  FOR EACH ROW EXECUTE FUNCTION update_advisor_sessions_updated_at();
