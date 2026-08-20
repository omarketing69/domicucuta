-- Add flow_node_name snapshot column to wa_messages for AI log attribution
ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS flow_node_name text;
