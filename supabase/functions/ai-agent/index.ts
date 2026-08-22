/**
 * ai-agent v2 — Supabase Edge Function
 *
 * Omnichannel AI auto-reply with:
 *   - Configurable model (per business)
 *   - Knowledge base injection
 *   - Flow node matching (keyword + intent)
 *   - Handoff-to-human detection
 *   - Real business hours enforcement (off_hours mode)
 *   - WhatsApp / Instagram / Messenger send
 *
 * Required secrets:
 *   GROQ_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (auto)
 *   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID (global WA fallback)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cacheGet, cacheSet } from '../_shared/cache.ts';

const META_API_VERSION = 'v19.0';

// Free tier: Qwen3.6-27B on Groq (every Groq model is free-tier, gated only by
// rate limits). Paid tier: Kimi K2.6 via OpenRouter, gated to Pro-plan
// businesses that opt in via ai_model = 'kimi-k2.6', with a silent fallback
// to the free Qwen/Groq path on any failure.
const DEFAULT_MODEL  = 'qwen/qwen3.6-27b';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const KIMI_MODEL_SENTINEL = 'kimi-k2.6';
const OPENROUTER_MODEL = 'moonshotai/kimi-k2.6'; // verify exact OpenRouter slug at deploy time
const PLAN_RANK: Record<string, number> = { free: 0, starter: 1, pro: 2 };

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const BUSINESS_CACHE_TTL_MS = 60_000;
const MENU_CACHE_TTL_MS = 90_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Channel = 'whatsapp' | 'instagram' | 'messenger';

interface AgentRequest {
  business_id:          string;
  conversation_id:      string;
  contact_phone:        string | null;
  contact_external_id:  string | null;
  last_message_content: string;
  contact_id:           string;
  channel:              Channel;
  intent?:              string | null;
}

interface KnowledgeItem {
  id:      string;
  type:    'faq' | 'policy' | 'info';
  title:   string;
  content: string;
}

interface DayHours { open: string; close: string }
interface OperatingHours {
  timezone?: string;
  mon?: DayHours | null; tue?: DayHours | null; wed?: DayHours | null;
  thu?: DayHours | null; fri?: DayHours | null; sat?: DayHours | null;
  sun?: DayHours | null;
}

function supabaseAdmin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

// ── Operating hours ────────────────────────────────────────────────────────────

function isWithinBusinessHours(hours: OperatingHours): boolean {
  const tz  = hours.timezone ?? 'America/Bogota';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts   = fmt.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) ?? '';
  const hStr    = parts.find(p => p.type === 'hour')?.value   ?? '0';
  const mStr    = parts.find(p => p.type === 'minute')?.value ?? '0';
  const cur     = parseInt(hStr) * 60 + parseInt(mStr);

  const dayHours = hours[weekday as keyof OperatingHours] as DayHours | null | undefined;
  if (!dayHours) return false;
  const [oH, oM] = dayHours.open.split(':').map(Number);
  const [cH, cM] = dayHours.close.split(':').map(Number);
  return cur >= oH * 60 + oM && cur < cH * 60 + cM;
}

// ── Prompt building ────────────────────────────────────────────────────────────

function buildKnowledgeContext(items: KnowledgeItem[]): string {
  if (!items?.length) return '';
  const lines: string[] = ['\n=== INFORMACIÓN DEL NEGOCIO ==='];
  for (const item of items) {
    if (item.type === 'faq') {
      lines.push(`\nP: ${item.title}\nR: ${item.content}`);
    } else {
      lines.push(`\n${item.title}:\n${item.content}`);
    }
  }
  return lines.join('\n');
}

async function buildMenuContext(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const cacheKey = `menu:${businessId}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached !== undefined) return cached;

  const [{ data: categories }, { data: products }] = await Promise.all([
    db.from('categories').select('id, name').eq('business_id', businessId).eq('is_active', true).order('sort_order'),
    db.from('products').select('name, description, price, category_id').eq('business_id', businessId).eq('is_active', true).order('name'),
  ]);
  if (!categories?.length && !products?.length) {
    cacheSet(cacheKey, '', MENU_CACHE_TTL_MS);
    return '';
  }

  const catMap: Record<string, string> = {};
  for (const c of categories ?? []) catMap[c.id] = c.name;

  const byCat: Record<string, typeof products> = {};
  for (const p of products ?? []) {
    const cat = catMap[p.category_id] ?? 'Sin categoría';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat]!.push(p);
  }

  const lines: string[] = ['\n=== MENÚ DEL NEGOCIO ==='];
  for (const [cat, prods] of Object.entries(byCat)) {
    lines.push(`\n${cat}:`);
    for (const p of prods ?? []) {
      const price = p.price != null ? ` — $${p.price.toLocaleString('es-CO')}` : '';
      const desc  = p.description ? ` (${p.description})` : '';
      lines.push(`  • ${p.name}${price}${desc}`);
    }
  }
  const result = lines.join('\n');
  cacheSet(cacheKey, result, MENU_CACHE_TTL_MS);
  return result;
}

async function getHistory(
  db: ReturnType<typeof supabaseAdmin>,
  conversationId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data } = await db
    .from('wa_messages').select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(12);
  if (!data) return [];
  return data.reverse().filter(m => m.content).map(m => ({
    role: m.direction === 'inbound' ? 'user' : 'assistant',
    content: m.content!,
  }));
}

// ── Flow node matching ─────────────────────────────────────────────────────────

async function matchFlowNode(
  db: ReturnType<typeof supabaseAdmin>,
  businessId: string,
  message: string,
  intent: string | null | undefined,
): Promise<{ id: string; name: string; response_template: string } | null> {
  const { data: nodes } = await db
    .from('ai_flow_nodes')
    .select('id, name, trigger_keywords, trigger_intent, response_template')
    .eq('business_id', businessId).eq('is_active', true).order('sort_order');
  if (!nodes?.length) return null;

  const lower = message.toLowerCase();
  for (const node of nodes) {
    if (node.trigger_keywords?.length) {
      const hit = node.trigger_keywords.some((kw: string) => lower.includes(kw.toLowerCase().trim()));
      if (hit) return { id: node.id, name: node.name, response_template: node.response_template };
    }
    if (node.trigger_intent && intent && node.trigger_intent === intent) {
      return { id: node.id, name: node.name, response_template: node.response_template };
    }
  }
  return null;
}

function detectsHandoff(message: string, keywords: string[]): boolean {
  if (!keywords?.length) return false;
  const lower = message.toLowerCase();
  return keywords.some(kw => lower.includes(kw.toLowerCase().trim()));
}

// ── Model/provider resolution ─────────────────────────────────────────────────

interface ModelAttempt {
  endpoint: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
}

function buildAttempts(business: { ai_model?: string | null; plan?: string | null }): ModelAttempt[] {
  const groqKey = Deno.env.get('GROQ_API_KEY')!;
  const groqAttempt = (model: string, timeoutMs: number): ModelAttempt => ({
    endpoint: GROQ_ENDPOINT, apiKey: groqKey, model, timeoutMs,
  });

  const planRank = PLAN_RANK[business.plan ?? 'free'] ?? 0;
  const wantsKimi = business.ai_model === KIMI_MODEL_SENTINEL;
  const openRouterKey = Deno.env.get('OPENROUTER_API_KEY');

  if (wantsKimi && planRank >= PLAN_RANK['pro'] && openRouterKey) {
    return [
      {
        endpoint: OPENROUTER_ENDPOINT,
        apiKey: openRouterKey,
        model: OPENROUTER_MODEL,
        extraHeaders: { 'HTTP-Referer': 'https://domicircuspop.replit.app', 'X-Title': 'DomiCircusPop AI Agent' },
        timeoutMs: 9_000,
      },
      groqAttempt(DEFAULT_MODEL, 6_000), // degrade to free Qwen if Kimi/OpenRouter fails
    ];
  }

  const primaryModel = (business.ai_model && business.ai_model !== KIMI_MODEL_SENTINEL)
    ? business.ai_model
    : DEFAULT_MODEL;
  return [groqAttempt(primaryModel, 8_000), groqAttempt(FALLBACK_MODEL, 6_000)];
}

// ── LLM call ────────────────────────────────────────────────────────────────────

async function generateReply(
  business: { ai_model?: string | null; plan?: string | null },
  systemPrompt: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  lastMessage: string,
): Promise<string | null> {
  if (!Deno.env.get('GROQ_API_KEY')) { console.warn('[ai-agent] GROQ_API_KEY not set'); return null; }

  const msgs = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: lastMessage }];
  const attempts = buildAttempts(business);

  for (const attempt of attempts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), attempt.timeoutMs);
    try {
      const res = await fetch(attempt.endpoint, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Authorization': `Bearer ${attempt.apiKey}`,
          'Content-Type': 'application/json',
          ...(attempt.extraHeaders ?? {}),
        },
        body: JSON.stringify({ model: attempt.model, max_tokens: 500, temperature: 0.5, messages: msgs }),
      });
      if (!res.ok) {
        console.error(`[ai-agent] ${attempt.model} error:`, res.status, (await res.text()).slice(0, 200));
        continue;
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content?.trim() ?? null;
      if (content) return content;
    } catch (e) {
      console.error(`[ai-agent] ${attempt.model} threw:`, e);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ── Send via channel ───────────────────────────────────────────────────────────

async function sendReply(
  channel: Channel,
  recipientId: string,
  message: string,
  biz: Record<string, unknown>,
): Promise<string | null> {
  if (channel === 'whatsapp') {
    const phoneId = (biz.wa_phone_number_id as string | null) ?? Deno.env.get('WHATSAPP_PHONE_ID');
    const token   = (biz.wa_access_token   as string | null) ?? Deno.env.get('WHATSAPP_TOKEN');
    if (!phoneId || !token) return null;
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: recipientId, type: 'text', text: { body: message } }),
    });
    if (!res.ok) { console.error('[ai-agent] WA send error:', await res.json()); return null; }
    const d = await res.json() as { messages?: Array<{ id: string }> };
    return d.messages?.[0]?.id ?? null;
  }

  if (channel === 'instagram') {
    const pageId = biz.ig_page_id as string | null;
    const token  = biz.ig_access_token as string | null;
    if (!pageId || !token) return null;
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${pageId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
    });
    if (!res.ok) { console.error('[ai-agent] IG send error:', await res.json()); return null; }
    const d = await res.json() as { message_id?: string };
    return d.message_id ?? null;
  }

  if (channel === 'messenger') {
    const fbToken = biz.fb_page_token as string | null;
    if (!fbToken) return null;
    const res = await fetch(`https://graph.facebook.com/${META_API_VERSION}/me/messages?access_token=${fbToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, message: { text: message } }),
    });
    if (!res.ok) { console.error('[ai-agent] Messenger send error:', await res.json()); return null; }
    const d = await res.json() as { message_id?: string };
    return d.message_id ?? null;
  }

  return null;
}

// ── Main handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST')   return new Response('Method Not Allowed', { status: 405 });

  const authHeader = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!authHeader || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: AgentRequest;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const {
    business_id, conversation_id, contact_phone, contact_external_id,
    last_message_content, contact_id, channel = 'whatsapp', intent,
  } = body;

  if (!business_id || !conversation_id || !last_message_content || !contact_id) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const recipientId = channel === 'whatsapp' ? contact_phone : contact_external_id;
  if (!recipientId) {
    return new Response(JSON.stringify({ skipped: 'No recipient identifier' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = supabaseAdmin();

    // 1-3. Load business, check needs_human, and match flow nodes — none of these
    // three depend on each other's *results* (all three only need IDs already
    // present in the request body), so run them in one round trip instead of
    // three sequential ones. Business is also cached across warm invocations.
    const businessCacheKey = `business:${business_id}`;
    // deno-lint-ignore no-explicit-any
    const cachedBusiness = cacheGet<any>(businessCacheKey);

    const [businessData, convResult, flowNode] = await Promise.all([
      cachedBusiness
        ? Promise.resolve(cachedBusiness)
        : db.from('businesses')
            .select(
              'name, description, ai_enabled, ai_prompt, ai_auto_reply_mode, ai_model, plan,' +
              'ai_operating_hours, ai_knowledge_base, ai_handoff_keywords,' +
              'wa_phone_number_id, wa_access_token,' +
              'ig_page_id, ig_access_token, fb_page_id, fb_page_token',
            )
            .eq('id', business_id)
            .maybeSingle()
            .then(r => r.data),
      db.from('wa_conversations').select('needs_human').eq('id', conversation_id).maybeSingle(),
      matchFlowNode(db, business_id, last_message_content, intent),
    ]);

    // deno-lint-ignore no-explicit-any
    const business = businessData as any;
    if (business && !cachedBusiness) cacheSet(businessCacheKey, business, BUSINESS_CACHE_TTL_MS);

    if (!business?.ai_enabled || business.ai_auto_reply_mode === 'disabled') {
      return new Response(JSON.stringify({ skipped: 'AI not enabled' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Instagram/Messenger DM auto-reply is a Pro-plan feature. The
    // "Conectar Instagram/Facebook" OAuth flow (unlike the old manual
    // Pro-gated token form) is available on every plan for read-only posts
    // access, so ig_page_id/fb_page_id being set no longer implies Pro —
    // enforce the plan check here instead.
    if (channel !== 'whatsapp' && business.plan !== 'pro') {
      return new Response(JSON.stringify({ skipped: 'Instagram/Messenger auto-reply requires Pro plan' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Off-hours enforcement
    if (business.ai_auto_reply_mode === 'off_hours') {
      if (!business.ai_operating_hours) {
        // No schedule configured — treat as always-open (safe default: do not respond)
        return new Response(JSON.stringify({ skipped: 'off_hours mode but no schedule configured' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (isWithinBusinessHours(business.ai_operating_hours as OperatingHours)) {
        return new Response(JSON.stringify({ skipped: 'Within business hours' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }

    const conv = convResult.data;
    if (conv?.needs_human) {
      return new Response(JSON.stringify({ skipped: 'Awaiting human agent' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Handoff keyword detection
    const handoffKeywords = (business.ai_handoff_keywords as string[]) ?? [];
    if (detectsHandoff(last_message_content, handoffKeywords)) {
      await db.from('wa_conversations').update({ needs_human: true }).eq('id', conversation_id);
      console.log('[ai-agent] Handoff flagged, awaiting human agent:', conversation_id);
      return new Response(JSON.stringify({ success: true, handoff: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Flow node match (already fetched in parallel above)
    if (flowNode) {
      let responseText = flowNode.response_template;
      // Resolve {{promociones}} placeholder with active promo KB items
      if (responseText.includes('{{promociones}}')) {
        const kb = (business.ai_knowledge_base ?? []) as Array<{ type: string; title: string; content: string }>;
        const promos = kb.filter(i => i.type === 'promo');
        const promosText = promos.length
          ? promos.map(p => `• *${p.title}*: ${p.content}`).join('\n')
          : 'No hay promociones activas en este momento.';
        responseText = responseText.replace(/\{\{promociones\}\}/g, promosText);
      }
      const msgId = await sendReply(channel, recipientId, responseText, business as Record<string, unknown>);
      const now = new Date().toISOString();
      await db.from('wa_messages').insert({
        business_id, conversation_id, contact_id, channel,
        wa_message_id: msgId ?? null, direction: 'outbound', type: 'text',
        content: responseText, status: msgId ? 'sent' : 'failed', sent_by_ai: true, wa_timestamp: now,
        flow_node_name: flowNode.name,
      });
      await db.from('wa_conversations').update({ last_message_at: now, flow_node_id: flowNode.id }).eq('id', conversation_id);
      console.log('[ai-agent] Flow matched:', flowNode.id);
      return new Response(JSON.stringify({ success: true, flow_node_id: flowNode.id }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 6. LLM reply
    if (!Deno.env.get('GROQ_API_KEY')) {
      return new Response(JSON.stringify({ skipped: 'Groq not configured' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const [menuContext, history] = await Promise.all([
      buildMenuContext(db, business_id),
      getHistory(db, conversation_id),
    ]);

    const knowledgeContext = buildKnowledgeContext((business.ai_knowledge_base as KnowledgeItem[]) ?? []);

    // Build customer memory context from CRM data
    let customerMemoryContext = '';
    if (contact_phone) {
      const normPhone = contact_phone.replace(/\D/g, '');
      const [{ data: recentOrders }, { data: crmCustomer }] = await Promise.all([
        db.from('orders')
          .select('total, status, created_at')
          .eq('business_id', business_id)
          .or(`customer_phone.eq.${contact_phone},customer_phone.eq.${normPhone}`)
          .order('created_at', { ascending: false })
          .limit(3),
        db.from('customers')
          .select('name, tags, notes')
          .eq('business_id', business_id)
          .or(`phone.eq.${contact_phone},phone.eq.${normPhone}`)
          .maybeSingle(),
      ]);
      const lines: string[] = [];
      if (recentOrders && recentOrders.length > 0) {
        const last = recentOrders[0];
        const daysSince = Math.floor((Date.now() - new Date(last.created_at).getTime()) / 86_400_000);
        lines.push(`\n\n--- MEMORIA DEL CLIENTE ---`);
        lines.push(`Este cliente ha realizado ${recentOrders.length} pedido(s) previo(s).`);
        lines.push(`Último pedido: hace ${daysSince} día(s), $${last.total?.toLocaleString('es-CO') ?? '?'} (${last.status}).`);
      }
      const tags = (crmCustomer?.tags as string[] | null) ?? [];
      if (tags.length > 0) {
        if (lines.length === 0) lines.push(`\n\n--- MEMORIA DEL CLIENTE ---`);
        lines.push(`Etiquetas CRM: ${tags.join(', ')}.`);
      }
      if (crmCustomer?.notes) {
        if (lines.length === 0) lines.push(`\n\n--- MEMORIA DEL CLIENTE ---`);
        lines.push(`Nota interna: ${String(crmCustomer.notes).slice(0, 200)}.`);
      }
      if (lines.length > 0) {
        lines.push(`Usa este contexto para personalizar la respuesta sin mencionarlo explícitamente.`);
        lines.push(`--- FIN MEMORIA ---`);
        customerMemoryContext = lines.join('\n');
      }
    }

    const defaultPrompt = `Eres un asistente virtual amable y profesional para ${business.name}.
Responde preguntas sobre el menú, precios, disponibilidad y horarios de forma concisa (máximo 3 oraciones).
Si el cliente quiere hacer un pedido, recoge su solicitud y confirma los detalles.
Usa un tono cálido y en español colombiano. Si no sabes algo, di que lo consultarás.
NO inventes precios ni productos que no aparezcan en el menú.`;

    const systemPrompt = [
      business.ai_prompt ?? defaultPrompt,
      menuContext,
      knowledgeContext,
      business.description ? `\nDescripción: ${business.description}` : '',
      customerMemoryContext,
    ].filter(Boolean).join('');

    const reply = await generateReply(business, systemPrompt, history, last_message_content);
    if (!reply) {
      return new Response(JSON.stringify({ skipped: 'No reply generated' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const msgId = await sendReply(channel, recipientId, reply, business as Record<string, unknown>);
    const now = new Date().toISOString();
    await db.from('wa_messages').insert({
      business_id, conversation_id, contact_id, channel,
      wa_message_id: msgId ?? null, direction: 'outbound', type: 'text',
      content: reply, status: msgId ? 'sent' : 'failed', sent_by_ai: true, wa_timestamp: now,
    });
    await db.from('wa_conversations').update({ last_message_at: now, status: 'open' }).eq('id', conversation_id);

    console.log(`[ai-agent] Replied via ${channel}:`, msgId);
    return new Response(JSON.stringify({ success: true, message_id: msgId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[ai-agent] error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
