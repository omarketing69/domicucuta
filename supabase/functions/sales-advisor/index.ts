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

// Tells the agent what plan the business is on and which broadcast channels
// are actually usable, so it can recommend the right next step (connect
// WhatsApp, configure Twilio, or upgrade) instead of generic advice — and
// never claims a channel is available when it isn't.
function buildPlanContext(business: {
  plan?: string | null; plan_expires_at?: string | null;
  wa_phone_number_id?: string | null; wa_access_token?: string | null;
  twilio_account_sid?: string | null; twilio_whatsapp_number?: string | null; twilio_sms_number?: string | null;
}): string {
  const isPro = business.plan === 'pro' &&
    !(business.plan_expires_at && new Date(business.plan_expires_at) < new Date());
  const planLabel = isPro ? 'Pro' : (business.plan === 'starter' ? 'Starter' : 'Gratis');
  const waConnected = !!(business.wa_phone_number_id && business.wa_access_token);
  const twilioConfigured = !!(business.twilio_account_sid && (business.twilio_whatsapp_number || business.twilio_sms_number));

  const lines = ['\n=== PLAN Y FUNCIONES DE ENVÍO MASIVO ==='];
  lines.push(`Plan actual del negocio: ${planLabel}`);
  lines.push(
    waConnected
      ? 'Difusión masiva por WhatsApp (número propio, en Acciones → Difusión masiva): disponible ahora mismo, cualquier plan.'
      : 'Difusión masiva por WhatsApp (número propio): disponible en cualquier plan, pero este negocio aún no conectó su número de WhatsApp en Configuración.',
  );
  lines.push(
    isPro
      ? `Difusión masiva por Twilio (SMS y WhatsApp adicional, en Acciones → Difusión masiva): ${twilioConfigured ? 'disponible, ya tiene credenciales de Twilio configuradas' : 'disponible en este plan, pero todavía debe configurar sus credenciales de Twilio en Configuración'}.`
      : 'Difusión masiva por Twilio (SMS y WhatsApp adicional, útil para llegar a clientes sin WhatsApp o separar el tráfico masivo de su número propio): requiere el Plan Pro — este negocio no lo tiene.',
  );
  return lines.join('\n');
}

