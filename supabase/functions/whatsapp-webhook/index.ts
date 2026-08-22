**
 * meta-webhook (was whatsapp-webhook) — Supabase Edge Function v10
 * Handles WhatsApp, Instagram DM, and Facebook Messenger in one endpoint.
 *
 * Required secrets:
 *   WHATSAPP_VERIFY_TOKEN  — verify token registered in Meta for Developers
 *   WHATSAPP_APP_SECRET    — App Secret for HMAC-SHA256 signature verification
 *   WHATSAPP_TOKEN         — global fallback WA permanent access token
 *   WHATSAPP_PHONE_ID      — global fallback WA Phone Number ID
 *   OPENROUTER_API_KEY     — optional; AI features disabled if absent
 */

import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Channel = 'whatsapp' | 'instagram' | 'messenger';
type Db = SupabaseClient;

const supabaseAdmin = () => createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Fire-and-forget a promise without blocking the response, while still letting
// it finish after the response is sent (Supabase's Edge Runtime keeps the
// isolate alive for work registered via waitUntil; without it a background
// promise can get cut off once the response goes out).
function backgroundTask(promise: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(promise);
  } else {
    promise.catch(() => {});
  }
}

// ── Signature verification ─────────────────────────────────────────────────────

async function verifyMetaSignature(
  rawBody: ArrayBuffer,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = signatureHeader.slice('sha256='.length);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, rawBody);
  const actual = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── Contact / Conversation upserts (channel-aware) ────────────────────────────

async function upsertContact(
  db: Db,
  businessId: string,
  opts: {
    phone?: string | null;
    external_id?: string | null;
    name: string | null;
    channel: Channel;
  },
): Promise<{ id: string; score: number }> {
  // Build lookup filter based on channel
  let existingQ = db.from('wa_contacts').select('id, score')
    .eq('business_id', businessId)
    .eq('channel', opts.channel);

  if (opts.channel === 'whatsapp' && opts.phone) {
    existingQ = existingQ.eq('phone', opts.phone);
  } else if (opts.external_id) {
    existingQ = existingQ.eq('external_id', opts.external_id);
  } else {
    // Fallback: no unique identifier, skip
    return { id: '', score: 0 };
  }

  const { data: existing } = await existingQ.maybeSingle();

  if (existing) {
    const newScore = (existing.score ?? 0) + 1;
    await db.from('wa_contacts').update({
      ...(opts.name ? { name: opts.name } : {}),
      last_interaction_at: new Date().toISOString(),
      score: newScore,
    }).eq('id', existing.id);
    return { id: existing.id as string, score: newScore };
  }

  const insertData: Record<string, unknown> = {
    business_id: businessId,
    channel: opts.channel,
    name: opts.name ?? (opts.phone ?? opts.external_id ?? 'Unknown'),
    last_interaction_at: new Date().toISOString(),
    score: 1,
  };
  if (opts.phone)       insertData.phone       = opts.phone;
  if (opts.external_id) insertData.external_id = opts.external_id;

  const { data: created } = await db.from('wa_contacts')
    .insert(insertData).select('id').single();

  return { id: created!.id as string, score: 1 };
}

