/**
 * menu-agent v5 — Supabase Edge Function
 * Public AI assistant for the customer-facing menu/reservations page.
 *
 * Accepts: POST { slug, question, history, menuData? }
 *   menuData: { categories: {name}[], products: {name, price, description, categoryName}[] }
 *   If menuData is provided, skips the DB query for menu (faster).
 *
 * Returns: { answer: string }
 * No auth required (verify_jwt: false). No DB writes.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_MODEL  = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_QUESTION_LEN = 500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface HistoryMessage { role: 'user' | 'assistant'; content: string }
interface KnowledgeItem  { type: string; title: string; content: string }
interface OrderState { cliente?: string; telefono?: string; items?: string; entrega?: string; direccion?: string; paso?: string }

interface ClientProduct  { name: string; price: number; description?: string | null; categoryName: string }
interface ClientMenuData { products: ClientProduct[] }

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
  const [{ data: categories }, { data: products }] = await Promise.all([
    db.from('categories').select('id, name').eq('business_id', businessId).eq('is_active', true).order('position'),
    db.from('products').select('name, description, price, category_id').eq('business_id', businessId).eq('is_available', true).order('name'),
  ]);
  if (!categories?.length && !products?.length) return '';

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
  return lines.join('\n');
}

async function buildServiceContext(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const { data: services } = await db
    .from('services' as any)
    .select('id, name, description, price, duration_minutes, max_persons')
    .eq('business_id', businessId)
    .eq('is_available', true)
    .order('position');

  if (!services?.length) return '';

  const lines: string[] = ['\n=== SERVICIOS DISPONIBLES ==='];
  for (const s of services) {
    const price = s.price != null ? ` — $${Number(s.price).toLocaleString('es-CO')}` : '';
    const duration = ` | ${s.duration_minutes} minutos`;
    const persons = s.max_persons > 1 ? ` | hasta ${s.max_persons} personas` : '';
    const desc = s.description ? `\n    ${s.description}` : '';
    lines.push(`  • [ID:${s.id}] ${s.name}${price}${duration}${persons}${desc}`);
  }
  return lines.join('\n');
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

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'AI not configured' }), {
      status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const db = supabaseAdmin();

    const { data: business } = await db
      .from('businesses')
      .select('id, name, description, ai_enabled, ai_prompt, ai_model, ai_knowledge_base, business_type, currency')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle();

    if (!business?.ai_enabled) {
      return new Response(JSON.stringify({ error: 'AI not enabled for this business' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isReservations = (business as any).business_type === 'reservations';
    const knowledgeContext = buildKnowledgeContext((business.ai_knowledge_base as KnowledgeItem[]) ?? []);
    const orderStateContext = buildOrderStateContext(orderState);

    let systemPrompt: string;

    if (isReservations) {
      // ── Reservations mode ──────────────────────────────────────────────────
      const serviceContext = await buildServiceContext(db, business.id);

      const defaultBookingPrompt = `Eres un asistente virtual amable y conciso para ${business.name}, un negocio de reservas y citas.
Ayuda a los clientes a reservar servicios. Responde en máximo 2-3 oraciones por turno. Usa un tono cálido y profesional.
Si no encuentras un servicio disponible, dilo honestamente.
Responde en el mismo idioma que el cliente.`;`;

      // Booking collection block — always appended even for custom ai_prompt
      // (mirrors how orderBlock is always appended in products mode)
      const bookingCollectionBlock = `

TOMA DE RESERVAS — INSTRUCCIÓN OBLIGATORIA (se aplica aunque tengas un prompt personalizado):
Para hacer una reserva, recoge los siguientes datos uno por uno (no preguntes varios a la vez):
1. Qué servicio quiere reservar — debe ser uno de los listados (usa el nombre y su ID entre [ID:...])
2. Para cuántas personas (verifica que no supere el máximo del servicio)
3. Fecha deseada — convierte cualquier fecha relativa ("mañana", "el viernes") a formato YYYY-MM-DD. Hoy es ${new Date().toISOString().split('T')[0]}.
4. Hora preferida — convierte al formato HH:MM en 24h
5. Nombre completo del cliente
6. Número de WhatsApp — pregunta: "¿A qué número de WhatsApp te confirmamos la reserva?"

MEMORIA DE RESERVA EN CURSO — en CADA respuesta mientras la reserva esté en curso, añade al final:
[STATE:{"cliente":"","telefono":"","items":"NOMBRE_SERVICIO","entrega":"reserva","direccion":"","paso":"PASO_ACTUAL"}]
(paso puede ser: "eligiendo_servicio","esperando_personas","esperando_fecha","esperando_hora","esperando_nombre","esperando_telefono","confirmado")
No expliques ni menciones esta etiqueta al cliente.

Cuando tengas TODOS los datos y el cliente confirme, escribe tu mensaje de confirmación y añade EXACTAMENTE este tag (sin explicarlo):
[BOOKING:{"servicio":"NOMBRE_SERVICIO","servicio_id":"ID_DEL_SERVICIO","fecha":"YYYY-MM-DD","hora":"HH:MM","personas":1,"cliente":"NOMBRE_CLIENTE","telefono":"NUMERO","notas":"NOTAS_OPCIONALES","precio":0}]

REGLAS ESTRICTAS del tag BOOKING:
- "fecha" DEBE ser YYYY-MM-DD. NUNCA texto libre ni formato DD/MM/YYYY.
- "hora" DEBE ser HH:MM en 24h. NUNCA "2pm" ni texto libre.
- "servicio_id" es el ID entre corchetes [ID:...] de la lista de servicios.
- "personas" es un número entero. No puede superar el máximo del servicio.
- No pongas STATE y BOOKING en el mismo turno — cuando hay BOOKING ya no hay STATE.`;

      systemPrompt = [
        business.ai_prompt ?? defaultBookingPrompt,
        bookingCollectionBlock,
        orderStateContext,
        serviceContext,
        knowledgeContext,
        business.description ? `\nDescripción del negocio: ${business.description}` : '',
      ].filter(Boolean).join('');

    } else {
      // ── Products mode (existing behavior) ────────────────────────────────
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
Cuando tengas TODOS los datos y el cliente confirme el pedido, escribe tu mensaje de confirmación normal y al final añade EXACTAMENTE esta línea (sin explicarla, sin salto de línea extra antes):
[ORDER:{"cliente":"NOMBRE_CLIENTE","telefono":"NUMERO_SIN_ESPACIOS_NI_GUIONES","items":"LISTA_ITEMS","entrega":"TIPO_ENTREGA","direccion":"DIRECCION_O_VACIO","notas":"NOTAS_OPCIONALES"}]`;

      // ORDER block is always appended — even when a custom ai_prompt is set
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
- En CADA respuesta mientras el pedido esté en curso (aunque falten datos), añade al final, en una línea aparte, una etiqueta oculta con TODO lo que sabes hasta ahora (deja "" en los campos que aún no conoces) y el paso actual ("tomando_productos", "esperando_nombre", "esperando_entrega", "esperando_direccion", "esperando_telefono", "confirmado"):
[STATE:{"cliente":"","telefono":"","items":"","entrega":"","direccion":"","paso":""}]
- Esta etiqueta STATE es obligatoria en cada turno de un pedido en curso, incluso si aún faltan datos. No la expliques ni la menciones al cliente.

Cuando tengas TODOS los datos y el cliente confirme el pedido, escribe tu mensaje de confirmación normal y al final añade EXACTAMENTE esta línea (sin explicarla):
[ORDER:{"cliente":"NOMBRE_CLIENTE","telefono":"NUMERO_SIN_ESPACIOS_NI_GUIONES","items":"LISTA_ITEMS","entrega":"TIPO_ENTREGA","direccion":"DIRECCION_O_VACIO","notas":"NOTAS_OPCIONALES"}]`;

      systemPrompt = [
        business.ai_prompt ?? defaultPrompt,
        orderBlock,
        orderStateContext,
        menuContext,
        knowledgeContext,
        business.description ? `\nDescripción del negocio: ${business.description}` : '',
      ].filter(Boolean).join('');
    }

    const safeHistory = (Array.isArray(history) ? history : [])
      .slice(-10)
      .filter(m => m.role && m.content)
      .map(m => ({ role: m.role, content: String(m.content) }));

    const primaryModel = (business.ai_model as string) || DEFAULT_MODEL;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...safeHistory,
      { role: 'user', content: question.trim() },
    ];

    // ── Direct call + single retry ───────────────────────────────────────────
    const ctrl = new AbortController();
    const wallTimeout = setTimeout(() => ctrl.abort(), 11_000);

    const callModel = async (model: string): Promise<string> => {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 420, temperature: 0.4, messages }),
      });
      if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const raw = await res.json() as Record<string, unknown>;
      const content = (raw.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content?.trim() ?? '';
      if (!content) throw new Error(`${model} empty`);
      return content;
    };

    let answer = '';
    try {
      answer = await callModel(primaryModel);
    } catch (e) {
      console.warn('[menu-agent] Primary model failed, retrying with fallback:', e);
      try {
        answer = await callModel(FALLBACK_MODEL);
      } catch (e2) {
        console.error('[menu-agent] Fallback also failed:', e2);
      }
    } finally {
      clearTimeout(wallTimeout);
    }

    if (!answer) {
      return new Response(
        JSON.stringify({ error: 'AI service temporarily unavailable' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ answer }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[menu-agent] error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
