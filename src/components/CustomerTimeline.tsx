import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import {
  Bot, ShoppingBag, Send, Phone, Clock, RefreshCw,
  CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type EvType = 'ai_chat' | 'order' | 'order_status' | 'wa_out' | 'twilio';

interface TlEvent {
  id: string;
  type: EvType;
  ts: string;
  title: string;
  subtitle?: string;
  messages?: { role: string; content: string }[];
  badge?: string;
  badgeColor?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-CO', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0,
  }).format(n);
}

const EV_CFG: Record<EvType, { icon: typeof Bot; bg: string; text: string }> = {
  ai_chat:      { icon: Bot,          bg: 'bg-sky-100 dark:bg-sky-900/40',         text: 'text-sky-600 dark:text-sky-400' },
  order:        { icon: ShoppingBag,  bg: 'bg-violet-100 dark:bg-violet-900/40',   text: 'text-violet-600 dark:text-violet-400' },
  order_status: { icon: CheckCircle2, bg: 'bg-gray-100 dark:bg-gray-800',          text: 'text-gray-500 dark:text-gray-400' },
  wa_out:       { icon: Send,         bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-600 dark:text-emerald-400' },
  twilio:       { icon: Phone,        bg: 'bg-blue-100 dark:bg-blue-900/40',       text: 'text-blue-600 dark:text-blue-400' },
};

const ORDER_STATUS: Record<string, string> = {
  pending:    'Pendiente',
  preparing:  'En preparación',
  on_the_way: 'En camino',
  delivered:  'Entregado',
  cancelled:  'Cancelado',
};

// ── Main Component ───────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  phone: string | null;
  name?: string;
}