async function upsertConversation(
  db: Db,
  businessId: string,
  contactId: string,
  channel: Channel,
): Promise<string> {
  const { data: existing } = await db.from('wa_conversations')
    .select('id, unread_count')
    .eq('business_id', businessId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .maybeSingle();

  if (existing) {
    await db.from('wa_conversations').update({
      status: 'open',
      unread_count: (existing.unread_count ?? 0) + 1,
      last_message_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return existing.id as string;
  }

  const { data: created } = await db.from('wa_conversations').insert({
    business_id: businessId,
    contact_id: contactId,
    channel,
    status: 'open',
    unread_count: 1,
    last_message_at: new Date().toISOString(),
  }).select('id').single();

  return created!.id as string;
}

// ── Content extraction ─────────────────────────────────────────────────────────

function extractWaMessageContent(msg: Record<string, unknown>): {
  type: string; content: string | null; mediaUrl: string | null;
} {
  const type = (msg.type as string) ?? 'unknown';
  if (type === 'text') {
    const text = msg.text as { body?: string } | undefined;
    return { type: 'text', content: text?.body ?? null, mediaUrl: null };
  }
  if (['image', 'audio', 'video', 'document', 'sticker'].includes(type)) {
    const media = msg[type] as { id?: string; caption?: string } | undefined;
    return { type, content: media?.caption ?? null, mediaUrl: media?.id ?? null };
  }
  if (type === 'location') {
    const loc = msg.location as { latitude?: number; longitude?: number } | undefined;
    return { type: 'location', content: `${loc?.latitude},${loc?.longitude}`, mediaUrl: null };
  }
  return { type: 'unknown', content: null, mediaUrl: null };
}

function extractSocialMessageContent(msg: Record<string, unknown>): {
  type: string; content: string | null; mediaUrl: string | null;
} {
  if (msg.text && typeof msg.text === 'string') {
    return { type: 'text', content: msg.text, mediaUrl: null };
  }
  const attachments = msg.attachments as Array<{ type?: string; payload?: { url?: string } }> | undefined;
  if (attachments?.length) {
    const att = attachments[0];
    const attType = att.type ?? 'unknown';
    const mediaUrl = att.payload?.url ?? null;
    return { type: attType, content: null, mediaUrl };
  }
  return { type: 'unknown', content: null, mediaUrl: null };
}

// ── AI: Intent classification ─────────────────────────────────────────────────

const VALID_INTENTS = ['order', 'inquiry', 'complaint', 'follow_up', 'other'];
type Intent = 'order' | 'inquiry' | 'complaint' | 'follow_up' | 'other';
const INTENT_SCORE_BONUS: { [key: string]: number } = {
  order: 5, inquiry: 1, complaint: -2, follow_up: 3, other: 0,
};

async function classifyIntent(content: string): Promise<{ intent: Intent; scoreBonus: number }> {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) return { intent: 'other', scoreBonus: 0 };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://domicircuspop.replit.app',
        'X-Title': 'DomiCircusPop Webhook',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        max_tokens: 10,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `Classify the user message into one of these categories. Reply with ONLY the category name, lowercase, nothing else:
- order: wants to place an order or buy something
- inquiry: asking about products, prices, hours, availability
- complaint: expressing dissatisfaction or reporting a problem
- follow_up: following up on a previous order or request
- other: anything else`,
          },
          { role: 'user', content: content.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return { intent: 'other', scoreBonus: 0 };
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? 'other';
    const intent = VALID_INTENTS.includes(raw) ? (raw as Intent) : 'other';
    return { intent, scoreBonus: INTENT_SCORE_BONUS[intent] ?? 0 };
  } catch {
    return { intent: 'other', scoreBonus: 0 };
  }
}

// ── AI: Trigger ai-agent (all channels) ───────────────────────────────────────

async function triggerAiAgent(params: {
  business_id:          string;
  conversation_id:      string;
  contact_phone:        string | null;
  contact_external_id:  string | null;
  last_message_content: string;
  contact_id:           string;
  channel:              Channel;
  intent?:              string | null;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return;
  try {
    await fetch(`${supabaseUrl}/functions/v1/ai-agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
  } catch (e) {
    console.warn('[webhook] ai-agent call failed:', e);
  }
}

// ── WhatsApp entry processor ──────────────────────────────────────────────────

async function processWhatsAppEntries(
  db: Db,
  body: Record<string, unknown>,
): Promise<void> {
  const entries = (body.entry as Record<string, unknown>[]) ?? [];

  for (const entry of entries) {
    const changes = (entry.changes as Record<string, unknown>[]) ?? [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value as Record<string, unknown>;
      const metadata = value.metadata as { phone_number_id?: string } | undefined;
      const phoneNumberId = metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: business } = await db.from('businesses')
        .select('id, ai_enabled, ai_auto_reply_mode')
        .eq('wa_phone_number_id', phoneNumberId)
        .maybeSingle();

      if (!business) {
        console.warn('[webhook] No WA business for phone_number_id:', phoneNumberId);
        continue;
      }

      const contacts = (value.contacts as Record<string, unknown>[]) ?? [];
      const messages = (value.messages as Record<string, unknown>[]) ?? [];
      const contactMap: Record<string, string> = {};
      for (const c of contacts) {
        const waId = c.wa_id as string;
        const profile = c.profile as { name?: string } | undefined;
        contactMap[waId] = profile?.name ?? waId;
      }

      for (const msg of messages) {
        const waMessageId = msg.id as string;
        const from        = msg.from as string;
        const tsRaw       = msg.timestamp as string | number;
        const waTs        = new Date(Number(tsRaw) * 1000).toISOString();

        const { data: dup } = await db.from('wa_messages')
          .select('id').eq('wa_message_id', waMessageId).maybeSingle();
        if (dup) continue;

        const contactName = contactMap[from] ?? null;
        const { id: contactId, score: contactScore } = await upsertContact(db, business.id, {
          phone: from, name: contactName, channel: 'whatsapp',
        });
        if (!contactId) continue;

        const convId = await upsertConversation(db, business.id, contactId, 'whatsapp');
        const { type, content, mediaUrl } = extractWaMessageContent(msg as Record<string, unknown>);

        const { data: savedMsg } = await db.from('wa_messages').insert({
          business_id:     business.id,
          conversation_id: convId,
          contact_id:      contactId,
          wa_message_id:   waMessageId,
          channel:         'whatsapp',
          direction:       'inbound',
          type,
          content,
          media_url:       mediaUrl,
          status:          'delivered',
          wa_timestamp:    waTs,
        }).select('id').single();

        if (savedMsg && type === 'text' && content) {
          const aiEnabled   = (business as Record<string, unknown>).ai_enabled as boolean | undefined;
          const aiReplyMode = (business as Record<string, unknown>).ai_auto_reply_mode as string | undefined;
          if (aiEnabled && aiReplyMode && aiReplyMode !== 'disabled') {
            await triggerAiAgent({
              business_id: business.id, conversation_id: convId,
              contact_phone: from, contact_external_id: null,
              last_message_content: content, contact_id: contactId,
              channel: 'whatsapp', intent: null,
            });
          }
          // Intent classification (an extra LLM round trip) only feeds an
          // optional trigger_intent flow-node match and a CRM score bump —
          // neither the reply above needs it, so it runs in the background
          // instead of blocking every inbound message on a second LLM call.
          backgroundTask(
            classifyIntent(content).then(async ({ intent, scoreBonus }) => {
              await db.from('wa_messages').update({ intent }).eq('id', savedMsg.id);
              if (scoreBonus !== 0) {
                const newScore = Math.max(0, contactScore + scoreBonus);
                await db.from('wa_contacts').update({ score: newScore }).eq('id', contactId);
              }
            }).catch(e => console.warn('[webhook] background classifyIntent failed:', e)),
          );
        }
      }

      // Delivery/read status updates
      const statuses = (value.statuses as Record<string, unknown>[]) ?? [];
      for (const s of statuses) {
        const waId  = s.id as string;
        const state = s.status as string;
        if (['delivered', 'read', 'failed'].includes(state)) {
          await db.from('wa_messages').update({ status: state }).eq('wa_message_id', waId);
          if (state === 'delivered' || state === 'read') {
            const { data: bulkItem } = await db.from('wa_bulk_job_items')
              .select('id, job_id, status').eq('wa_message_id', waId).maybeSingle();
            if (bulkItem && bulkItem.status !== 'delivered') {
              await db.from('wa_bulk_job_items').update({ status: 'delivered' }).eq('id', bulkItem.id);
              const { data: parentJob } = await db.from('wa_bulk_jobs')
                .select('delivered_count').eq('id', bulkItem.job_id).maybeSingle();
              if (parentJob) {
                await db.from('wa_bulk_jobs')
                  .update({ delivered_count: (parentJob.delivered_count ?? 0) + 1 })
                  .eq('id', bulkItem.job_id);
              }
            }
          }
        }
      }
    }
  }
}

// ── Instagram DM / Messenger entry processor ──────────────────────────────────

async function processSocialEntries(
  db: Db,
  body: Record<string, unknown>,
  channel: 'instagram' | 'messenger',
): Promise<void> {
  const entries = (body.entry as Record<string, unknown>[]) ?? [];
  const pageField = channel === 'instagram' ? 'ig_page_id' : 'fb_page_id';

  for (const entry of entries) {
    const pageId  = entry.id as string;
    if (!pageId) continue;

    // Find business by IG/FB page ID
    const { data: business } = await db.from('businesses')
      .select('id, ai_enabled, ai_auto_reply_mode')
      .eq(pageField, pageId)
      .maybeSingle();

    if (!business) {
      console.warn(`[webhook] No ${channel} business for page_id:`, pageId);
      continue;
    }

    // Instagram and Messenger use `entry[].messaging[]` structure
    const messaging = (entry.messaging as Record<string, unknown>[]) ?? [];

    for (const event of messaging) {
      // Skip delivery/read receipts — only process actual messages
      if (!event.message) continue;
      const msg = event.message as Record<string, unknown>;
      // Skip echo messages (sent by the page itself)
      if (msg.is_echo) continue;

      const sender    = (event.sender as { id?: string })?.id;
      const msgId     = msg.mid as string | undefined;
      const tsRaw     = event.timestamp as number;

      if (!sender || !msgId) continue;

      // Deduplicate
      const { data: dup } = await db.from('wa_messages')
        .select('id').eq('wa_message_id', msgId).maybeSingle();
      if (dup) continue;

      const { id: contactId, score: _score } = await upsertContact(db, business.id, {
        external_id: sender,
        name: null,
        channel,
      });
      if (!contactId) continue;

      const convId = await upsertConversation(db, business.id, contactId, channel);
      const { type, content, mediaUrl } = extractSocialMessageContent(msg);
      const waTs = new Date(tsRaw).toISOString();

      const { data: savedMsg } = await db.from('wa_messages').insert({
        business_id:     business.id,
        conversation_id: convId,
        contact_id:      contactId,
        wa_message_id:   msgId,
        channel,
        direction:       'inbound',
        type,
        content,
        media_url:       mediaUrl,
        status:          'delivered',
        wa_timestamp:    waTs,
      }).select('id').single();

      // AI reply + (non-blocking) intent classification for text messages
      if (savedMsg && type === 'text' && content) {
        const aiEnabled   = (business as Record<string, unknown>).ai_enabled as boolean | undefined;
        const aiReplyMode = (business as Record<string, unknown>).ai_auto_reply_mode as string | undefined;
        if (aiEnabled && aiReplyMode && aiReplyMode !== 'disabled') {
          await triggerAiAgent({
            business_id: business.id, conversation_id: convId,
            contact_phone: null, contact_external_id: sender,
            last_message_content: content, contact_id: contactId,
            channel, intent: null,
          });
        }
        backgroundTask(
          classifyIntent(content).then(async ({ intent, scoreBonus }) => {
            await db.from('wa_messages').update({ intent }).eq('id', savedMsg.id);
            if (scoreBonus !== 0) {
              const { data: ct } = await db.from('wa_contacts').select('score').eq('id', contactId).single();
              if (ct) {
                await db.from('wa_contacts')
                  .update({ score: Math.max(0, (ct.score ?? 0) + scoreBonus) })
                  .eq('id', contactId);
              }
            }
          }).catch(e => console.warn('[webhook] background classifyIntent failed:', e)),
        );
      }
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Webhook verification GET (shared verify_token for all channels)
  if (req.method === 'GET') {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (mode === 'subscribe' && token === verifyToken) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('Forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.arrayBuffer();

  // Signature verification
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!appSecret) {
    console.error('[webhook] WHATSAPP_APP_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  const signatureHeader = req.headers.get('X-Hub-Signature-256');
  const valid = await verifyMetaSignature(rawBody, signatureHeader, appSecret);
  if (!valid) {
    console.warn('[webhook] Signature verification failed');
    return new Response('Forbidden', { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    const db = supabaseAdmin();
    const objectType = (body.object as string) ?? '';

    if (objectType === 'whatsapp_business_account') {
      await processWhatsAppEntries(db, body);
    } else if (objectType === 'instagram') {
      await processSocialEntries(db, body, 'instagram');
    } else if (objectType === 'page') {
      await processSocialEntries(db, body, 'messenger');
    } else {
      console.warn('[webhook] Unknown object type:', objectType);
    }
  } catch (err) {
    console.error('[webhook] processing error:', err);
    return new Response(JSON.stringify({ error: 'Processing failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