// Plan Pro only — organic reach/impressions/follower metrics from Meta's
// Page/Instagram Insights API (read_insights scope, granted by the same
// "Conectar Instagram/Facebook" OAuth flow). This is separate from paid Ads
// performance (spend, CPM, ROAS), which needs the much more sensitive
// ads_read permission and isn't built yet — never claim or infer ad-spend
// data from this. Every call is wrapped and skips silently on failure, since
// Meta's insights metric names/periods change over time and a business may
// not have insufficient history yet.
async function buildMetaInsightsContext(business: {
  ig_page_id?: string | null; ig_access_token?: string | null;
  fb_page_id?: string | null; fb_page_token?: string | null;
}): Promise<string> {
  const lines: string[] = [];

  if (business.ig_page_id && business.ig_access_token) {
    try {
      const [profileRes, insightsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/${business.ig_page_id}?fields=followers_count,media_count&access_token=${encodeURIComponent(business.ig_access_token)}`),
        fetch(`https://graph.facebook.com/v19.0/${business.ig_page_id}/insights?metric=reach&period=day&metric_type=total_value&access_token=${encodeURIComponent(business.ig_access_token)}`),
      ]);
      const igLines: string[] = [];
      if (profileRes.ok) {
        const profile = await profileRes.json() as { followers_count?: number; media_count?: number };
        if (profile.followers_count != null) igLines.push(`Seguidores: ${profile.followers_count}`);
        if (profile.media_count != null) igLines.push(`Publicaciones totales: ${profile.media_count}`);
      }
      if (insightsRes.ok) {
        const insights = await insightsRes.json() as { data?: Array<{ name?: string; total_value?: { value?: number } }> };
        const reach = insights.data?.find(d => d.name === 'reach')?.total_value?.value;
        if (reach != null) igLines.push(`Alcance (últimos días): ${reach} cuentas alcanzadas`);
      }
      if (igLines.length) {
        lines.push('\n=== MÉTRICAS DE INSTAGRAM (Plan Pro) ===');
        lines.push(...igLines.map(l => `- ${l}`));
      }
    } catch (e) {
      console.warn('[sales-advisor] Instagram insights fetch threw:', e);
    }
  }

  if (business.fb_page_id && business.fb_page_token) {
    try {
      const [pageRes, insightsRes] = await Promise.all([
        fetch(`https://graph.facebook.com/v19.0/${business.fb_page_id}?fields=fan_count&access_token=${encodeURIComponent(business.fb_page_token)}`),
        fetch(`https://graph.facebook.com/v19.0/${business.fb_page_id}/insights?metric=page_impressions,page_engaged_users&period=days_28&access_token=${encodeURIComponent(business.fb_page_token)}`),
      ]);
      const fbLines: string[] = [];
      if (pageRes.ok) {
        const page = await pageRes.json() as { fan_count?: number };
        if (page.fan_count != null) fbLines.push(`Seguidores de la Página: ${page.fan_count}`);
      }
      if (insightsRes.ok) {
        const insights = await insightsRes.json() as { data?: Array<{ name?: string; values?: Array<{ value?: number }> }> };
        for (const metric of insights.data ?? []) {
          const latest = metric.values?.[metric.values.length - 1]?.value;
          if (latest == null) continue;
          if (metric.name === 'page_impressions') fbLines.push(`Impresiones (últimos 28 días): ${latest}`);
          if (metric.name === 'page_engaged_users') fbLines.push(`Personas que interactuaron (últimos 28 días): ${latest}`);
        }
      }
      if (fbLines.length) {
        lines.push('\n=== MÉTRICAS DE FACEBOOK (Plan Pro) ===');
        lines.push(...fbLines.map(l => `- ${l}`));
      }
    } catch (e) {
      console.warn('[sales-advisor] Facebook insights fetch threw:', e);
    }
  }

  return lines.join('\n');
}

interface SocialPost {
  caption?: string;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
  permalink?: string;
}

