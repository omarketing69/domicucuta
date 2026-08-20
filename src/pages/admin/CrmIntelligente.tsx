import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useNavigate } from 'react-router-dom';
import { hasCrmAccess } from '@/lib/sso';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { CustomerTimeline } from '@/components/CustomerTimeline';
import { logWaSent } from '@/lib/customerEvents';
import {
  LayoutDashboard, Users, Zap, Search, TrendingUp, ShoppingBag,
  Star, Clock, AlertTriangle, CheckCircle2, BarChart3, Phone,
  ArrowUpRight, RefreshCw, Target, Repeat2, XCircle, Calendar,
  ChevronRight, MessageSquare, Crown, Bot, Flame,
  Kanban, ClipboardList, CheckSquare, Square, PhoneCall, MessageCircle,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrmTab = 'dashboard' | 'leads' | 'oportunidades' | 'kanban' | 'tareas';

interface AiConversation {
  id: string;
  business_id: string;
  slug: string;
  customer_name: string | null;
  customer_phone: string | null;
  messages: Array<{ role: string; content: string }>;
  had_order: boolean;
  order_data: {
    items?: string;
    total?: number;
    cliente?: string;
    entrega?: string;
    direccion?: string;
    telefono?: string;
    notas?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface Order {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  total: number;
  status: string;
  created_at: string;
  delivery_type: string | null;
  notes: string | null;
}

interface LeadProfile {
  phone: string;
  name: string;
  conversations: AiConversation[];
  orders: Order[];
  score: number;
  estado: string;
  estadoColor: string;
  ultimaActividad: string;
  primerContacto: string;
  totalGastado: number;
  numPedidos: number;
  productosFavoritos: string[];
  resumenIA: string;
  intencion: number;
  diasSinComprar: number;
  carritoAbandono: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO');
}

function fmtRelative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d`;
  return `${Math.floor(diff / 86400 / 30)}mes`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function extractProducts(convs: AiConversation[]): string[] {
  const prods: Record<string, number> = {};
  for (const c of convs) {
    const items = c.order_data?.items ?? '';
    if (!items) continue;
    const parts = items.split(/[,\n]/).map(p => p.replace(/^\d+x\s*/i, '').trim()).filter(Boolean);
    for (const p of parts) prods[p] = (prods[p] ?? 0) + 1;
  }
  return Object.entries(prods).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
}

function buildResumen(lead: Omit<LeadProfile, 'resumenIA' | 'intencion'>): { resumen: string; intencion: number } {
  const { numPedidos, totalGastado, carritoAbandono, conversations, productosFavoritos, diasSinComprar } = lead;
  const msgCount = conversations.reduce((s, c) => s + c.messages.length, 0);
  let score = 0;
  const frases: string[] = [];

  if (numPedidos > 0) {
    score += 30 + Math.min(numPedidos * 5, 20);
    frases.push(`Ha realizado ${numPedidos} pedido${numPedidos > 1 ? 's' : ''} por un total de ${fmtMoney(totalGastado)}.`);
  }
  if (productosFavoritos.length > 0) {
    frases.push(`Prefiere: ${productosFavoritos.join(', ')}.`);
  }
  if (msgCount > 6) {
    score += 15;
    frases.push(`Conversación activa con ${msgCount} mensajes — alto engagement.`);
  } else if (msgCount > 2) {
    score += 8;
    frases.push(`Ha tenido ${msgCount} intercambios con el asistente.`);
  }
  if (carritoAbandono) {
    score -= 10;
    frases.push(`⚠️ Inició un pedido pero no lo completó.`);
    frases.push(`Recomendación: enviar promoción de recuperación.`);
  }
  if (diasSinComprar > 30 && numPedidos > 0) {
    score -= 15;
    frases.push(`No compra hace ${diasSinComprar} días — en riesgo de perder.`);
  } else if (diasSinComprar <= 7 && numPedidos > 0) {
    score += 15;
    frases.push(`Compra reciente — cliente activo.`);
  }
  if (numPedidos === 0 && msgCount > 0) {
    score += 5;
    frases.push(`Visitante interesado que aún no ha comprado — oportunidad de conversión.`);
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const resumen = frases.length > 0 ? frases.join(' ') : 'Sin actividad registrada aún.';
  return { resumen, intencion: finalScore };
}

function calcEstado(lead: Omit<LeadProfile, 'estado' | 'estadoColor' | 'resumenIA' | 'intencion'>): { estado: string; estadoColor: string } {
  const { numPedidos, carritoAbandono, score, diasSinComprar, conversations } = lead;
  if (numPedidos >= 3) return { estado: 'Cliente VIP', estadoColor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' };
  if (numPedidos >= 1 && diasSinComprar <= 30) return { estado: 'Cliente activo', estadoColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' };
  if (numPedidos >= 1 && diasSinComprar > 30) return { estado: 'Recompra sugerida', estadoColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' };
  if (carritoAbandono) return { estado: 'Carrito abandonado', estadoColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' };
  if (conversations.length > 0 && score > 20) return { estado: 'Cotizando', estadoColor: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' };
  if (conversations.length > 0) return { estado: 'Interesado', estadoColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' };
  return { estado: 'Nuevo visitante', estadoColor: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' };
}

function buildLeads(convs: AiConversation[], orders: Order[]): LeadProfile[] {
  const byPhone = new Map<string, { convs: AiConversation[]; orders: Order[] }>();

  for (const c of convs) {
    const phone = c.customer_phone ?? c.order_data?.telefono ?? `anon_${c.id}`;
    if (!byPhone.has(phone)) byPhone.set(phone, { convs: [], orders: [] });
    byPhone.get(phone)!.convs.push(c);
  }
  for (const o of orders) {
    const phone = o.customer_phone ?? `anon_order_${o.id}`;
    if (!byPhone.has(phone)) byPhone.set(phone, { convs: [], orders: [] });
    byPhone.get(phone)!.orders.push(o);
  }

  const leads: LeadProfile[] = [];

  for (const [phone, { convs: cs, orders: os }] of byPhone.entries()) {
    const allDates = [...cs.map(c => c.created_at), ...os.map(o => o.created_at)].sort();
    const primerContacto = allDates[0] ?? new Date().toISOString();
    const lastDates = [...cs.map(c => c.updated_at ?? c.created_at), ...os.map(o => o.updated_at ?? o.created_at)].sort().reverse();
    const ultimaActividad = lastDates[0] ?? primerContacto;

    const name = cs.find(c => c.customer_name)?.customer_name
      ?? os.find(o => o.customer_name)?.customer_name
      ?? 'Visitante';

    const completedOrders = [...os, ...cs.filter(c => c.had_order).map(c => ({
      id: c.id,
      customer_name: c.customer_name,
      customer_phone: c.customer_phone,
      total: c.order_data?.total ?? 0,
      status: 'delivered',
      created_at: c.created_at,
      delivery_type: c.order_data?.entrega ?? null,
      notes: null,
    }))];

    const numPedidos = completedOrders.length;
    const totalGastado = completedOrders.reduce((s, o) => s + (o.total ?? 0), 0);
    const productosFavoritos = extractProducts(cs);

    const diasSinComprar = numPedidos > 0
      ? Math.floor((Date.now() - new Date(completedOrders[completedOrders.length - 1].created_at).getTime()) / 86400000)
      : 999;

    const carritoAbandono = cs.some(c => {
      const msgs = c.messages ?? [];
      const hasItems = msgs.some(m => m.content?.toLowerCase().includes('carrito') || m.content?.toLowerCase().includes('agreg'));
      return hasItems && !c.had_order;
    });

    const partialLead = { phone, name, conversations: cs, orders: os, numPedidos, totalGastado,
      productosFavoritos, diasSinComprar, carritoAbandono, score: 0,
      estado: '', estadoColor: '', ultimaActividad, primerContacto };

    const { resumen, intencion } = buildResumen(partialLead);
    const { estado, estadoColor } = calcEstado({ ...partialLead, score: intencion });

    leads.push({
      ...partialLead,
      score: intencion,
      estado,
      estadoColor,
      resumenIA: resumen,
      intencion,
    });
  }

  return leads.sort((a, b) => b.score - a.score || new Date(b.ultimaActividad).getTime() - new Date(a.ultimaActividad).getTime());
}

// ── Score stars ────────────────────────────────────────────────────────────────

function ScoreStars({ score }: { score: number }) {
  const stars = score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1;
  const label = score >= 80 ? 'Excelente oportunidad' : score >= 60 ? 'Alta probabilidad' : score >= 40 ? 'Interés medio' : score >= 20 ? 'Interés bajo' : 'Cliente frío';
  const color = score >= 80 ? 'text-amber-500' : score >= 60 ? 'text-amber-400' : score >= 40 ? 'text-amber-300' : 'text-gray-300';
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(i => (
        <Star key={i} className={cn('w-3.5 h-3.5', i <= stars ? color : 'text-gray-200 dark:text-gray-700')} fill={i <= stars ? 'currentColor' : 'none'} />
      ))}
      <span className="text-xs text-muted-foreground ml-1">{label}</span>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : score >= 40 ? 'bg-yellow-400' : score >= 20 ? 'bg-orange-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold tabular-nums w-7 text-right">{score}</span>
    </div>
  );
}

// ── Lead Detail Sheet ──────────────────────────────────────────────────────────

function LeadSheet({ lead, open, onClose, businessId }: { lead: LeadProfile | null; open: boolean; onClose: () => void; businessId: string }) {
  if (!lead) return null;

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {initials(lead.name)}
            </div>
            <div>
              <SheetTitle className="text-lg">{lead.name}</SheetTitle>
              <p className="text-sm text-muted-foreground">{lead.phone?.startsWith('anon') ? 'Sin teléfono' : lead.phone}</p>
            </div>
          </div>
        </SheetHeader>

        {/* Score */}
        <div className="mb-4 p-3 bg-muted/40 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Lead Score</span>
            <span className="text-lg font-bold">{lead.score}/100</span>
          </div>
          <ScoreBar score={lead.score} />
          <div className="mt-2"><ScoreStars score={lead.score} /></div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { label: 'Pedidos', value: lead.numPedidos, icon: ShoppingBag },
            { label: 'Total gastado', value: fmtMoney(lead.totalGastado), icon: TrendingUp },
            { label: 'Días sin comprar', value: lead.diasSinComprar === 999 ? 'N/A' : `${lead.diasSinComprar}d`, icon: Clock },
            { label: 'Conversaciones', value: lead.conversations.length, icon: MessageSquare },
          ].map(s => (
            <div key={s.label} className="p-3 bg-muted/30 rounded-xl">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-lg font-bold mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* AI Summary */}
        <div className="mb-4 p-3 border border-dashed border-violet-300 dark:border-violet-700 bg-violet-50/50 dark:bg-violet-950/20 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            <span className="text-sm font-semibold text-violet-700 dark:text-violet-400">Resumen IA</span>
          </div>
          <p className="text-sm text-foreground leading-relaxed">{lead.resumenIA}</p>
        </div>

        {/* Estado + productos favoritos */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Estado:</span>
            <Badge className={cn('text-xs', lead.estadoColor)}>{lead.estado}</Badge>
          </div>
          {lead.productosFavoritos.length > 0 && (
            <div>
              <p className="text-sm text-muted-foreground mb-1">Productos favoritos</p>
              <div className="flex flex-wrap gap-1.5">
                {lead.productosFavoritos.map(p => (
                  <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Historial cross-channel */}
        <div className="mt-4">
          <p className="text-sm font-semibold mb-3">Historial de actividad</p>
          <CustomerTimeline businessId={businessId} phone={lead.phone} name={lead.name} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Lead Card ─────────────────────────────────────────────────────────────────

function LeadCard({ lead, onClick }: { lead: LeadProfile; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="group bg-card border border-border rounded-xl p-4 cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
      data-testid={`lead-card-${lead.phone}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {initials(lead.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-sm truncate">{lead.name}</p>
            <span className="text-xs text-muted-foreground flex-shrink-0">{fmtRelative(lead.ultimaActividad)}</span>
          </div>
          <p className="text-xs text-muted-foreground truncate">{lead.phone?.startsWith('anon') ? '—' : lead.phone}</p>
        </div>
      </div>

      <div className="mb-2">
        <ScoreBar score={lead.score} />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2 mb-3 leading-relaxed">{lead.resumenIA}</p>

      <div className="flex items-center justify-between">
        <Badge className={cn('text-[10px] px-2 py-0.5', lead.estadoColor)}>{lead.estado}</Badge>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {lead.numPedidos > 0 && (
            <span className="flex items-center gap-0.5">
              <ShoppingBag className="w-3 h-3" />
              {lead.numPedidos}
            </span>
          )}
          {lead.totalGastado > 0 && (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(lead.totalGastado)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function DashboardView({ businessId, leads }: { businessId: string; leads: LeadProfile[] }) {
  const { data: orders30 } = useQuery({
    queryKey: ['crm_orders_30', businessId],
    queryFn: async () => {
      const from = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data } = await supabase.from('orders').select('total, status, created_at')
        .eq('business_id', businessId).gte('created_at', from).order('created_at');
      return data ?? [];
    },
  });

  const { data: convs7 } = useQuery({
    queryKey: ['crm_convs_7', businessId],
    queryFn: async () => {
      const from = new Date(Date.now() - 7 * 86400000).toISOString();
      const { data } = await supabase.from('ai_conversations').select('created_at, had_order')
        .eq('business_id', businessId).gte('created_at', from).order('created_at');
      return data ?? [];
    },
  });

  // Derived KPIs
  const totalVentas = (orders30 ?? []).reduce((s, o) => s + (o.total ?? 0), 0);
  const pedidosHoy = (orders30 ?? []).filter(o => new Date(o.created_at).toDateString() === new Date().toDateString()).length;
  const avgTicket = orders30?.length ? totalVentas / orders30.length : 0;
  const clientesActivos = leads.filter(l => l.diasSinComprar <= 30).length;
  const clientesVip = leads.filter(l => l.numPedidos >= 3).length;
  const carritoAbandono = leads.filter(l => l.carritoAbandono).length;
  const enRiesgo = leads.filter(l => l.numPedidos > 0 && l.diasSinComprar > 30).length;
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0;
  const conversionRate = leads.length > 0 ? Math.round((leads.filter(l => l.numPedidos > 0).length / leads.length) * 100) : 0;

  // Chart: pedidos por día últimos 7 días
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });
  const chartData = chartDays.map(day => ({
    label: new Date(day + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
    pedidos: (orders30 ?? []).filter(o => o.created_at.slice(0, 10) === day).length,
    visitas: (convs7 ?? []).filter(c => c.created_at.slice(0, 10) === day).length,
  }));

  // Pie: lead states
  const estadoCount: Record<string, number> = {};
  for (const l of leads) estadoCount[l.estado] = (estadoCount[l.estado] ?? 0) + 1;
  const pieData = Object.entries(estadoCount).map(([name, value]) => ({ name, value }));
  const PIE_COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#6b7280'];

  const kpis = [
    { label: 'Ventas (30 días)', value: fmtMoney(totalVentas), icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { label: 'Pedidos hoy', value: pedidosHoy, icon: ShoppingBag, color: 'text-violet-600', bg: 'bg-violet-50 dark:bg-violet-950/30' },
    { label: 'Ticket promedio', value: fmtMoney(avgTicket), icon: BarChart3, color: 'text-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/30' },
    { label: 'Clientes activos', value: clientesActivos, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
    { label: 'Clientes VIP', value: clientesVip, icon: Crown, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
    { label: 'Carritos abandonados', value: carritoAbandono, icon: XCircle, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30' },
    { label: 'Clientes en riesgo', value: enRiesgo, icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-950/30' },
    { label: 'Lead Score promedio', value: `${avgScore}/100`, icon: Flame, color: 'text-indigo-600', bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
    { label: 'Tasa de conversión', value: `${conversionRate}%`, icon: Target, color: 'text-teal-600', bg: 'bg-teal-50 dark:bg-teal-950/30' },
  ];

  return (
    <div className="space-y-6">
      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
        {kpis.map(k => (
          <div key={k.label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', k.bg)}>
              <k.icon className={cn('w-4 h-4', k.color)} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground leading-tight">{k.label}</p>
              <p className="text-xl font-bold truncate">{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-4">
          <p className="text-sm font-semibold mb-4">Actividad últimos 7 días</p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="gradPedidos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradVisitas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="pedidos" stroke="#8b5cf6" fill="url(#gradPedidos)" name="Pedidos" />
              <Area type="monotone" dataKey="visitas" stroke="#10b981" fill="url(#gradVisitas)" name="Visitas IA" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-sm font-semibold mb-4">Distribución de leads</p>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="flex-1 truncate text-muted-foreground">{d.name}</span>
                    <span className="font-semibold">{d.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Sin datos aún</div>
          )}
        </div>
      </div>

      {/* Top leads */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold">Top Leads — Mayor probabilidad de compra</p>
          <Bot className="w-4 h-4 text-violet-500" />
        </div>
        {leads.slice(0, 5).length > 0 ? (
          <div className="space-y-3">
            {leads.slice(0, 5).map((lead, i) => (
              <div key={lead.phone} className="flex items-center gap-3 py-2 border-b border-border last:border-0">
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                  {i + 1}
                </div>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                  {initials(lead.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{lead.name}</p>
                  <ScoreBar score={lead.score} />
                </div>
                <Badge className={cn('text-[10px]', lead.estadoColor)}>{lead.estado}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-6">Sin leads registrados aún</p>
        )}
      </div>
    </div>
  );
}

// ── Leads View ─────────────────────────────────────────────────────────────────

function LeadsView({ leads, businessId }: { leads: LeadProfile[]; businessId: string }) {
  const [search, setSearch] = useState('');
  const [filterEstado, setFilterEstado] = useState('todos');
  const [selected, setSelected] = useState<LeadProfile | null>(null);

  const estados = ['todos', ...Array.from(new Set(leads.map(l => l.estado)))];

  const filtered = useMemo(() => {
    return leads.filter(l => {
      const matchSearch = !search || l.name.toLowerCase().includes(search.toLowerCase()) || (l.phone ?? '').includes(search);
      const matchEstado = filterEstado === 'todos' || l.estado === filterEstado;
      return matchSearch && matchEstado;
    });
  }, [leads, search, filterEstado]);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o teléfono..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {estados.map(e => (
            <button
              key={e}
              onClick={() => setFilterEstado(e)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                filterEstado === e
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              )}
            >
              {e === 'todos' ? `Todos (${leads.length})` : e}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(lead => (
            <LeadCard key={lead.phone} lead={lead} onClick={() => setSelected(lead)} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sin leads que coincidan con el filtro</p>
        </div>
      )}

      <LeadSheet lead={selected} open={!!selected} onClose={() => setSelected(null)} businessId={businessId} />
    </div>
  );
}

// ── Oportunidades ─────────────────────────────────────────────────────────────

function OportunidadesView({ leads, businessId }: { leads: LeadProfile[]; businessId: string }) {
  const carritoAbandono    = leads.filter(l => l.carritoAbandono && l.numPedidos === 0);
  const recompraLista      = leads.filter(l => l.numPedidos > 0 && l.diasSinComprar > 14 && l.diasSinComprar <= 60);
  const enRiesgo           = leads.filter(l => l.numPedidos > 0 && l.diasSinComprar > 60);
  const sinComprar         = leads.filter(l => l.numPedidos === 0 && l.conversations.length > 0 && l.score > 20);
  const altaProbabilidad   = leads.filter(l => l.score >= 60 && l.numPedidos === 0);
  const vipActivos         = leads.filter(l => l.numPedidos >= 3 && l.diasSinComprar <= 30);

  const grupos = [
    {
      id: 'carrito',
      icon: XCircle,
      color: 'text-rose-600',
      bg: 'bg-rose-50 dark:bg-rose-950/30',
      border: 'border-rose-200 dark:border-rose-800',
      title: 'Carritos abandonados',
      desc: 'Iniciaron un pedido pero no lo completaron',
      accion: 'Enviar promoción de recuperación',
      leads: carritoAbandono,
      prioridad: 'Alta',
      prioColor: 'bg-rose-100 text-rose-700',
    },
    {
      id: 'recompra',
      icon: Repeat2,
      color: 'text-amber-600',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-200 dark:border-amber-800',
      title: 'Listos para recomprar',
      desc: 'Clientes que compraron hace 14–60 días',
      accion: 'Recordatorio de recompra personalizado',
      leads: recompraLista,
      prioridad: 'Media',
      prioColor: 'bg-amber-100 text-amber-700',
    },
    {
      id: 'alta_prob',
      icon: Target,
      color: 'text-violet-600',
      bg: 'bg-violet-50 dark:bg-violet-950/30',
      border: 'border-violet-200 dark:border-violet-800',
      title: 'Alta probabilidad de compra',
      desc: 'Leads con score ≥60 que aún no han comprado',
      accion: 'Mensaje de conversión personalizado',
      leads: altaProbabilidad,
      prioridad: 'Alta',
      prioColor: 'bg-rose-100 text-rose-700',
    },
    {
      id: 'sin_comprar',
      icon: ArrowUpRight,
      color: 'text-sky-600',
      bg: 'bg-sky-50 dark:bg-sky-950/30',
      border: 'border-sky-200 dark:border-sky-800',
      title: 'Interesados sin convertir',
      desc: 'Conversaron con el asistente pero no compraron',
      accion: 'Oferta especial de primera compra',
      leads: sinComprar,
      prioridad: 'Media',
      prioColor: 'bg-amber-100 text-amber-700',
    },
    {
      id: 'riesgo',
      icon: AlertTriangle,
      color: 'text-orange-600',
      bg: 'bg-orange-50 dark:bg-orange-950/30',
      border: 'border-orange-200 dark:border-orange-800',
      title: 'Clientes en riesgo de perder',
      desc: 'Compraron antes, sin actividad hace más de 60 días',
      accion: 'Campaña de recuperación urgente',
      leads: enRiesgo,
      prioridad: 'Urgente',
      prioColor: 'bg-red-100 text-red-700',
    },
    {
      id: 'vip',
      icon: Crown,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      border: 'border-emerald-200 dark:border-emerald-800',
      title: 'Clientes VIP activos',
      desc: 'Tres o más compras, activos en los últimos 30 días',
      accion: 'Programa de fidelización exclusivo',
      leads: vipActivos,
      prioridad: 'Baja',
      prioColor: 'bg-emerald-100 text-emerald-700',
    },
  ].filter(g => g.leads.length > 0);

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className="bg-gradient-to-r from-violet-500 to-sky-500 rounded-xl p-4 text-white">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-4 h-4" />
          <span className="font-semibold text-sm">Motor de Oportunidades IA</span>
        </div>
        <p className="text-sm text-white/90">
          {grupos.reduce((s, g) => s + g.leads.length, 0)} oportunidades detectadas automáticamente en {leads.length} leads.
          La IA analizó conversaciones, pedidos y comportamiento para priorizar acciones.
        </p>
      </div>

      {grupos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No hay oportunidades detectadas todavía.</p>
          <p className="text-xs mt-1">A medida que lleguen conversaciones y pedidos, la IA las analizará automáticamente.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {grupos.map(g => (
            <div key={g.id} className={cn('bg-card border rounded-xl overflow-hidden', g.border)}>
              {/* Header */}
              <div className={cn('px-4 py-3 flex items-center justify-between', g.bg)}>
                <div className="flex items-center gap-2.5">
                  <g.icon className={cn('w-4 h-4', g.color)} />
                  <div>
                    <p className="text-sm font-semibold">{g.title}</p>
                    <p className="text-xs text-muted-foreground">{g.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', g.prioColor)}>{g.prioridad}</span>
                  <span className="text-2xl font-bold">{g.leads.length}</span>
                </div>
              </div>

              {/* Action suggestion */}
              <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2">
                <Bot className="w-3.5 h-3.5 text-violet-500 flex-shrink-0" />
                <p className="text-xs text-muted-foreground italic">{g.accion}</p>
              </div>

              {/* Lead list */}
              <div className="divide-y divide-border">
                {g.leads.slice(0, 4).map(lead => (
                  <div key={lead.phone} className="px-4 py-2.5 flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                      {initials(lead.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{lead.name}</p>
                      {lead.phone && !lead.phone.startsWith('anon') && (
                        <p className="text-xs text-muted-foreground">{lead.phone}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="flex items-center gap-0.5">
                        <div className={cn('h-1.5 w-10 rounded-full bg-muted overflow-hidden')}>
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${lead.score}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{lead.score}</span>
                      </div>
                      {lead.phone && !lead.phone.startsWith('anon') && (
                        <a
                          href={`https://wa.me/57${lead.phone.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(lead.name)}%2C%20te%20escribimos%20desde%20nuestro%20negocio.`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => logWaSent(businessId, lead.phone, `Hola ${lead.name}, te escribimos desde nuestro negocio.`)}
                          className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 transition-colors"
                          title="Contactar por WhatsApp"
                        >
                          <Phone className="w-3 h-3 text-white" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {g.leads.length > 4 && (
                  <div className="px-4 py-2 text-xs text-muted-foreground text-center">
                    +{g.leads.length - 4} más en este grupo
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Kanban View ───────────────────────────────────────────────────────────────

const KANBAN_COLS = [
  { estado: 'Nuevo visitante',    emoji: '👤', bg: 'bg-gray-50 dark:bg-gray-900/40',    border: 'border-gray-200 dark:border-gray-700',    title: 'text-gray-700 dark:text-gray-300' },
  { estado: 'Interesado',         emoji: '👀', bg: 'bg-blue-50 dark:bg-blue-950/30',    border: 'border-blue-200 dark:border-blue-800',    title: 'text-blue-700 dark:text-blue-300' },
  { estado: 'Cotizando',          emoji: '💭', bg: 'bg-sky-50 dark:bg-sky-950/30',      border: 'border-sky-200 dark:border-sky-800',      title: 'text-sky-700 dark:text-sky-300' },
  { estado: 'Carrito abandonado', emoji: '🛒', bg: 'bg-rose-50 dark:bg-rose-950/30',    border: 'border-rose-200 dark:border-rose-800',    title: 'text-rose-700 dark:text-rose-300' },
  { estado: 'Cliente activo',     emoji: '✅', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800', title: 'text-emerald-700 dark:text-emerald-300' },
  { estado: 'Recompra sugerida',  emoji: '🔄', bg: 'bg-amber-50 dark:bg-amber-950/30',  border: 'border-amber-200 dark:border-amber-800',  title: 'text-amber-700 dark:text-amber-300' },
  { estado: 'Cliente VIP',        emoji: '👑', bg: 'bg-violet-50 dark:bg-violet-950/30',border: 'border-violet-200 dark:border-violet-800',title: 'text-violet-700 dark:text-violet-300' },
];

function KanbanView({ leads, businessId }: { leads: LeadProfile[]; businessId: string }) {
  const byEstado: Record<string, LeadProfile[]> = {};
  for (const col of KANBAN_COLS) byEstado[col.estado] = [];
  for (const lead of leads) {
    if (byEstado[lead.estado]) byEstado[lead.estado].push(lead);
  }

  return (
    <div>
      {/* Banner */}
      <div className="mb-4 rounded-xl bg-gradient-to-r from-violet-500 to-sky-500 p-4 text-white">
        <div className="flex items-center gap-2 mb-1">
          <Kanban className="w-4 h-4" />
          <span className="font-semibold text-sm">Pipeline visual de leads</span>
        </div>
        <p className="text-sm text-white/90">
          {leads.length} leads distribuidos automáticamente en {KANBAN_COLS.length} etapas del ciclo de compra.
        </p>
      </div>

      {/* Board — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {KANBAN_COLS.map(col => {
          const colLeads = byEstado[col.estado] ?? [];
          return (
            <div
              key={col.estado}
              className={cn('flex-shrink-0 w-52 rounded-xl border overflow-hidden', col.border)}
            >
              {/* Column header */}
              <div className={cn('px-3 py-2.5 flex items-center justify-between', col.bg)}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm leading-none">{col.emoji}</span>
                  <p className={cn('text-xs font-semibold truncate', col.title)}>{col.estado}</p>
                </div>
                <span className="text-xs font-bold text-muted-foreground ml-1 flex-shrink-0">{colLeads.length}</span>
              </div>

              {/* Cards */}
              <div className="p-2 space-y-1.5 max-h-[calc(100vh-320px)] overflow-y-auto bg-card/50">
                {colLeads.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-xs opacity-40">
                    Vacío
                  </div>
                ) : colLeads.map(lead => (
                  <div
                    key={lead.phone}
                    className="bg-card rounded-lg px-2.5 py-2 shadow-sm border border-border/60"
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0">
                        {initials(lead.name)}
                      </div>
                      <p className="text-xs font-medium truncate flex-1">{lead.name}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1 flex-1 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${lead.score}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-5 text-right">{lead.score}</span>
                      {lead.phone && !lead.phone.startsWith('anon') && (
                        <a
                          href={`https://wa.me/57${lead.phone.replace(/\D/g, '')}?text=Hola%20${encodeURIComponent(lead.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => logWaSent(businessId, lead.phone, `Hola ${lead.name}`)}
                          className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 transition-colors flex-shrink-0"
                          title="WhatsApp"
                        >
                          <Phone className="w-2 h-2 text-white" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tareas Hoy View ────────────────────────────────────────────────────────────

type TareaTipo      = 'llamar' | 'mensaje' | 'remarketing';
type TareaPrioridad = 'urgente' | 'alta' | 'media';

interface Tarea {
  id: string;
  tipo: TareaTipo;
  prioridad: TareaPrioridad;
  lead: LeadProfile;
  razon: string;
  mensajeSugerido: string;
}

function TareasHoyView({ leads, businessName, businessId }: { leads: LeadProfile[]; businessName: string; businessId: string }) {
  const [done, setDone]           = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle        = (id: string)  => setDone(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSection = (key: string) => setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const today = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });

  // Build tasks grouped by opportunity type (mirrors OportunidadesView filters)
  const grupos = useMemo(() => {
    const enRiesgo: Tarea[] = leads
      .filter(l => l.numPedidos > 0 && l.diasSinComprar > 60)
      .map(lead => ({
        id: `riesgo_${lead.phone}`,
        tipo: 'llamar' as TareaTipo,
        prioridad: 'urgente' as TareaPrioridad,
        lead,
        razon: `No compra hace ${lead.diasSinComprar} días — en riesgo de perderse`,
        mensajeSugerido: `Hola ${lead.name}, te escribe ${businessName} 👋 Ha pasado un tiempo desde tu último pedido y queremos saber cómo estás. ¿Te podemos ofrecer algo especial para tu próxima visita? ¡Estamos para servirte!`,
      }));

    const carritoAbandono: Tarea[] = leads
      .filter(l => l.carritoAbandono && l.numPedidos === 0)
      .map(lead => ({
        id: `carrito_${lead.phone}`,
        tipo: 'mensaje' as TareaTipo,
        prioridad: 'alta' as TareaPrioridad,
        lead,
        razon: 'Inició un pedido pero no lo completó',
        mensajeSugerido: `Hola ${lead.name}! 🛒 Vimos que casi completaste tu pedido en ${businessName}. ¿Te ayudamos a finalizarlo? Escríbenos y te atendemos de inmediato. ¡No dejes tu antojo para después! 😄`,
      }));

    const altaProbabilidad: Tarea[] = leads
      .filter(l => l.score >= 60 && l.numPedidos === 0 && !l.carritoAbandono)
      .map(lead => ({
        id: `altaprob_${lead.phone}`,
        tipo: 'mensaje' as TareaTipo,
        prioridad: 'alta' as TareaPrioridad,
        lead,
        razon: `Score ${lead.score}/100 — muy interesado, aún no ha comprado`,
        mensajeSugerido: `Hola ${lead.name}! 😊 Gracias por tu interés en ${businessName}. ¿En qué te puedo ayudar hoy? Tenemos disponibilidad inmediata y nos encantaría atenderte.`,
      }));

    const recompraLista: Tarea[] = leads
      .filter(l => l.numPedidos > 0 && l.diasSinComprar > 14 && l.diasSinComprar <= 60)
      .map(lead => ({
        id: `recompra_${lead.phone}`,
        tipo: 'remarketing' as TareaTipo,
        prioridad: 'media' as TareaPrioridad,
        lead,
        razon: `Compró hace ${lead.diasSinComprar} días — momento ideal para recordarle`,
        mensajeSugerido: `Hola ${lead.name}! 🍽️ Hace unos días disfrutaste de ${businessName} y queremos saber cómo te fue. ${lead.productosFavoritos.length > 0 ? `¿Te antojas de nuevo de ${lead.productosFavoritos[0]}?` : '¿Qué te apetece hoy?'} Escríbenos y preparamos tu pedido.`,
      }));

    return [
      { key: 'riesgo',   emoji: '🔴', label: 'Clientes en riesgo (>60 días)',     items: enRiesgo,         badgeClass: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',     headerClass: 'text-red-700 dark:text-red-400',    borderClass: 'border-red-200 dark:border-red-800' },
      { key: 'carrito',  emoji: '🟠', label: 'Carritos abandonados',               items: carritoAbandono,  badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300', headerClass: 'text-orange-700 dark:text-orange-400', borderClass: 'border-orange-200 dark:border-orange-800' },
      { key: 'altaprob', emoji: '🟢', label: 'Alta probabilidad de cierre',        items: altaProbabilidad, badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', headerClass: 'text-violet-700 dark:text-violet-400', borderClass: 'border-violet-200 dark:border-violet-800' },
      { key: 'recompra', emoji: '🟡', label: 'Listos para recomprar (14–60 días)', items: recompraLista,    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',   headerClass: 'text-amber-700 dark:text-amber-400',   borderClass: 'border-amber-200 dark:border-amber-800' },
    ].filter(g => g.items.length > 0);
  }, [leads, businessName]);

  const allTareas   = grupos.flatMap(g => g.items);
  const pendientes  = allTareas.filter(t => !done.has(t.id)).length;
  const urgentesNum = allTareas.filter(t => t.prioridad === 'urgente' && !done.has(t.id)).length;

  const prioColors: Record<TareaPrioridad, string> = {
    urgente: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    alta:    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    media:   'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  };
  const tipoIcons: Record<TareaTipo, typeof PhoneCall> = { llamar: PhoneCall, mensaje: MessageCircle, remarketing: Repeat2 };
  const tipoLabels: Record<TareaTipo, string>           = { llamar: 'Llamar', mensaje: 'Mensaje WA', remarketing: 'Remarketing' };

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header banner */}
      <div className={cn(
        'rounded-xl p-4 text-white',
        urgentesNum > 0
          ? 'bg-gradient-to-r from-rose-500 to-orange-500'
          : 'bg-gradient-to-r from-emerald-500 to-sky-500'
      )}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4" />
            <span className="font-semibold text-sm">Tareas comerciales de hoy</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/80">
            <Calendar className="w-3.5 h-3.5" />
            <span className="capitalize">{today}</span>
          </div>
        </div>
        <p className="text-sm text-white/90">
          {urgentesNum > 0
            ? `⚡ ${urgentesNum} tarea${urgentesNum > 1 ? 's' : ''} urgente${urgentesNum > 1 ? 's' : ''} — clientes que podrías perder si no actúas hoy.`
            : pendientes > 0
              ? `${pendientes} tarea${pendientes > 1 ? 's' : ''} pendiente${pendientes > 1 ? 's' : ''}. Sin urgencias — trabaja en las de alta prioridad.`
              : '¡Todas las tareas completadas! Excelente trabajo hoy.'}
        </p>
      </div>

      {grupos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">¡Sin tareas pendientes!</p>
          <p className="text-xs mt-1 opacity-70">A medida que lleguen leads y pedidos, la IA generará tareas automáticamente.</p>
        </div>
      ) : grupos.map(grupo => {
        const isCollapsed = collapsed.has(grupo.key);
        const doneCount   = grupo.items.filter(t => done.has(t.id)).length;
        return (
          <div key={grupo.key} className={cn('rounded-xl border overflow-hidden', grupo.borderClass)}>
            {/* Collapsible group header */}
            <button
              onClick={() => toggleSection(grupo.key)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{grupo.emoji}</span>
                <span className={cn('text-sm font-semibold', grupo.headerClass)}>{grupo.label}</span>
                <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', grupo.badgeClass)}>
                  {grupo.items.length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {doneCount > 0 && (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">{doneCount} hechas</span>
                )}
                <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
              </div>
            </button>

            {/* Task list */}
            {!isCollapsed && (
              <div className="divide-y divide-border">
                {grupo.items.map(tarea => {
                  const isDone   = done.has(tarea.id);
                  const TipoIcon = tipoIcons[tarea.tipo];
                  return (
                    <div
                      key={tarea.id}
                      data-testid={`tarea-${tarea.id}`}
                      className={cn('px-4 py-3.5 bg-card transition-opacity', isDone && 'opacity-40')}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          data-testid={`check-tarea-${tarea.id}`}
                          onClick={() => toggle(tarea.id)}
                          className="mt-0.5 flex-shrink-0 hover:opacity-70 transition-opacity"
                        >
                          {isDone
                            ? <CheckSquare className="w-4 h-4 text-emerald-500" />
                            : <Square className="w-4 h-4 text-muted-foreground" />
                          }
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <div className="flex items-center gap-1.5">
                              <TipoIcon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                              <p className={cn('text-sm font-semibold', isDone && 'line-through')}>{tarea.lead.name}</p>
                            </div>
                            {tarea.lead.phone && !tarea.lead.phone.startsWith('anon') && (
                              <span className="text-xs text-muted-foreground">{tarea.lead.phone}</span>
                            )}
                            <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', prioColors[tarea.prioridad])}>
                              {tarea.prioridad}
                            </span>
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                              {tipoLabels[tarea.tipo]}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mb-2">{tarea.razon}</p>
                          <details>
                            <summary className="text-xs font-medium text-violet-600 dark:text-violet-400 cursor-pointer select-none hover:text-violet-700 dark:hover:text-violet-300 flex items-center gap-1">
                              <MessageSquare className="w-3 h-3" />
                              Ver mensaje sugerido
                            </summary>
                            <div className="mt-2 bg-muted/60 rounded-lg px-3 py-2.5 text-xs text-muted-foreground italic leading-relaxed border-l-2 border-violet-300 dark:border-violet-700">
                              {tarea.mensajeSugerido}
                            </div>
                          </details>
                        </div>

                        {tarea.lead.phone && !tarea.lead.phone.startsWith('anon') && (
                          <a
                            href={`https://wa.me/57${tarea.lead.phone.replace(/\D/g, '')}?text=${encodeURIComponent(tarea.mensajeSugerido)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => logWaSent(businessId, tarea.lead.phone, tarea.mensajeSugerido)}
                            data-testid={`wa-tarea-${tarea.id}`}
                            className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 transition-colors px-3 py-1.5 rounded-lg mt-0.5"
                          >
                            <Phone className="w-3 h-3" />
                            WA
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main CRM Inteligente ───────────────────────────────────────────────────────

export default function CrmIntelligente() {
  const { business, loading } = useBusiness();
  const navigate = useNavigate();
  const [tab, setTab] = useState<CrmTab>('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);

  const isPro = hasCrmAccess(business ?? undefined);

  useEffect(() => {
    if (!loading && !isPro) navigate('/admin/dashboard');
  }, [loading, isPro, navigate]);

  // Auto-refresh when a new order or conversation arrives
  useEffect(() => {
    if (!business?.id) return;
    const channel = supabase
      .channel(`crm_inteligente_orders_${business.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'orders',
        filter: `business_id=eq.${business.id}`,
      }, () => setRefreshKey(k => k + 1))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'ai_conversations',
        filter: `business_id=eq.${business.id}`,
      }, () => setRefreshKey(k => k + 1))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [business?.id]);

  const { data: aiConvs = [], isLoading: loadingConvs } = useQuery({
    queryKey: ['ai_convs_crm', business?.id, refreshKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('ai_conversations')
        .select('*')
        .eq('business_id', business!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      return (data ?? []) as AiConversation[];
    },
    enabled: !!business?.id && isPro,
  });

  const { data: orders = [], isLoading: loadingOrders } = useQuery({
    queryKey: ['orders_crm', business?.id, refreshKey],
    queryFn: async () => {
      const { data } = await supabase
        .from('orders')
        .select('id, customer_name, customer_phone, total, status, created_at, delivery_type, notes')
        .eq('business_id', business!.id)
        .order('created_at', { ascending: false })
        .limit(500);
      return (data ?? []) as Order[];
    },
    enabled: !!business?.id && isPro,
  });

  const leads = useMemo(() => {
    if (!aiConvs.length && !orders.length) return [];
    return buildLeads(aiConvs, orders);
  }, [aiConvs, orders]);

  if (loading || !isPro) return null;
  const isLoading = loadingConvs || loadingOrders;

  const tareasUrgentes = leads.filter(l =>
    (l.numPedidos > 0 && l.diasSinComprar > 60) ||
    (l.carritoAbandono && l.numPedidos === 0)
  ).length;

  const tabs: { id: CrmTab; label: string; icon: typeof LayoutDashboard; badge?: number; badgeColor?: string }[] = [
    { id: 'dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
    { id: 'leads',        label: 'Leads',        icon: Users,         badge: leads.length || undefined },
    { id: 'kanban',       label: 'Kanban',        icon: Kanban,        badge: leads.length || undefined },
    { id: 'oportunidades',label: 'Oportunidades',icon: Zap,           badge: leads.filter(l => l.carritoAbandono || (l.numPedidos > 0 && l.diasSinComprar > 30) || l.score >= 60).length || undefined },
    { id: 'tareas',       label: 'Tareas de hoy', icon: ClipboardList, badge: tareasUrgentes || undefined, badgeColor: 'rose' },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-600" />
            CRM Inteligente
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Director comercial IA — {leads.length} leads analizados automáticamente
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={isLoading}
            className="gap-1.5"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
            {isLoading ? 'Analizando…' : 'Actualizar'}
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 border-b border-border px-6">
        <nav className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              data-testid={`crm-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={cn(
                  'ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                  t.badgeColor === 'rose' || t.id === 'oportunidades' || t.id === 'tareas'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                )}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
            <RefreshCw className="w-6 h-6 animate-spin" />
            <p className="text-sm">Analizando conversaciones y pedidos…</p>
          </div>
        ) : (
          <>
            {tab === 'dashboard'     && <DashboardView     businessId={business!.id} leads={leads} />}
            {tab === 'leads'         && <LeadsView         leads={leads} businessId={business!.id} />}
            {tab === 'oportunidades' && <OportunidadesView leads={leads} businessId={business!.id} />}
            {tab === 'kanban'        && <KanbanView        leads={leads} businessId={business!.id} />}
            {tab === 'tareas'        && <TareasHoyView     leads={leads} businessName={business?.name ?? 'nuestro negocio'} businessId={business!.id} />}
          </>
        )}
      </div>
    </div>
  );
}
