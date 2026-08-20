/**
 * sales-advisor v1 — Supabase Edge Function
 *
 * Director de Ventas IA: LLM chat for business owners.
 * Trained in LATAM small-restaurant commerce, with access to the
 * business's real data (menu, knowledge base, orders, customers).
 *
 * POST { business_id, session_id?, question, history[] }
 * Auth: Bearer <user JWT>
 * Returns: { answer: string, session_id: string }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const PRIMARY_MODEL  = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const MAX_Q_LEN      = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// ── Context builders ───────────────────────────────────────────────────────────

function buildKnowledgeContext(items: Array<{ type: string; title: string; content: string }>): string {
  if (!items?.length) return '';
  const lines = ['\n=== BASE DE CONOCIMIENTO DEL NEGOCIO ==='];
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
  const [catResult, prodResult] = await Promise.all([
    db.from('categories').select('id, name').eq('business_id', businessId).eq('is_active', true).order('position'),
    db.from('products').select('name, description, price, category_id').eq('business_id', businessId).eq('is_available', true).order('position'),
  ]);
  if (catResult.error) console.warn('[sales-advisor] categories query error:', catResult.error.message);
  if (prodResult.error) console.warn('[sales-advisor] products query error:', prodResult.error.message);
  const categories = catResult.data;
  const products   = prodResult.data;
  if (!categories?.length && !products?.length) return '';
  const catMap: Record<string, string> = {};
  for (const c of categories ?? []) catMap[c.id] = c.name;
  const byCat: Record<string, typeof products> = {};
  for (const p of products ?? []) {
    const cat = catMap[p.category_id] ?? 'Sin categoría';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat]!.push(p);
  }
  const lines = ['\n=== MENÚ ACTUAL ==='];
  for (const [cat, prods] of Object.entries(byCat)) {
    lines.push(`\n${cat}:`);
    for (const p of prods ?? []) {
      const price = p.price != null ? ` — $${p.price.toLocaleString('es-CO')}` : '';
      const desc  = p.description ? ` (${p.description})` : '';
      lines.push(`  • ${p.name}${price}${desc}`);
    }
  }
  return lines.join('\n');
}

async function buildBusinessMetrics(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: orders }, { data: customers }] = await Promise.all([
    db.from('orders')
      .select('id, total, status, customer_phone, customer_name, created_at, order_items(product_name, quantity)')
      .eq('business_id', businessId)
      .gte('created_at', since30d)
      .neq('status', 'cancelled'),
    db.from('customers')
      .select('name, phone, tags, created_at')
      .eq('business_id', businessId),
  ]);

  const completedOrders = (orders ?? []).filter(o => o.status === 'completed');
  const totalRevenue    = completedOrders.reduce((s, o) => s + (o.total ?? 0), 0);
  const avgTicket       = completedOrders.length > 0 ? totalRevenue / completedOrders.length : 0;

  const vipCustomers = (customers ?? []).filter(c => (c.tags as string[] | null)?.includes('VIP'));

  // Inactive customers (registered but no order in 30d)
  const activePhones = new Set((orders ?? []).map(o => o.customer_phone).filter(Boolean));
  const inactiveCustomers = (customers ?? []).filter(c => c.phone && !activePhones.has(c.phone));

  // Top 5 products by quantity sold (via embedded order_items)
  const productQty: Record<string, number> = {};
  for (const order of orders ?? []) {
    const items = (order as unknown as { order_items?: Array<{ product_name?: string; quantity?: number }> }).order_items ?? [];
    for (const item of items) {
      if (!item.product_name) continue;
      productQty[item.product_name] = (productQty[item.product_name] ?? 0) + (item.quantity ?? 1);
    }
  }
  const top5 = Object.entries(productQty)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  // Conversations (customers) without any completed order — potential lost sales
  const customersWithOrder = new Set(completedOrders.map(o => o.customer_phone).filter(Boolean));
  const noOrderCount = (customers ?? []).filter(c => c.phone && !customersWithOrder.has(c.phone)).length;

  const lines = ['\n=== MÉTRICAS DEL NEGOCIO (últimos 30 días) ==='];
  lines.push(`Pedidos completados: ${completedOrders.length}`);
  lines.push(`Pedidos en proceso: ${(orders ?? []).filter(o => !['completed','cancelled'].includes(o.status)).length}`);
  lines.push(`Ingresos estimados: $${Math.round(totalRevenue).toLocaleString('es-CO')}`);
  lines.push(`Ticket promedio: $${Math.round(avgTicket).toLocaleString('es-CO')}`);
  lines.push(`Total clientes registrados: ${(customers ?? []).length}`);
  lines.push(`Clientes VIP: ${vipCustomers.length}`);
  lines.push(`⚠ Clientes sin ninguna compra completada: ${noOrderCount} (posibles ventas perdidas)`);
  lines.push(`⚠ Clientes inactivos (sin pedido en 30 días): ${inactiveCustomers.length}`);

  if (top5.length > 0) {
    lines.push('\nTop 5 productos más vendidos:');
    top5.forEach(([name, qty], i) => lines.push(`  ${i + 1}. ${name} (${qty} unidades)`));
  }

  if (inactiveCustomers.length > 0) {
    const sample = inactiveCustomers.slice(0, 3).map(c => c.name || c.phone).join(', ');
    lines.push(`\nEjemplos de clientes a reactivar: ${sample}${inactiveCustomers.length > 3 ? ` y ${inactiveCustomers.length - 3} más` : ''}`);
  }

  return lines.join('\n');
}

async function buildServicesContext(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const { data: services } = await (db as any)
    .from('services')
    .select('name, description, price, duration_minutes, max_persons')
    .eq('business_id', businessId)
    .eq('is_available', true)
    .order('position');
  if (!services?.length) return '';
  const lines = ['\n=== SERVICIOS DISPONIBLES ==='];
  for (const s of services) {
    const price    = s.price != null ? ` — $${Number(s.price).toLocaleString('es-CO')}` : '';
    const duration = ` | ${s.duration_minutes} min`;
    const persons  = s.max_persons > 1 ? ` | máx. ${s.max_persons} personas` : '';
    const desc     = s.description ? ` (${s.description})` : '';
    lines.push(`  • ${s.name}${price}${duration}${persons}${desc}`);
  }
  return lines.join('\n');
}

async function buildBookingsMetrics(db: ReturnType<typeof supabaseAdmin>, businessId: string): Promise<string> {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: bookings } = await (db as any)
    .from('bookings')
    .select('id, service_name, service_price, status, booking_date, num_persons, created_at')
    .eq('business_id', businessId)
    .gte('created_at', since30d);

  if (!bookings) return '';

  const confirmed  = bookings.filter((b: any) => b.status === 'confirmed');
  const completed  = bookings.filter((b: any) => b.status === 'completed');
  const pending    = bookings.filter((b: any) => b.status === 'pending');
  const cancelled  = bookings.filter((b: any) => b.status === 'cancelled');
  const totalRevenue = completed.reduce((s: number, b: any) => s + (b.service_price ?? 0), 0);

  // Top services by booking count
  const svcCount: Record<string, number> = {};
  for (const b of bookings) {
    svcCount[b.service_name] = (svcCount[b.service_name] ?? 0) + 1;
  }
  const top3 = Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 3);

  // Upcoming bookings (future dates)
  const today = new Date().toISOString().split('T')[0];
  const upcoming = bookings.filter((b: any) => b.booking_date && b.booking_date >= today && b.status !== 'cancelled');

  const lines = ['\n=== MÉTRICAS DE RESERVAS (últimos 30 días) ==='];
  lines.push(`Reservas totales: ${bookings.length}`);
  lines.push(`Pendientes de confirmar: ${pending.length}`);
  lines.push(`Confirmadas: ${confirmed.length}`);
  lines.push(`Completadas: ${completed.length}`);
  lines.push(`Canceladas: ${cancelled.length}`);
  lines.push(`Ingresos estimados (completadas): $${Math.round(totalRevenue).toLocaleString('es-CO')}`);
  lines.push(`Próximas reservas (hoy en adelante): ${upcoming.length}`);
  if (top3.length > 0) {
    lines.push('\nServicios más reservados:');
    top3.forEach(([name, cnt], i) => lines.push(`  ${i + 1}. ${name} (${cnt} reservas)`));
  }
  return lines.join('\n');
}

// ── Groq call ──────────────────────────────────────────────────────────────────

async function callGroq(
  model: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) throw new Error('GROQ_API_KEY not configured');

  const res = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    signal,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 600, temperature: 0.5, messages }),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!content) throw new Error('Empty response');
  return content;
}

// ── Main ───────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  // Auth — requires valid user JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient  = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { business_id: string; session_id?: string; question: string; history?: Array<{ role: string; content: string }> };
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { business_id, session_id, question, history = [] } = body;
  if (!business_id || !question?.trim()) {
    return new Response(JSON.stringify({ error: 'business_id and question required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const db = supabaseAdmin();

  // Verify business belongs to this user
  const { data: business } = await db
    .from('businesses')
    .select('id, name, description, delivery_zone, ai_knowledge_base, currency, business_type')
    .eq('id', business_id)
    .eq('owner_id', user.id)
    .maybeSingle();

  if (!business) {
    return new Response(JSON.stringify({ error: 'Business not found or access denied' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const q = question.trim().slice(0, MAX_Q_LEN);

  const isReservations = (business as any).business_type === 'reservations';

  // Load context in parallel (menu/services, metrics, prior sessions)
  const [catalogContext, metricsContext, priorSessionsRaw] = await Promise.all([
    isReservations ? buildServicesContext(db, business_id) : buildMenuContext(db, business_id),
    isReservations ? buildBookingsMetrics(db, business_id) : buildBusinessMetrics(db, business_id),
    db.from('advisor_sessions')
      .select('title, messages, updated_at')
      .eq('business_id', business_id)
      .neq('id', session_id ?? '00000000-0000-0000-0000-000000000000')
      .order('updated_at', { ascending: false })
      .limit(3),
  ]);
  const menuContext = catalogContext; // alias for template string below
  const knowledgeContext = buildKnowledgeContext((business.ai_knowledge_base as Array<{ type: string; title: string; content: string }>) ?? []);

  // Build lightweight prior-session context
  let priorSessionsContext = '';
  if (priorSessionsRaw.data?.length) {
    const lines = ['\n=== CONVERSACIONES ANTERIORES CONTIGO (resumen) ==='];
    for (const s of priorSessionsRaw.data) {
      const msgs = (s.messages as Array<{ role: string; content: string }>) ?? [];
      const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
      const lastUser = [...msgs].reverse().find(m => m.role === 'user');
      const title = s.title ?? 'Sin título';
      if (lastUser || lastAssistant) {
        lines.push(`\nSesión: "${title}"`);
        if (lastUser) lines.push(`  Dueño preguntó: ${lastUser.content.slice(0, 120)}`);
        if (lastAssistant) lines.push(`  Tu respuesta: ${lastAssistant.content.slice(0, 200)}`);
      }
    }
    priorSessionsContext = lines.join('\n');
  }

  // ── System prompt — LATAM Director de Ventas ──────────────────────────────

  const systemPrompt = `Eres el Director de Ventas IA de ${business.name}. Eres un experto en ventas y marketing para restaurantes pequeños y negocios de comida en Latinoamérica. Hablas directamente con el dueño del negocio en tono cercano, profesional y muy práctico.

REGLAS FUNDAMENTALES:
- Nunca das respuestas genéricas. Siempre usas los datos reales del negocio que tienes disponibles.
- Eres directo. Propones acciones concretas que el dueño puede hacer HOY.
- Hablas como un socio comercial, no como un asistente de software.
- Cuando des consejos de marketing o ventas, proporciona ejemplos listos para copiar (mensajes de WhatsApp, textos para Stories, etc).
- Si el dueño pregunta algo fuera de tu área (tecnología, contabilidad profunda, legal), lo reconoces y lo redirigiste a ventas y clientes.

CONOCIMIENTO ESPECIALIZADO EN LATAM:

COMPORTAMIENTO DEL COMPRADOR LATINOAMERICANO:
- Decide por: precio, foto atractiva del producto, recomendación de amigo o familiar, rapidez de respuesta
- Compara por WhatsApp antes de decidir — si no respondes en menos de 5 minutos, compra en otro lado
- El 78% de los pedidos de comida en LATAM se coordinan por WhatsApp
- Desconfía de links externos y formularios complicados — prefiere pedir directo por chat
- El precio psicológico funciona: $19.900 se percibe muy diferente a $20.000
- Los combos y "promos del día" tienen 40% más conversión que productos individuales

CANALES QUE FUNCIONAN EN LATAM (por efectividad):
1. WhatsApp: Status (historia de 24h), Lista de difusión a clientes frecuentes, grupos de barrio/edificio
2. Instagram Stories (no el feed — el feed orgánico ya no funciona para negocios locales)
3. TikTok: videos de cocina en tiempo real, sin producción — lo auténtico vende más
4. Facebook: grupos locales del barrio, no el perfil del negocio
5. Google Maps: las reseñas son clave — un negocio con 50 reseñas con 4.5 estrellas supera a uno sin reseñas

MÉTODOS DE PAGO POPULARES EN LATAM:
- Colombia: Nequi, Daviplata, Efecty, PSE, efectivo (siempre ofrecer efectivo)
- México: OXXO, Mercado Pago, transferencia SPEI, efectivo
- Perú: Yape, Plin, BCP, efectivo
- Argentina: Mercado Pago, transferencia CBU, efectivo
- Chile: Webpay, Mercado Pago, transferencia, efectivo
- REGLA DE ORO: siempre aceptar efectivo — el 40% de las transacciones de comida en LATAM son en efectivo

HORARIOS PICO:
- Almuerzo: 11:30am — 2:00pm (pico máximo de pedidos)
- Cena: 6:30pm — 9:00pm
- Fin de semana: domingo almuerzo es el mejor momento del mes
- Días de quincena (15 y 30/31): ventas 25-35% más altas
- Evitar publicitar en: lunes 8am-10am (la gente está en modo trabajo, no comida)

ESTRATEGIAS DE BAJO COSTO QUE FUNCIONAN:
- "El combo del día" con foto — publica a las 10:30am todos los días
- "Trae un amigo y tu próximo pedido tiene 10% de descuento"
- Sorteos simples en WhatsApp Status: "Comparte y gana un almuerzo gratis"
- Sticker pack del negocio para WhatsApp — los clientes los usan y hacen publicidad gratis
- Mensaje post-entrega: "¿Cómo estuvo? Déjanos una reseña en Google Maps [link]"
- "Menú secreto" — productos especiales que solo se piden por WhatsApp (crea exclusividad)

ERRORES COMUNES DEL DUEÑO DE RESTAURANTE PEQUEÑO EN LATAM:
- No tener foto de cada producto (un producto sin foto vende 5x menos)
- Publicar en redes "cuando tiene tiempo" en lugar de a horario fijo
- No responder WhatsApp en menos de 5 minutos
- Poner precio sin especificar si incluye envío (genera fricción y abandono)
- Copiar estrategias de cadenas grandes (no aplican para negocio local)
- No pedir reseñas a los clientes satisfechos
- No tener lista de difusión de WhatsApp con sus clientes frecuentes

FIDELIZACIÓN SIN INVERSIÓN:
- Lista de difusión en WhatsApp: enviar "el especial de hoy" cada mañana
- Recordar el nombre del cliente y su pedido habitual
- Mensaje de cumpleaños con descuento (si tienes el número, puedes buscar la fecha)
- "Ya extrañábamos tu pedido" — mensaje a clientes que no compran en 2 semanas
- Tarjeta digital de puntos: "cada 10 pedidos, el siguiente con 20% de descuento"

DATOS DEL NEGOCIO:
Nombre: ${business.name}
${business.description ? `Descripción: ${business.description}` : ''}
${business.delivery_zone ? `Zona de entrega: ${business.delivery_zone}` : ''}
${menuContext}
${knowledgeContext}
${metricsContext}
${priorSessionsContext}`;

  // ── Build messages ─────────────────────────────────────────────────────────

  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .filter(m => m.role && m.content)
    .map(m => ({ role: m.role as string, content: String(m.content) }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...safeHistory,
    { role: 'user', content: q },
  ];

  // ── Call Groq with fallback ────────────────────────────────────────────────

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 15_000);

  let answer = '';
  try {
    answer = await callGroq(PRIMARY_MODEL, messages, ctrl.signal);
  } catch (e) {
    console.warn('[sales-advisor] Primary model failed, trying fallback:', e);
    try {
      answer = await callGroq(FALLBACK_MODEL, messages, ctrl.signal);
    } catch (e2) {
      console.error('[sales-advisor] Both models failed:', e2);
    }
  } finally {
    clearTimeout(timeout);
  }

  if (!answer) {
    return new Response(
      JSON.stringify({ error: 'AI service temporarily unavailable' }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  // ── Persist session ────────────────────────────────────────────────────────

  const newMessages = [
    ...safeHistory,
    { role: 'user', content: q },
    { role: 'assistant', content: answer },
  ];

  let finalSessionId = session_id ?? '';

  if (session_id) {
    // Update existing session
    await db
      .from('advisor_sessions')
      .update({ messages: newMessages, updated_at: new Date().toISOString() })
      .eq('id', session_id)
      .eq('business_id', business_id);
  } else {
    // Create new session — title = first question truncated to 40 chars
    const title = q.slice(0, 40) + (q.length > 40 ? '…' : '');
    const { data: newSession } = await db
      .from('advisor_sessions')
      .insert({ business_id, title, messages: newMessages })
      .select('id')
      .single();
    finalSessionId = newSession?.id ?? '';
  }

  return new Response(
    JSON.stringify({ answer, session_id: finalSessionId }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