// Read-only — available on every plan. Uses whichever credentials the
// business has connected (via the "Conectar Instagram/Facebook" OAuth flow
// or the manual Pro-plan token fields); silently skips if neither is set,
// so businesses that haven't connected yet still get a normal response.
async function buildSocialContext(business: {
  ig_page_id?: string | null; ig_access_token?: string | null;
  fb_page_id?: string | null; fb_page_token?: string | null;
}): Promise<string> {
  const lines: string[] = [];

  if (business.ig_page_id && business.ig_access_token) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${business.ig_page_id}/media?fields=caption,like_count,comments_count,timestamp,permalink&limit=10&access_token=${encodeURIComponent(business.ig_access_token)}`,
      );
      if (res.ok) {
        const { data } = await res.json() as { data: SocialPost[] };
        if (data?.length) {
          lines.push('\n=== PUBLICACIONES RECIENTES DE INSTAGRAM ===');
          for (const p of data) {
            const date = p.timestamp ? new Date(p.timestamp).toLocaleDateString('es-CO') : '?';
            const caption = (p.caption ?? '(sin texto)').slice(0, 150);
            lines.push(`- [${date}] "${caption}" — ${p.like_count ?? 0} likes, ${p.comments_count ?? 0} comentarios`);
          }
        }
      } else {
        console.warn('[sales-advisor] Instagram media fetch failed:', res.status);
      }
    } catch (e) {
      console.warn('[sales-advisor] Instagram media fetch threw:', e);
    }
  }

  if (business.fb_page_id && business.fb_page_token) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/${business.fb_page_id}/posts?fields=message,created_time,permalink_url,reactions.summary(total_count),comments.summary(total_count),shares&limit=10&access_token=${encodeURIComponent(business.fb_page_token)}`,
      );
      if (res.ok) {
        const { data } = await res.json() as {
          data: Array<{
            message?: string; created_time?: string;
            reactions?: { summary?: { total_count?: number } };
            comments?: { summary?: { total_count?: number } };
            shares?: { count?: number };
          }>
        };
        if (data?.length) {
          lines.push('\n=== PUBLICACIONES RECIENTES DE FACEBOOK ===');
          for (const p of data) {
            const date = p.created_time ? new Date(p.created_time).toLocaleDateString('es-CO') : '?';
            const message = (p.message ?? '(sin texto)').slice(0, 150);
            const reactions = p.reactions?.summary?.total_count ?? 0;
            const comments = p.comments?.summary?.total_count ?? 0;
            const shares = p.shares?.count ?? 0;
            lines.push(`- [${date}] "${message}" — ${reactions} reacciones, ${comments} comentarios, ${shares} compartidos`);
          }
        }
      } else {
        console.warn('[sales-advisor] Facebook posts fetch failed:', res.status);
      }
    } catch (e) {
      console.warn('[sales-advisor] Facebook posts fetch threw:', e);
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
    .select('id, name, description, delivery_zone, ai_knowledge_base, currency, business_type, ig_page_id, ig_access_token, fb_page_id, fb_page_token, plan, plan_expires_at, wa_phone_number_id, wa_access_token, twilio_account_sid, twilio_whatsapp_number, twilio_sms_number')
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
  const isProPlan = business.plan === 'pro' &&
    !(business.plan_expires_at && new Date(business.plan_expires_at as string) < new Date());

  // Load context in parallel (menu/services, metrics, prior sessions)
  const [catalogContext, metricsContext, priorSessionsRaw, socialContext, metaInsightsContext] = await Promise.all([
    isReservations ? buildServicesContext(db, business_id) : buildMenuContext(db, business_id),
    isReservations ? buildBookingsMetrics(db, business_id) : buildBusinessMetrics(db, business_id),
    db.from('advisor_sessions')
      .select('title, messages, updated_at')
      .eq('business_id', business_id)
      .neq('id', session_id ?? '00000000-0000-0000-0000-000000000000')
      .order('updated_at', { ascending: false })
      .limit(3),
    buildSocialContext(business),
    isProPlan ? buildMetaInsightsContext(business) : Promise.resolve(''),
  ]);
  const menuContext = catalogContext; // alias for template string below
  const knowledgeContext = buildKnowledgeContext((business.ai_knowledge_base as Array<{ type: string; title: string; content: string }>) ?? []);
  const planContext = buildPlanContext(business);

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

  const systemPrompt = `Eres el Director de Ventas IA de ${business.name}. Eres un experto en marketing digital y ventas online para negocios pequeños de Latinoamérica: marketing orgánico y pago en Meta (Facebook/Instagram), redacción de mensajes de venta por WhatsApp y SMS, y estrategia de ventas online en general — no solo lo específico de restaurantes o comida. Hablas directamente con el dueño del negocio en tono cercano, profesional y muy práctico.

REGLAS FUNDAMENTALES:
- Nunca das respuestas genéricas. Siempre usas los datos reales del negocio que tienes disponibles.
- Eres directo. Propones acciones concretas que el dueño puede hacer HOY.
- Hablas como un socio comercial, no como un asistente de software.
- Cuando des consejos de marketing o ventas, proporciona ejemplos listos para copiar (mensajes de WhatsApp, textos para Stories, etc).
- Si el dueño pregunta algo fuera de tu área (tecnología, contabilidad profunda, legal), lo reconoces y lo redirigiste a ventas y clientes.
- Sobre publicidad paga en Meta: puedes asesorar con tu conocimiento general de estrategia, pero no tienes acceso a los datos reales de campañas pagas del negocio (solo a sus publicaciones orgánicas) — si el dueño pregunta por el resultado de una campaña específica, acláraselo y pídele que te cuente lo que él ve en su Administrador de Anuncios para poder ayudarlo con eso.

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

MÁS ESTRATEGIAS DE MARKETING PARA SUGERIR (según lo que el dueño pregunte o lo que muestren sus datos):
- Alianzas con negocios vecinos: cross-promoción con un negocio complementario cercano (ej. una peluquería y una manicurista del mismo sector se recomiendan mutuamente con un cupón cruzado)
- Micro-creadores locales del barrio: en vez de influencers grandes y caros, dar una cortesía a 3-5 personas con 500-5.000 seguidores locales a cambio de una publicación — mucho más barato y efectivo que pauta paga
- Día temático fijo cada semana ("martes 2x1", "jueves de postre gratis") — crea hábito y hace que el cliente ya sepa cuándo volver
- Referido con recompensa doble: no solo premia a quien recomienda, también a quien llega recomendado
- Testimonios en video corto: pedirle al cliente satisfecho un video de 10 segundos con el celular al momento de la entrega/salida — convierte mucho más que el texto
- Encuesta relámpago post-compra por WhatsApp: una sola pregunta ("¿qué te gustaría que agreguemos?") — genera datos reales y hace sentir al cliente escuchado
- Preventa de lanzamientos: cuando saque un producto/servicio nuevo, abrir reservas con anticipo antes de invertir en producción — valida demanda real
- Empaque/recibo que vende: un sticker o nota con el WhatsApp/Instagram en la bolsa o factura, para que quien recibe el pedido (no solo quien lo pidió) también conozca el negocio
- "Cumplemés" del negocio: cada mes celebrar algo (aniversario, hito de X pedidos, cliente número 100) como excusa recurrente para comunicar sin que se sienta como venta constante
- Presencia en ferias/eventos locales: un stand pequeño con muestras gratis, enfocado en recolectar contactos para la lista de difusión, no en vender ahí mismo

CÓMO HACER PUBLICACIONES Y VIDEOS QUE LOGRAN MÁS ALCANCE:
- El gancho de los primeros 3 segundos: sin un gancho fuerte al inicio, la plataforma no distribuye el video, sin importar qué tan bueno sea el resto. Ganchos que funcionan: mostrar el resultado final primero ("así queda listo esto"), una pregunta directa, un problema relatable, un número llamativo. Nunca empezar con el logo girando o una intro larga.
- Duración y formato: 15-30 segundos es el punto dulce para Reels/TikTok de negocio pequeño — suficiente para generar interés, corto para verse completo (la retención completa importa mucho). Vertical, pantalla completa, sin bordes ni marcos exagerados. Cortes cada 2-3 segundos, texto en pantalla (mucha gente ve sin sonido).
- Un solo llamado a la acción (CTA) por publicación, claro y de un solo paso: "Escríbenos 'QUIERO' y te mandamos el menú" convierte más que "visita nuestra web y llena el formulario". No mezclar varios CTA en un mismo post (seguir + comentar + compartir + comprar diluye).
- Publica variedad, no un solo intento: un post no es una muestra suficiente para saber qué funciona — publica varias variaciones (mismo producto, gancho o formato distinto) antes de sacar conclusiones. No abandones una idea por un solo post que no pegó.
- Consistencia y reciclaje: mejor publicar 3-4 veces por semana con el celular que 1 vez al mes "perfecto". Si un gancho o formato funcionó bien, repetirlo con otro producto en vez de reinventar cada vez.

POR QUÉ ALGO SE VUELVE VIRAL (Y POR QUÉ NO SE PUEDE FORZAR):
- La viralidad no se puede predecir, ni con el mejor contenido — por eso la estrategia correcta no es buscar la fórmula mágica de un post, sino publicar variado y seguido.
- Compartir información es fácil, pero lograr que alguien compre necesita refuerzo repetido: un post viral da vistas, no ventas automáticas — para eso sirve más el contacto repetido (lista de difusión, recordarle al cliente que existes varias veces) que un solo post con mucho alcance.
- La diversidad de conceptos rinde más que variar solo lo cosmético: no se trata de cambiar el color del texto del mismo video, sino de probar ángulos genuinamente distintos (mostrar el producto, mostrar el proceso, un testimonio de cliente).
- Cuando un tipo de contenido deja de funcionar, cambia el concepto, no solo el producto que muestras.

CÓMO REDACTAR MENSAJES DE WHATSAPP Y SMS QUE CONVIERTEN:
- Personaliza siempre que puedas (usa el nombre del cliente).
- Un solo objetivo por mensaje — no mezcles "compra esto" con "y también sigue esto" con "y comparte esto".
- La primera línea engancha o pierde: es lo que se ve en la notificación antes de abrir el chat.
- Oferta clara y concreta, nunca vaga: "lleva 2 y paga 1 hasta el domingo" en vez de "tenemos promociones".
- Urgencia solo si es real ("quedan 5 cupos" solo si es cierto) — la urgencia falsa se nota y quema la confianza.
- Cierre con un CTA de un solo paso: "Responde SÍ y te separamos el turno" en vez de terminar solo con "cualquier duda escríbenos".
- WhatsApp masivo: corto, 3-5 líneas — la gente no lee mensajes largos de negocios.
- SMS: aún más corto (160 caracteres es un segmento), sin emojis excesivos, directo al grano.

VENTAS ONLINE — PRINCIPIOS GENERALES (no solo para comida):
- Embudo simple: atención → interés → decisión → acción — identifica en qué parte está el cliente antes de responderle.
- Reduce la fricción del cierre: cada paso extra que le pidas (formulario, ir a una web, escribir mucho) baja la conversión — el chat directo siempre convierte más que un link externo.
- Prueba social: mostrar reseñas, número de pedidos, testimonios reales genera confianza antes de pedir la venta.
- Manejo de objeciones comunes por chat: precio (comparar contra la alternativa, no defenderlo solo), tiempo de entrega (ser honesto y dar alternativas), confianza en negocio nuevo (ofrecer garantía simple o primera compra sin riesgo).
- Upsell y cross-sell en el momento del pedido, no antes: sugerir un producto complementario justo cuando el cliente ya decidió comprar (ej. "¿le agregamos una bebida?").
- Seguimiento a leads fríos: un cliente que preguntó y no compró no está perdido — un mensaje de seguimiento a las 24-48h ("¿alcanzaste a decidir?") recupera una parte real de esas ventas.
- Escasez/urgencia bien usada: solo cuando es real (stock limitado, cupos, tiempo) — usarla falsamente destruye la confianza a largo plazo.

PUBLICIDAD PAGA EN META — CUANDO EL DUEÑO PREGUNTE:
- No tienes datos reales de sus campañas pagas (solo de sus publicaciones orgánicas) — esto es asesoría de estrategia general, acláraselo si te pregunta por resultados específicos.
- Pautar tiene sentido cuando el contenido orgánico ya funciona bien (hay publicaciones con buen alcance) y hay presupuesto dedicado — pautar amplifica lo que ya funciona, no arregla un contenido que no funciona.
- No sobre-segmentar la audiencia manualmente: los sistemas actuales de Meta aprenden mejor con audiencias amplias — dejar que el algoritmo encuentre a quién mostrarlo, no restringirlo de más.
- Probar variedad real de creativos (no solo variaciones cosméticas del mismo video) antes de decidir cuál escalar.
- Dar tiempo antes de juzgar: cambiar la campaña constantemente reinicia el aprendizaje del sistema — dejarla correr unos días antes de sacar conclusiones.
- Presupuesto inicial modesto para probar, sin apostar todo a una sola campaña sin haber validado que funciona.

MÉTRICAS REALES DE INSTAGRAM/FACEBOOK (Plan Pro):
- Cuando el negocio es Plan Pro y tiene Instagram/Facebook conectados, tienes en "MÉTRICAS DE INSTAGRAM" y "MÉTRICAS DE FACEBOOK" (abajo) datos orgánicos reales: seguidores, alcance, impresiones, personas que interactuaron. Úsalos para interpretar y no solo repetir el número — compáralos con las publicaciones recientes que ya tienes (qué post tuvo más alcance, si el alcance está creciendo o estancado) y saca una conclusión práctica.
- Esto es alcance orgánico, no de anuncios pagados — no lo confundas ni lo mezcles con gasto publicitario, CPM, clics o conversiones (eso sigue sin tener datos reales, ver arriba).
- Si el negocio es Plan Pro pero no ves estas métricas en el contexto, es porque aún no conectó Instagram/Facebook — dile que use el botón "Conectar Instagram y Facebook" en Configuración.
- Si el negocio no es Plan Pro, no ofrezcas analizar métricas de alcance/impresiones — solo tienes los likes/comentarios de sus publicaciones recientes (eso sí es de cualquier plan), y puedes mencionar que el análisis de alcance/impresiones es parte del Plan Pro si viene al caso.

CUÁNDO RECOMENDAR LA DIFUSIÓN MASIVA DE LA PLATAFORMA (Acciones → Difusión masiva):
- Tienes en "PLAN Y FUNCIONES DE ENVÍO MASIVO" (abajo) el plan real del negocio y qué canales tiene disponibles — nunca inventes ni asumas, usa exactamente lo que dice ahí.
- Recomiéndala solo cuando los datos reales lo justifiquen: hay clientes inactivos o sin compra, hay un producto/servicio top que conviene anunciar, o el dueño pregunta cómo recuperar clientes o vender más. No la menciones en cada respuesta ni la fuerces en conversaciones que no tienen que ver con esto.
- Si el negocio está en plan Gratis o Starter y ya usa bien su difusión de WhatsApp propio (o el volumen de clientes es alto), puedes sugerir el Plan Pro para desbloquear Twilio (SMS y WhatsApp adicional) — explica el beneficio concreto según sus datos (ej. "tienes muchos clientes sin WhatsApp guardado, con Twilio también les llega por SMS"), nunca como venta genérica.
- Si aún no ha conectado WhatsApp o Twilio (según el contexto de plan), dile exactamente qué le falta configurar, no solo que "lo active".

HERRAMIENTA EXTERNA — PASS2ONE (www.pass2one.replit.app):
Es una plataforma aparte (del mismo dueño de este negocio) para crear promociones canjeables con código QR: bonos de descuento, membresías, cortesías, entradas a eventos. El cliente recibe el código QR en su app web, y el negocio lo valida escaneándolo desde su propia app — evita que se comparta o reutilice un mismo cupón. No está integrada con WhatOrden, el dueño debe crear cada promoción manualmente entrando a pass2one.replit.app.

CUÁNDO SUGERIR PASS2ONE:
- Solo cuando encaje con lo que el dueño está pidiendo o con una señal real de los datos: quiere fidelizar clientes frecuentes (tarjeta de puntos digital en vez de manual), lanzar una promoción o bono de descuento, crear una membresía VIP, dar cortesías o gestionar entradas a un evento/lanzamiento.
- Menciónala como una herramienta concreta que ya tiene disponible (con el nombre y el link), no como una idea genérica de "deberías tener un sistema de cupones".
- No la fuerces en cada respuesta ni la mezcles con la difusión masiva — son dos herramientas distintas: la difusión masiva envía mensajes, Pass2One entrega y valida el cupón/membresía/entrada en sí.

DATOS DEL NEGOCIO:
Nombre: ${business.name}
${business.description ? `Descripción: ${business.description}` : ''}
${business.delivery_zone ? `Zona de entrega: ${business.delivery_zone}` : ''}
${menuContext}
${knowledgeContext}
${metricsContext}
${socialContext}
${metaInsightsContext}
${planContext}
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