export function CustomerTimeline({ businessId, phone }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rawPhone = phone ?? '';
  const normalizedPhone = rawPhone.replace(/\D/g, '');

  const enabled = !!businessId && !!normalizedPhone;

  const orClause = rawPhone !== normalizedPhone
    ? `customer_phone.eq.${rawPhone},customer_phone.eq.${normalizedPhone}`
    : `customer_phone.eq.${normalizedPhone}`;

  const { data: aiConvs = [], isLoading: l1 } = useQuery({
    queryKey: ['tl_ai', businessId, normalizedPhone],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, created_at, updated_at, messages, had_order, source')
        .eq('business_id', businessId)
        .or(orClause)
        .order('created_at', { ascending: false })
        .limit(60);
      if (error) return [];
      return data ?? [];
    },
    enabled,
    staleTime: 30_000,
  });

  const { data: orders = [], isLoading: l2 } = useQuery({
    queryKey: ['tl_orders', businessId, normalizedPhone],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, created_at, total, status, notes, order_status_history(id, from_status, to_status, changed_at, note)')
        .eq('business_id', businessId)
        .or(orClause)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return [];
      return data ?? [];
    },
    enabled,
    staleTime: 30_000,
  });

  const { data: custEvents = [], isLoading: l3 } = useQuery({
    queryKey: ['tl_events', businessId, normalizedPhone],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_events')
        .select('id, created_at, channel, direction, summary')
        .eq('business_id', businessId)
        .or(`customer_phone.eq.${normalizedPhone}`)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) return [];
      return data ?? [];
    },
    enabled,
    staleTime: 30_000,
  });

  const isLoading = l1 || l2 || l3;

  const allEvents = useMemo<TlEvent[]>(() => {
    const result: TlEvent[] = [];

    for (const c of aiConvs) {
      const msgs = Array.isArray(c.messages)
        ? (c.messages as { role: string; content: string }[])
        : [];
      const lastUserMsg = msgs.filter(m => m.role === 'user').at(-1)?.content;
      result.push({
        id:       `ai_${c.id}`,
        type:     'ai_chat',
        ts:       c.created_at,
        title:    c.had_order ? 'Conversación IA — con pedido' : 'Conversación IA',
        subtitle: lastUserMsg
          ? `"${lastUserMsg.slice(0, 70)}${lastUserMsg.length > 70 ? '…' : ''}"`
          : `${msgs.length} mensajes`,
        messages: msgs,
        badge:       c.had_order ? (c.source === 'cart' ? 'Carrito' : 'Pedido IA') : undefined,
        badgeColor:  c.had_order
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : undefined,
      });
    }

    for (const o of orders) {
      result.push({
        id:       `order_${o.id}`,
        type:     'order',
        ts:       o.created_at,
        title:    `Pedido — ${fmtMoney(o.total)}`,
        subtitle: o.notes ? o.notes.slice(0, 80) : undefined,
        badge:    ORDER_STATUS[o.status] ?? o.status,
        badgeColor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
      });
      // Status history entries for this order
      const statusHistory = ((o as Record<string, unknown>).order_status_history ?? []) as {
        id: string; from_status: string | null; to_status: string; changed_at: string; note: string | null;
      }[];
      for (const sh of statusHistory) {
        result.push({
          id:       `status_${sh.id}`,
          type:     'order_status',
          ts:       sh.changed_at,
          title:    `Estado actualizado: ${ORDER_STATUS[sh.to_status] ?? sh.to_status}`,
          subtitle: sh.note ??
            (sh.from_status
              ? `${ORDER_STATUS[sh.from_status] ?? sh.from_status} → ${ORDER_STATUS[sh.to_status] ?? sh.to_status}`
              : undefined),
        });
      }
    }

    for (const e of custEvents) {
      const type: EvType = e.channel === 'whatsapp' ? 'wa_out' : 'twilio';
      const channelLabel =
        e.channel === 'whatsapp'      ? '💬 WA enviado'
        : e.channel === 'twilio_sms'  ? '📱 SMS Twilio'
        : e.channel === 'twilio_voice'? '📞 Llamada Twilio'
        : e.channel === 'email'       ? '✉️ Email'
        : '📤 Mensaje enviado';
      result.push({
        id:       `evt_${e.id}`,
        type,
        ts:       e.created_at,
        title:    channelLabel,
        subtitle: e.summary.slice(0, 120) + (e.summary.length > 120 ? '…' : ''),
        messages: [{ role: 'admin', content: e.summary }],
      });
    }

    return result.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  }, [aiConvs, orders, custEvents]);

  const grouped = useMemo(() => {
    const days = new Map<string, TlEvent[]>();
    for (const ev of allEvents) {
      const key = new Date(ev.ts).toDateString();
      if (!days.has(key)) days.set(key, []);
      days.get(key)!.push(ev);
    }
    return Array.from(days.values()).map(evs => ({
      day:    fmtDay(evs[0].ts),
      events: evs,
    }));
  }, [allEvents]);

  if (!normalizedPhone) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        Sin número de teléfono — no se puede cargar el historial.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span className="text-sm">Cargando historial…</span>
      </div>
    );
  }

  if (allEvents.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <Clock className="w-8 h-8 mx-auto mb-2 opacity-25" />
        <p className="text-sm">Sin actividad registrada</p>
        <p className="text-xs mt-1 opacity-60">
          Los chats IA, pedidos y mensajes enviados aparecerán aquí.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground pb-1 border-b border-border">
        <span className="flex items-center gap-1">
          <Bot className="w-3 h-3" /> {aiConvs.length} conversaciones
        </span>
        <span className="flex items-center gap-1">
          <ShoppingBag className="w-3 h-3" /> {orders.length} pedidos
        </span>
        <span className="flex items-center gap-1">
          <Send className="w-3 h-3" /> {custEvents.length} mensajes enviados
        </span>
      </div>

      {/* Timeline grouped by day */}
      {grouped.map(group => (
        <div key={group.day}>
          <div className="mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {group.day}
            </span>
          </div>
          <div className="space-y-2">
            {group.events.map(ev => {
              const cfg      = EV_CFG[ev.type];
              const Icon     = cfg.icon;
              const hasDetail = !!ev.messages?.length;
              const expanded  = expandedId === ev.id;

              return (
                <div
                  key={ev.id}
                  className="rounded-xl border border-border bg-card overflow-hidden"
                >
                  <button
                    className={cn(
                      'w-full flex items-start gap-3 p-3 text-left',
                      hasDetail && 'hover:bg-muted/40 transition-colors cursor-pointer'
                    )}
                    onClick={() => hasDetail && setExpandedId(expanded ? null : ev.id)}
                    disabled={!hasDetail}
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
                      cfg.bg
                    )}>
                      <Icon className={cn('w-3.5 h-3.5', cfg.text)} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-medium">{ev.title}</p>
                        {ev.badge && (
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                            ev.badgeColor ?? 'bg-muted text-muted-foreground'
                          )}>
                            {ev.badge}
                          </span>
                        )}
                      </div>
                      {ev.subtitle && (
                        <p className="text-xs text-muted-foreground line-clamp-2">{ev.subtitle}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">{fmtTime(ev.ts)}</p>
                    </div>

                    {hasDetail && (
                      expanded
                        ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                        : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-1" />
                    )}
                  </button>

                  {expanded && ev.messages && (
                    <div className="px-3 pb-3 border-t border-border pt-2 space-y-1.5 max-h-56 overflow-y-auto">
                      {ev.messages.map((m, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex',
                            m.role === 'user' || m.role === 'admin' ? 'justify-end' : 'justify-start'
                          )}
                        >
                          <div className={cn(
                            'max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed',
                            m.role === 'user'
                              ? 'bg-foreground text-background'
                              : m.role === 'admin'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-muted text-foreground border border-border'
                          )}>
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Dot indicating items above */}
      <div className="flex items-center justify-center pt-2">
        <CheckCircle2 className="w-4 h-4 text-muted-foreground/30" />
        <span className="text-xs text-muted-foreground/50 ml-1">Inicio del historial</span>
      </div>
    </div>
  );
}
