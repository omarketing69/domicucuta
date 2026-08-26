/**
 * menu-agent v6 — Supabase Edge Function
 * Public AI assistant for the customer-facing menu/reservations page.
 *
 * Accepts: POST { slug, question, history, menuData?, orderState? }
 *   menuData: { categories: {name}[], products: {name, price, description, categoryName}[] }
 *   If menuData is provided, skips the DB query for menu (faster).
 *
 * Returns: text/event-stream. Each event is `data: {...}\n\n`:
 *   - { delta: string }                                          — a chunk of the assistant's reply text
 *   - { done: true, state?, orderData?, bookingData?, error? }    — terminal event
 *
 * No auth required (verify_jwt: false). Writes only via the client (order/booking
 * inserts happen in the frontend, same as before) — this function itself is read-only.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cacheGet, cacheSet } from '../_shared/cache.ts';

// Free tier: Qwen3.6-27B on Groq — every model on Groq's free tier runs on the
// same LPU hardware, gated only by rate limits, not cost. Verify this exact
// model ID against Groq's current docs if it ever 404s (Groq deprecates/renames
// model slugs periodically).
const DEFAULT_MODEL  = 'qwen/qwen3.6-27b';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_QUESTION_LEN = 500;

// Paid tier: Kimi K2.6 via OpenRouter, gated to Pro-plan businesses that opt in
// by setting ai_model = 'kimi-k2.6'. Falls back to the free Qwen/Groq path on
// any failure so a Pro customer never gets a hard error.
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

interface HistoryMessage { role: 'user' | 'assistant'; content: string }
interface KnowledgeItem  { type: string; title: string; content: string }
interface OrderState { cliente?: string; telefono?: string; items?: string; entrega?: string; direccion?: string; paso?: string }
interface OrderData { cliente: string; telefono?: string; items: string; entrega: string; direccion?: string; notas?: string }
interface BookingData { servicio: string; servicio_id?: string; fecha: string; hora: string; personas?: number; cliente: string; telefono?: string; notas?: string; precio?: number }

interface ClientProduct  { name: string; price: number; description?: string | null; categoryName: string }
interface ClientMenuData { products: ClientProduct[] }

interface BusinessRow {
  id: string;
  name: string;
  description: string | null;
  ai_enabled: boolean;
  ai_prompt: string | null;
  ai_model: string | null;
  ai_knowledge_base: KnowledgeItem[] | null;
  business_type: string | null;
  currency: string | null;
  plan: string | null;
}

function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function buildOrderStateContext(state?: OrderState): string {
  if (!state) return '';
  const known = Object.entries(state).filter(([, v]) => v && String(v).trim());
  if (!known.length) return '';
  const labels: Record<string, string> = {
    cliente: 'Nombre del cliente', telefono: 'Número de WhatsApp', items: 'Productos ya elegidos',
    entrega: 'Tipo de entrega', direccion: 'Dirección', paso: 'Paso actual del pedido',
  };
  const lines = known.map(([k, v]) => `- ${labels[k] ?? k}: ${v}`);
  return `\n\n=== DATOS YA CONFIRMADOS DE ESTE PEDIDO (NO LOS VUELVAS A PREGUNTAR) ===\n${lines.join('\n')}\nUsa estos datos como ciertos. Continúa el pedido pidiendo SOLO lo que falte.`;
}

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

function buildMenuContextFromData(data: ClientMenuData): string {
  if (!data?.products?.length) return '';
  const byCat: Record<string, ClientProduct[]> = {};
  for (const p of data.products) {
    const cat = p.categoryName ?? 'Sin categoría';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(p);
  }
  const lines: string[] = ['\n=== MENÚ DEL NEGOCIO ==='];
  for (const [cat, prods] of Object.entries(byCat)) {
    lines.push(`\n${cat}:`);
    for (const p of prods) {
      const price = p.price != null ? ` — $${Number(p.price).toLocaleString('es-CO')}` : '';
      const desc  = p.description ? ` (${p.description})` : '';
      lines.push(`  • ${p.name}${price}${desc}`);
    }
  }
  return lines.join('\n');
}

async function buildMenuContextFromDB(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const cacheKey = `menu:${businessId}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached !== undefined) return cached;

  const [{ data: categories }, { data: products }] = await Promise.all([
    db.from('categories').select('id, name').eq('business_id', businessId).eq('is_active', true).order('position'),
    db.from('products').select('name, description, price, category_id').eq('business_id', businessId).eq('is_available', true).order('name'),
  ]);
  if (!categories?.length && !products?.length) {
    cacheSet(cacheKey, '', MENU_CACHE_TTL_MS);
    return '';
  }

  const catMap: Record<string, string> = {};
  for (const c of categories ?? []) catMap[c.id] = c.name;

  const byCat: Record<string, typeof products> = {};
  for (const p of products ?? []) {
    const cat = catMap[p.category_id ?? ''] ?? 'Sin categoría';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat]!.push(p);
  }

  const lines: string[] = ['\n=== MENÚ DEL NEGOCIO ==='];
  for (const [cat, prods] of Object.entries(byCat)) {
    lines.push(`\n${cat}:`);
    for (const p of prods ?? []) {
      const price = p.price != null ? ` — $${Number(p.price).toLocaleString('es-CO')}` : '';
      const desc  = p.description ? ` (${p.description})` : '';
      lines.push(`  • ${p.name}${price}${desc}`);
    }
  }
  const result = lines.join('\n');
  cacheSet(cacheKey, result, MENU_CACHE_TTL_MS);
  return result;
}

async function buildServiceContext(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const cacheKey = `services:${businessId}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached !== undefined) return cached;

  const { data: services } = await db
    .from('services' as any)
    .select('id, name, description, price, duration_minutes, max_persons')
    .eq('business_id', businessId)
    .eq('is_available', true)
    .order('position');

  if (!services?.length) {
    cacheSet(cacheKey, '', MENU_CACHE_TTL_MS);
    return '';
  }

  const lines: string[] = ['\n=== SERVICIOS DISPONIBLES ==='];
  for (const s of services) {
    const price = s.price != null ? ` — $${Number(s.price).toLocaleString('es-CO')}` : '';
    const duration = ` | ${s.duration_minutes} minutos`;
    const persons = s.max_persons > 1 ? ` | hasta ${s.max_persons} personas` : '';
    const desc = s.description ? `\n    ${s.description}` : '';
    lines.push(`  • [ID:${s.id}] ${s.name}${price}${duration}${persons}${desc}`);
  }
  const result = lines.join('\n');
  cacheSet(cacheKey, result, MENU_CACHE_TTL_MS);
  return result;
}

// ── Tool schemas (replace the old free-text [STATE:...]/[ORDER:...]/[BOOKING:...] tags) ──

const updateOrderStateTool = {
  type: 'function',
  function: {
    name: 'update_order_state',
    description: 'Guarda lo que ya se sabe del pedido o reserva en curso, sin enviarlo todavía. Llamar en CADA turno mientras el pedido/reserva esté en curso, incluso si aún faltan datos.',
    parameters: {
      type: 'object',
      properties: {
        cliente:   { type: 'string', description: 'Nombre del cliente, si ya se conoce' },
        telefono:  { type: 'string', description: 'Número de WhatsApp del cliente, si ya se conoce' },
        items:     { type: 'string', description: 'Productos elegidos (con cantidades) o nombre del servicio a reservar' },
        entrega:   { type: 'string', description: 'Tipo de entrega: "en el local", "para recoger", "a domicilio", o "reserva" en modo reservas' },
        direccion: { type: 'string', description: 'Dirección de entrega, si aplica' },
        paso:      { type: 'string', description: 'Paso actual del flujo (ej: tomando_productos, esperando_nombre, esperando_direccion, esperando_telefono, confirmado)' },
      },
    },
  },
};

const submitOrderTool = {
  type: 'function',
  function: {
    name: 'submit_order',
    description: 'Envía el pedido una vez el cliente confirmó todos los datos.',
    parameters: {
      type: 'object',
      properties: {
        cliente:   { type: 'string' },
        telefono:  { type: 'string', description: 'Número sin espacios ni guiones' },
        items:     { type: 'string' },
        entrega:   { type: 'string' },
        direccion: { type: 'string' },
        notas:     { type: 'string' },
      },
      required: ['cliente', 'items', 'entrega'],
    },
  },
};

const submitBookingTool = {
  type: 'function',
  function: {
    name: 'submit_booking',
    description: 'Envía la reserva una vez el cliente confirmó todos los datos.',
    parameters: {
      type: 'object',
      properties: {
        servicio:    { type: 'string' },
        servicio_id: { type: 'string', description: 'El ID entre corchetes [ID:...] de la lista de servicios' },
        fecha:       { type: 'string', description: 'YYYY-MM-DD, nunca texto libre ni DD/MM/YYYY' },
        hora:        { type: 'string', description: 'HH:MM en 24h, nunca "2pm" ni texto libre' },
        personas:    { type: 'integer' },
        cliente:     { type: 'string' },
        telefono:    { type: 'string' },
        notas:       { type: 'string' },
        precio:      { type: 'number' },
      },
      required: ['servicio', 'fecha', 'hora', 'cliente'],
    },
  },
};

// ── Model/provider resolution ─────────────────────────────────────────────────

interface ModelAttempt {
  endpoint: string;
  apiKey: string;
  model: string;
  extraHeaders?: Record<string, string>;
  timeoutMs: number;
}

function buildAttempts(business: BusinessRow): ModelAttempt[] {
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
        extraHeaders: { 'HTTP-Referer': 'https://domicircuspop.replit.app', 'X-Title': 'WhatOrden Menu AI' },
        timeoutMs: 7_000,
      },
      groqAttempt(DEFAULT_MODEL, 5_000), // degrade to free Qwen if Kimi/OpenRouter fails
    ];
  }

  const primaryModel = (business.ai_model && business.ai_model !== KIMI_MODEL_SENTINEL)
    ? business.ai_model
    : DEFAULT_MODEL;
  return [groqAttempt(primaryModel, 7_000), groqAttempt(FALLBACK_MODEL, 5_000)];
}

// ── Streaming call to a model attempt ─────────────────────────────────────────

interface StreamResult { toolCalls: Array<{ name: string; args: string }> }
type Emit = (obj: Record<string, unknown>) => Promise<void>;

async function runAttempt(
  attempt: ModelAttempt,
  messages: Array<{ role: string; content: string }>,
  tools: unknown[],
  emit: Emit,
  commit: { done: boolean },
): Promise<StreamResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), attempt.timeoutMs);
  try {
    const res = await fetch(attempt.endpoint, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${attempt.apiKey}`,
        'Content-Type': 'application/json',
        ...(attempt.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model: attempt.model, max_tokens: 500, temperature: 0.4,
        messages, tools, tool_choice: 'auto', stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`${attempt.model} HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotAny = false;
    const toolCallsAcc: Record<number, { name: string; args: string }> = {};

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let evt: Record<string, unknown>;
        try { evt = JSON.parse(payload); } catch { continue; }
        const choices = evt.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          gotAny = true;
          commit.done = true;
          await emit({ delta: delta.content });
        }

        const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls?.length) {
          gotAny = true;
          commit.done = true;
          for (const tc of toolCalls) {
            const idx = (tc.index as number) ?? 0;
            if (!toolCallsAcc[idx]) toolCallsAcc[idx] = { name: '', args: '' };
            const fn = tc.function as Record<string, unknown> | undefined;
            if (typeof fn?.name === 'string') toolCallsAcc[idx].name = fn.name;
            if (typeof fn?.arguments === 'string') toolCallsAcc[idx].args += fn.arguments;
          }
        }
      }
    }

    if (!gotAny) throw new Error(`${attempt.model} empty response`);
    return { toolCalls: Object.values(toolCallsAcc) };
  } finally {
    clearTimeout(timer);
  }
}

function extractToolPayloads(toolCalls: Array<{ name: string; args: string }>): { state?: OrderState; orderData?: OrderData; bookingData?: BookingData } {
  let state: OrderState | undefined;
  let orderData: OrderData | undefined;
  let bookingData: BookingData | undefined;
  for (const tc of toolCalls) {
    if (!tc.name || !tc.args) continue;
    try {
      const parsed = JSON.parse(tc.args);
      if (tc.name === 'update_order_state') state = parsed;
      else if (tc.name === 'submit_order') orderData = parsed;
      else if (tc.name === 'submit_booking') bookingData = parsed;
    } catch (e) {
      console.error('[menu-agent] tool-call arguments parse failed', { name: tc.name, raw: tc.args.slice(0, 300), error: String(e) });
    }
  }
  return { state, orderData, bookingData };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let body: { slug?: string; question?: string; history?: HistoryMessage[]; menuData?: ClientMenuData; orderState?: OrderState };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { slug, question, history = [], menuData, orderState } = body;

  if (!slug || !question?.trim()) {
    return new Response(JSON.stringify({ error: 'slug and question are required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (question.trim().length > MAX_QUESTION_LEN) {
    return new Response(JSON.stringify({ error: 'Question too long (max 500 chars)' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!Deno.env.get('GROQ_API_KEY')) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = supabaseAdmin();

  const businessCacheKey = `business:${slug}`;
  let business = cacheGet<BusinessRow>(businessCacheKey);
  if (business === undefined) {
    const { data } = await db
      .from('businesses')
      .select('id, name, description, ai_enabled, ai_prompt, ai_model, ai_knowledge_base, business_type, currency, plan')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();
    business = (data as BusinessRow | null) ?? undefined;
    if (business) cacheSet(businessCacheKey, business, BUSINESS_CACHE_TTL_MS);
  }

  if (!business?.ai_enabled) {
    return new Response(JSON.stringify({ error: 'AI not enabled for this business' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const isReservations = business.business_type === 'reservations';
  const knowledgeContext = buildKnowledgeContext(business.ai_knowledge_base ?? []);
  const orderStateContext = buildOrderStateContext(orderState);

  let systemPrompt: string;
  let tools: unknown[];

  if (isReservations) {
    const serviceContext = await buildServiceContext(db, business.id);

    const defaultBookingPrompt = `Eres un asistente virtual amable y conciso para ${business.name}, un negocio de reservas y citas.
Ayuda a los clientes a reservar servicios. Responde en máximo 2-3 oraciones por turno. Usa un tono cálido y profesional.
Si no encuentras un servicio disponible, dilo honestamente.
Responde en el mismo idioma que el cliente.`;

    const bookingCollectionBlock = `

TOMA DE RESERVAS — INSTRUCCIÓN OBLIGATORIA (se aplica aunque tengas un prompt personalizado):
Para hacer una reserva, recoge los siguientes datos uno por uno (no preguntes varios a la vez):
1. Qué servicio quiere reservar — debe ser uno de los listados (usa el nombre y su ID entre [ID:...])
2. Para cuántas personas (verifica que no supere el máximo del servicio)
3. Fecha deseada — convierte cualquier fecha relativa ("mañana", "el viernes") a formato YYYY-MM-DD. Hoy es ${new Date().toISOString().split('T')[0]}.
4. Hora preferida — convierte al formato HH:MM en 24h
5. Nombre completo del cliente
6. Número de WhatsApp — pregunta: "¿A qué número de WhatsApp te confirmamos la reserva?"

Mientras la reserva esté en curso, llama a la función update_order_state en CADA turno con todo lo que sepas hasta ahora, incluso si aún faltan datos.
Cuando tengas TODOS los datos y el cliente confirme, escribe tu mensaje de confirmación normal y llama a la función submit_booking con los datos completos.`;

    systemPrompt = [
      business.ai_prompt ?? defaultBookingPrompt,
      bookingCollectionBlock,
      serviceContext,
      knowledgeContext,
      business.description ? `\nDescripción del negocio: ${business.description}` : '',
      orderStateContext,
    ].filter(Boolean).join('');

    tools = [updateOrderStateTool, submitBookingTool];
  } else {
    const menuContext = menuData?.products?.length
      ? buildMenuContextFromData(menuData)
      : await buildMenuContextFromDB(db, business.id);

    const defaultPrompt = `Eres un asistente virtual amable y conciso para ${business.name}.
Responde preguntas sobre el menú, precios, disponibilidad y horarios en máximo 2-3 oraciones.
Usa un tono cálido. Si no encuentras algo en el menú, dilo honestamente.
NO inventes precios ni productos que no estén en el menú.
Los precios están en PESOS COLOMBIANOS (COP). Cuando menciones precios, di "pesos" o usa el formato numérico sin símbolo de moneda. NUNCA digas "dólares".
Responde en el mismo idioma que el cliente.

TOMA DE PEDIDOS:
Si el cliente quiere hacer un pedido por el chat, recoge los siguientes datos uno por uno (no preguntes todos a la vez):
1. Qué productos quiere y en qué cantidad
2. Su nombre completo
3. Tipo de entrega: "en el local", "para recoger" o "a domicilio"
4. Si es "a domicilio": dirección completa
5. Su número de WhatsApp (celular) — pregunta: "¿A qué número de WhatsApp te confirmamos el pedido?"
Cuando tengas TODOS los datos y el cliente confirme el pedido, escribe tu mensaje de confirmación normal y llama a la función submit_order con los datos completos.`;

    const orderBlock = `

TOMA DE PEDIDOS — INSTRUCCIÓN OBLIGATORIA (no omitir aunque tengas prompt personalizado):
Si el cliente quiere hacer un pedido, recoge estos datos uno por uno:
1. Qué productos quiere y en qué cantidad
2. Su nombre completo
3. Tipo de entrega: "en el local", "para recoger" o "a domicilio"
4. Si es "a domicilio": dirección completa
5. Su número de WhatsApp — pregunta: "¿A qué número de WhatsApp te confirmamos el pedido?"

MEMORIA DEL PEDIDO — MUY IMPORTANTE:
- Antes de pedir cualquier dato, revisa con cuidado TODO el historial de la conversación y la sección "DATOS YA CONFIRMADOS DE ESTE PEDIDO" (si aparece más abajo). Si el cliente ya dio un dato, NO lo vuelvas a preguntar — dalo por confirmado y continúa con el siguiente dato que falte.
- Nunca reinicies el pedido desde cero ni le pidas al cliente que repita información ya suministrada.
- En CADA respuesta mientras el pedido esté en curso (aunque falten datos), llama a la función update_order_state con TODO lo que sepas hasta ahora (deja vacíos los campos que aún no conoces) y el paso actual. Esta llamada es obligatoria en cada turno de un pedido en curso, incluso si aún faltan datos.

Cuando tengas TODOS los datos y el cliente confirme el pedido, escribe tu mensaje de confirmación normal y llama a la función submit_order con los datos completos.`;

    systemPrompt = [
      business.ai_prompt ?? defaultPrompt,
      orderBlock,
      menuContext,
      knowledgeContext,
      business.description ? `\nDescripción del negocio: ${business.description}` : '',
      orderStateContext,
    ].filter(Boolean).join('');

    tools = [updateOrderStateTool, submitOrderTool];
  }

  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-16)
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role, content: String(m.content) }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...safeHistory,
    { role: 'user', content: question.trim() },
  ];

  const attempts = buildAttempts(business);

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const emit: Emit = async (obj) => {
    await writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
  };

  (async () => {
    const commit = { done: false };
    let result: StreamResult | null = null;

    for (const attempt of attempts) {
      try {
        result = await runAttempt(attempt, messages, tools, emit, commit);
        break;
      } catch (e) {
        console.warn(`[menu-agent] attempt with ${attempt.model} failed:`, e);
        if (commit.done) break; // already streamed partial content — don't retry mid-stream
      }
    }

    try {
      if (!result) {
        await emit(commit.done
          ? { done: true, error: 'incomplete' }
          : { done: true, error: 'AI service temporarily unavailable' });
      } else {
        const { state, orderData, bookingData } = extractToolPayloads(result.toolCalls);
        await emit({ done: true, state, orderData, bookingData });
      }
    } catch (e) {
      console.error('[menu-agent] failed to emit terminal event:', e);
    }
    await writer.close();
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
});
