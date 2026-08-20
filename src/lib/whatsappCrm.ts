import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// ── Types ─────────────────────────────────────────────────────────────────────

export type WaChannel = 'whatsapp' | 'instagram' | 'messenger';
export type WaContactStatus = 'new' | 'contacted' | 'interested' | 'customer' | 'recurring';
export type WaConversationStatus = 'open' | 'pending' | 'resolved';
export type WaMessageDirection = 'inbound' | 'outbound';
export type WaMessageType =
  | 'text' | 'image' | 'audio' | 'video' | 'document'
  | 'location' | 'sticker' | 'reaction' | 'unknown';
export type WaMessageStatus = 'sent' | 'delivered' | 'read' | 'failed';
export type WaIntent = 'order' | 'inquiry' | 'complaint' | 'follow_up' | 'other';

export interface WaContact {
  id: string;
  business_id: string;
  phone: string | null;
  external_id: string | null;
  name: string | null;
  channel: WaChannel;
  status: WaContactStatus;
  tags: string[];
  score: number;
  notes: string | null;
  last_interaction_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WaConversation {
  id: string;
  business_id: string;
  contact_id: string;
  channel: WaChannel;
  status: WaConversationStatus;
  unread_count: number;
  last_message_at: string | null;
  needs_human: boolean;
  flow_node_id: string | null;
  created_at: string;
  updated_at: string;
  contact?: WaContact;
}

export interface WaMessage {
  id: string;
  business_id: string;
  conversation_id: string;
  contact_id: string;
  wa_message_id: string | null;
  channel: WaChannel;
  direction: WaMessageDirection;
  type: WaMessageType;
  content: string | null;
  media_url: string | null;
  intent: WaIntent | null;
  sent_by_ai: boolean;
  status: WaMessageStatus;
  wa_timestamp: string | null;
  created_at: string;
}

// ── Channel display helpers ───────────────────────────────────────────────────

export const CHANNEL_LABELS: Record<WaChannel, string> = {
  whatsapp:  'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
};

export const CHANNEL_COLORS: Record<WaChannel, string> = {
  whatsapp:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  messenger: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};

// ── Contacts ──────────────────────────────────────────────────────────────────

export async function listContacts(businessId: string, opts?: {
  status?: WaContactStatus;
  channel?: WaChannel;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  let q = supabase
    .from('wa_contacts')
    .select('*', { count: 'exact' })
    .eq('business_id', businessId)
    .order('last_interaction_at', { ascending: false });

  if (opts?.status)  q = q.eq('status', opts.status);
  if (opts?.channel) q = q.eq('channel', opts.channel);
  if (opts?.search)  q = q.or(`name.ilike.%${opts.search}%,phone.ilike.%${opts.search}%`);
  if (opts?.limit)   q = q.limit(opts.limit);
  if (opts?.offset)  q = q.range(opts.offset, (opts.offset ?? 0) + (opts.limit ?? 20) - 1);

  return q;
}

export async function updateContact(id: string, patch: Partial<WaContact>) {
  return supabase.from('wa_contacts').update(patch).eq('id', id).select().single();
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function listConversations(businessId: string, opts?: {
  status?: WaConversationStatus;
  channel?: WaChannel;
  limit?: number;
}) {
  let q = supabase
    .from('wa_conversations')
    .select(`*, contact:wa_contacts(*)`)
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false });

  if (opts?.status)  q = q.eq('status', opts.status);
  if (opts?.channel) q = q.eq('channel', opts.channel);
  if (opts?.limit)   q = q.limit(opts.limit);

  return q;
}

export async function updateConversationStatus(id: string, status: WaConversationStatus) {
  return supabase.from('wa_conversations').update({ status }).eq('id', id);
}

export async function markConversationRead(id: string) {
  return supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', id);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function listMessages(conversationId: string, limit = 50) {
  return supabase
    .from('wa_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
}

// ── Send message (WhatsApp legacy — kept for backward compat) ─────────────────

export async function sendWhatsAppMessage(
  to: string,
  message: string,
  businessId: string,
): Promise<{ success: boolean; wa_message_id?: string; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ to, message, business_id: businessId }),
  });

  const data = await res.json() as { success?: boolean; wa_message_id?: string; error?: string };
  if (!res.ok) return { success: false, error: data.error ?? 'Unknown error' };
  return { success: true, wa_message_id: data.wa_message_id };
}

// ── Send message (unified — all channels) ─────────────────────────────────────

export async function sendMetaMessage(opts: {
  channel: WaChannel;
  recipientId: string;
  message: string;
  businessId: string;
  conversationId: string;
  contactId: string;
}): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/meta-send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      channel:         opts.channel,
      recipient_id:    opts.recipientId,
      message:         opts.message,
      business_id:     opts.businessId,
      conversation_id: opts.conversationId,
      contact_id:      opts.contactId,
    }),
  });

  const data = await res.json() as { success?: boolean; message_id?: string; error?: string };
  if (!res.ok) return { success: false, error: data.error ?? 'Unknown error' };
  return { success: true, message_id: data.message_id };
}

// ── Realtime subscriptions ────────────────────────────────────────────────────

export function subscribeToConversations(
  businessId: string,
  onUpdate: () => void,
) {
  return supabase
    .channel(`wa_conversations:${businessId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'wa_conversations',
      filter: `business_id=eq.${businessId}`,
    }, onUpdate)
    .subscribe();
}

export function subscribeToMessages(
  conversationId: string,
  onInsert: (msg: WaMessage) => void,
) {
  return supabase
    .channel(`wa_messages:${conversationId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'wa_messages',
      filter: `conversation_id=eq.${conversationId}`,
    }, (payload) => onInsert(payload.new as WaMessage))
    .subscribe();
}

// ── Webhook URL helper ────────────────────────────────────────────────────────

export const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
