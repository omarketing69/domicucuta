import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { getWhatsAppUrl } from '@/lib/whatsapp';
import {
  Loader2, Pause, Play, ChevronRight, X, MessageCircle,
  AlertTriangle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  Zap, Package, Truck, ShoppingBag, BarChart3, Link2,
  Copy, MapPin, Phone, Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type OrderItem = Database['public']['Tables']['order_items']['Row'];
type Order = Database['public']['Tables']['orders']['Row'] & {
  order_items: OrderItem[];
  tracking_code?: string | null;
  paused_at?: string | null;
  pause_reason?: string | null;
  total_paused_seconds?: number;
};

// ── Production time types ─────────────────────────────────────────────────────
interface ProductionTimes {
  reception: number;
  preparation: number;
  packaging: number;
  handoff: number;
  delivery: number;
}
const DEFAULT_TIMES: ProductionTimes = {
  reception: 2, preparation: 18, packaging: 5, handoff: 3, delivery: 20,
};

// ── Status maps ───────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  pending:   'Recibido',
  confirmed: 'Preparando',
  ready:     'En camino',
  completed: 'Entregado',
  cancelled: 'Cancelado',
};
const STATUS_EMOJI: Record<string, string> = {
  pending: '🛒', confirmed: '👨‍🍳', ready: '🚴', completed: '✅', cancelled: '❌',
};
const NEXT_STATUS: Record<string, string> = {
  pending: 'confirmed', confirmed: 'ready', ready: 'completed',
};
const DELIVERY_LABEL: Record<string, string> = {
  local: 'En el local', pickup: 'Para recoger', delivery: 'Domicilio',
};

// ── Pause reasons ─────────────────────────────────────────────────────────────
const PAUSE_REASONS = [
  'Producto agotado', 'Cliente llamó', 'Cambio de dirección',
  'Falta un ingrediente', 'Retraso del domiciliario', 'Cliente canceló',
  'Problema en cocina', 'Otro',
];

// ── Time helpers ──────────────────────────────────────────────────────────────
function isToday(date: string) {
  const d = new Date(date), n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}
function fmtTime(date: string) {
  return new Date(date).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function currencySymbol(c?: string | null) { return c === 'EUR' ? '€' : '$'; }
function fmtDuration(sec: number): string {
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getProductionTimes(business: { production_times?: unknown }): ProductionTimes {
  const pt = business?.production_times as Partial<ProductionTimes> | undefined;
  return { ...DEFAULT_TIMES, ...pt };
}

function getTotalExpectedSec(times: ProductionTimes, isDelivery: boolean): number {
  return (times.reception + times.preparation + times.packaging + (isDelivery ? times.delivery : times.handoff)) * 60;
}

function getBreakpointsSec(times: ProductionTimes, isDelivery: boolean) {
  return {
    toConfirmed: times.reception * 60,
    toReady:     (times.reception + times.preparation + times.packaging) * 60,
    toCompleted: getTotalExpectedSec(times, isDelivery),
  };
}

function getEffectiveElapsed(order: Order): number {
  // For finished orders, cap at updated_at so the counter doesn't keep running
  const ref = (order.status === 'completed' || order.status === 'cancelled')
    ? new Date(order.updated_at).getTime()
    : Date.now();
  const base = (ref - new Date(order.created_at).getTime()) / 1000;
  const totalPaused = order.total_paused_seconds ?? 0;
  const currentPause = order.paused_at
    ? (ref - new Date(order.paused_at).getTime()) / 1000
    : 0;
  return Math.max(0, base - totalPaused - currentPause);
}

function getProgress(order: Order, times: ProductionTimes): number {
  if (order.status === 'completed' || order.status === 'cancelled') return 100;
  const total = getTotalExpectedSec(times, order.delivery_type === 'delivery');
  const elapsed = getEffectiveElapsed(order);
  return (elapsed / total) * 100;
}

type RiskLevel = 'green' | 'yellow' | 'red' | 'purple' | 'blue' | 'grey';
function getRisk(order: Order, times: ProductionTimes): RiskLevel {
  if (order.status === 'completed') return 'blue';
  if (order.status === 'cancelled') return 'grey';
  if (order.paused_at) return 'purple';
  const p = getProgress(order, times);
  if (p >= 100) return 'red';
  if (p >= 75) return 'yellow';
  return 'green';
}

const RISK_STYLES: Record<RiskLevel, { bar: string; border: string; badge: string; glow: string }> = {
  green:  { bar: 'bg-emerald-500', border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', glow: '' },
  yellow: { bar: 'bg-amber-400',   border: 'border-l-amber-400',   badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',     glow: 'animate-pulse' },
  red:    { bar: 'bg-rose-500',    border: 'border-l-rose-500',    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',         glow: 'animate-pulse' },
  purple: { bar: 'bg-violet-500',  border: 'border-l-violet-500',  badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', glow: '' },
  blue:   { bar: 'bg-sky-400',     border: 'border-l-sky-400',     badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',           glow: '' },
  grey:   { bar: 'bg-muted',       border: 'border-l-muted',       badge: 'bg-muted text-muted-foreground',                                          glow: '' },
};

// ── useTick — forces re-render every second ───────────────────────────────────
function useTick() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

// ── AI Recommendations (rule-based heuristics) ────────────────────────────────
function getRecommendations(orders: Order[], times: ProductionTimes): string[] {
  const active = orders.filter(o => !['completed','cancelled'].includes(o.status) && !o.paused_at);
  const delayed = active.filter(o => getRisk(o, times) === 'red');
  const inPrep = active.filter(o => o.status === 'confirmed');
  const inTransit = active.filter(o => o.status === 'ready');
  const recs: string[] = [];

  if (delayed.length >= 2)
    recs.push(`⚠️ ${delayed.length} pedidos superaron el tiempo prometido. Considera notificar a los clientes.`);
  if (inPrep.length >= 4)
    recs.push(`👨‍🍳 Hay ${inPrep.length} pedidos en preparación simultáneos. Puede haber acumulación en cocina.`);
  if (inTransit.length >= 3)
    recs.push(`🚴 ${inTransit.length} domicilios en tránsito al mismo tiempo. Revisa disponibilidad de repartidores.`);
  if (active.length >= 10)
    recs.push(`📈 Operación con alta demanda (${active.length} pedidos activos). Aumenta la capacidad de cocina.`);
  if (recs.length === 0 && active.length > 0)
    recs.push(`✅ Operación en orden. Todos los pedidos dentro del tiempo esperado.`);
  if (active.length === 0)
    recs.push(`🌟 Sin pedidos activos ahora mismo. ¡Buen momento para preparar ingredientes!`);

  return recs;
}

// ── Progress bar component ────────────────────────────────────────────────────
function ProgressBar({ order, times }: { order: Order; times: ProductionTimes }) {
  const risk = getRisk(order, times);
  const progress = Math.min(100, getProgress(order, times));
  const styles = RISK_STYLES[risk];
  const isDelivery = order.delivery_type === 'delivery';
  const total = getTotalExpectedSec(times, isDelivery);
  const elapsed = getEffectiveElapsed(order);
  const remaining = total - elapsed;

  return (
    <div className="flex-1 min-w-0 space-y-1">
      <div className="relative h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-1000', styles.bar, risk === 'red' && 'animate-pulse')}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{Math.round(progress)}%</span>
        {order.status === 'completed' ? (
          <span className="font-medium text-sky-600">✅ {fmtDuration(elapsed)} total</span>
        ) : order.status === 'cancelled' ? (
          <span className="font-medium text-muted-foreground">Cancelado</span>
        ) : (
          <span className={cn('font-mono font-bold tabular-nums', risk === 'red' ? 'text-rose-600' : risk === 'yellow' ? 'text-amber-600' : risk === 'purple' ? 'text-violet-600' : 'text-foreground')}>
            {order.paused_at ? '⏸ Pausado' : remaining > 0 ? `${fmtDuration(remaining)}` : `+${fmtDuration(-remaining)}`}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Order row ─────────────────────────────────────────────────────────────────
function OrderRow({
  order, times, currency, onPause, onUnpause, onAdvance, onCancel, onCopyTracking,
  onContactWa,
}: {
  order: Order; times: ProductionTimes; currency: string;
  onPause: (o: Order) => void;
  onUnpause: (o: Order) => void;
  onAdvance: (o: Order) => void;
  onCancel: (id: string) => void;
  onCopyTracking: (o: Order) => void;
  onContactWa: (o: Order) => void;
}) {
  const risk = getRisk(order, times);
  const styles = RISK_STYLES[risk];
  const sym = currencySymbol(currency);
  const isActive = !['completed','cancelled'].includes(order.status);
  const isPaused = !!order.paused_at;
  const next = NEXT_STATUS[order.status];
  const code = order.tracking_code ?? order.id.slice(0, 8).toUpperCase();

  return (
    <div className={cn(
      'relative flex items-start gap-3 px-4 py-3 border-b border-border bg-card hover:bg-muted/20 transition-colors border-l-4',
      styles.border,
      risk === 'red' && 'bg-rose-50/30 dark:bg-rose-950/10',
    )}>
      {/* Code */}
      <div className="flex-shrink-0 w-16 pt-0.5">
        <span className={cn('text-xs font-bold font-mono px-1.5 py-0.5 rounded', styles.badge)}>
          #{code.slice(0, 6)}
        </span>
        <div className="text-[10px] text-muted-foreground mt-1">{fmtTime(order.created_at)}</div>
      </div>

      {/* Customer + delivery */}
      <div className="flex-shrink-0 w-44 min-w-0 pt-0.5">
        <div className="font-medium text-sm leading-tight truncate">
          {order.customer_name || 'Cliente anónimo'}
        </div>
        {order.customer_phone && (
          <div className="text-xs text-muted-foreground flex items-center gap-0.5 mt-0.5">
            <Phone className="w-2.5 h-2.5" />
            <span translate="no">{order.customer_phone}</span>
          </div>
        )}
        <div className={cn('inline-flex items-center gap-1 text-[11px] font-medium mt-1 px-1.5 py-0.5 rounded-full',
          order.delivery_type === 'delivery' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' : 'bg-muted text-muted-foreground')}>
          {order.delivery_type === 'delivery' ? '🛵' : order.delivery_type === 'pickup' ? '🛍️' : '🏠'}
          {' '}{DELIVERY_LABEL[order.delivery_type ?? 'local']}
        </div>
        {order.delivery_type === 'delivery' && order.delivery_address && (
          <div className="flex items-start gap-0.5 text-[11px] text-violet-600 mt-0.5">
            <MapPin className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
            <span className="leading-tight truncate">{order.delivery_address}</span>
          </div>
        )}
      </div>

      {/* Progress bar + countdown */}
      <div className="flex-1 min-w-0 flex items-center gap-3 pt-1.5">
        <ProgressBar order={order} times={times} />
      </div>

      {/* Status badge */}
      <div className="flex-shrink-0 w-24 pt-1 text-center">
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full', styles.badge)}>
          <span>{STATUS_EMOJI[order.status]}</span>
          <span className="hidden sm:inline">{STATUS_LABEL[order.status] ?? order.status}</span>
        </span>
        {isPaused && order.pause_reason && (
          <div className="text-[10px] text-violet-600 mt-0.5 leading-tight">{order.pause_reason}</div>
        )}
      </div>

      {/* Value */}
      <div className="flex-shrink-0 w-16 pt-1 text-right">
        <span className="text-sm font-bold text-primary">{sym}{order.total.toFixed(2)}</span>
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex items-center gap-1 pt-0.5">
        {/* Tracking link */}
        <button
          onClick={() => onCopyTracking(order)}
          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
          title="Copiar enlace de seguimiento"
          data-testid={`btn-tracking-${order.id}`}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>

        {/* WA */}
        {order.customer_phone && (
          <button
            onClick={() => onContactWa(order)}
            className="p-1.5 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded transition-colors"
            title="WhatsApp"
            data-testid={`btn-wa-${order.id}`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Pause / Unpause */}
        {isActive && (
          isPaused ? (
            <button
              onClick={() => onUnpause(order)}
              className="p-1.5 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20 rounded transition-colors"
              title="Reanudar"
              data-testid={`btn-unpause-${order.id}`}
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={() => onPause(order)}
              className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
              title="Pausar"
              data-testid={`btn-pause-${order.id}`}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )
        )}

        {/* Advance manually */}
        {isActive && next && (
          <button
            onClick={() => onAdvance(order)}
            className="p-1.5 text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded transition-colors"
            title={`Avanzar a ${STATUS_LABEL[next]}`}
            data-testid={`btn-advance-${order.id}`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Cancel */}
        {isActive && (
          <button
            onClick={() => onCancel(order.id)}
            className="p-1.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
            title="Cancelar pedido"
            data-testid={`btn-cancel-${order.id}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Pause modal ───────────────────────────────────────────────────────────────
function PauseModal({
  order, onConfirm, onClose,
}: {
  order: Order; onConfirm: (reason: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [custom, setCustom] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <h3 className="font-semibold text-base mb-1">⏸ Pausar pedido #{order.tracking_code?.slice(0,6) ?? order.id.slice(0,6).toUpperCase()}</h3>
        <p className="text-xs text-muted-foreground mb-4">El temporizador se congelará hasta que reanudes el pedido.</p>
        <div className="space-y-2 mb-4">
          {PAUSE_REASONS.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={cn(
                'w-full text-left text-sm px-3 py-2 rounded-lg border transition-all',
                reason === r ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:border-primary/40 hover:bg-muted/50'
              )}
            >
              {r}
            </button>
          ))}
        </div>
        {reason === 'Otro' && (
          <input
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mb-4 bg-background"
            placeholder="Escribe el motivo..."
            value={custom}
            onChange={e => setCustom(e.target.value)}
          />
        )}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button
            className="flex-1"
            disabled={!reason || (reason === 'Otro' && !custom.trim())}
            onClick={() => onConfirm(reason === 'Otro' ? custom.trim() : reason)}
          >
            Pausar
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Orders() {
  const { business } = useBusiness();
  const { toast } = useToast();
  const tick = useTick();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'active' | 'all' | 'delayed' | 'completed'>('active');
  const [pausingOrder, setPausingOrder] = useState<Order | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [newOrderAlert, setNewOrderAlert] = useState(false);
  const advancedRef    = useRef<Set<string>>(new Set());
  const flashTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  // null = initial load not done yet (no alert on first paint)
  const knownIdsRef    = useRef<Set<string> | null>(null);
  // Persistent AudioContext — created on first user gesture, reused thereafter
  const audioCtxRef    = useRef<AudioContext | null>(null);
  // Stable ref to triggerAlerts so loadOrders can call it without circular deps
  const triggerRef     = useRef<() => void>(() => {});

  // Unlock / keep-alive the AudioContext on any user interaction
  useEffect(() => {
    type WinW = Window & { webkitAudioContext?: typeof AudioContext };
    const unlock = () => {
      if (!audioCtxRef.current) {
        try {
          const Ctx = window.AudioContext ?? (window as WinW).webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx();
        } catch { /* ignore */ }
      }
      if (audioCtxRef.current?.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => {});
      }
    };
    document.addEventListener('click',   unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
    document.addEventListener('touchend',unlock, { passive: true });
    return () => {
      document.removeEventListener('click',    unlock);
      document.removeEventListener('keydown',  unlock);
      document.removeEventListener('touchend', unlock);
    };
  }, []);

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const times = getProductionTimes(business ?? {});
  const currency = business?.currency ?? 'USD';

  // ── Alert: audio (5 s) + visual flash (60 s) ───────────────────────────────
  const triggerAlerts = useCallback(() => {
    // Audio
    try {
      const ctx = audioCtxRef.current;
      if (ctx) {
        const resume = ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
        resume.then(() => {
          Array.from({ length: 17 }, (_, i) => {
            const t = i * 0.3;
            const osc  = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.value = i % 2 === 0 ? 880 : 660;
            gain.gain.setValueAtTime(0, ctx.currentTime + t);
            gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.27);
            osc.start(ctx.currentTime + t);
            osc.stop(ctx.currentTime + t + 0.3);
          });
        }).catch(() => {});
      }
    } catch (e) { console.warn('[Orders] audio alert error:', e); }
    // Visual
    setNewOrderAlert(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setNewOrderAlert(false), 60_000);
  }, []);

  // Keep triggerRef in sync
  useEffect(() => { triggerRef.current = triggerAlerts; }, [triggerAlerts]);

  // ── Load orders (+ fallback new-order detection) ────────────────────────────
  const loadOrders = useCallback(async () => {
    if (!business?.id) return;
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(200);
    if (data) {
      const newData = data as Order[];
      // Detect genuinely new orders (arrive after page was opened)
      if (knownIdsRef.current !== null) {
        const FIVE_MIN = 5 * 60 * 1000;
        const hasNew = newData.some(o =>
          !knownIdsRef.current!.has(o.id) &&
          Date.now() - new Date(o.created_at).getTime() < FIVE_MIN
        );
        if (hasNew) triggerRef.current();
      }
      knownIdsRef.current = new Set(newData.map(o => o.id));
      setOrders(newData);
    }
    setLoading(false);
  }, [business?.id]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // ── Realtime subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!business?.id) return;
    const channel = supabase
      .channel(`orders_production_${business.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'orders',
        filter: `business_id=eq.${business.id}`,
      }, () => { loadOrders(); })          // fallback detection handles the alert
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'orders',
        filter: `business_id=eq.${business.id}`,
      }, () => { loadOrders(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [business?.id, loadOrders]);

  // ── Auto-advance ────────────────────────────────────────────────────────────
  useEffect(() => {
    const active = orders.filter(o =>
      ['pending','confirmed','ready'].includes(o.status) && !o.paused_at
    );
    for (const order of active) {
      if (advancedRef.current.has(order.id)) continue;
      const isDelivery = order.delivery_type === 'delivery';
      const bp = getBreakpointsSec(times, isDelivery);
      const elapsed = getEffectiveElapsed(order);
      let shouldAdvance = false;
      if (order.status === 'pending'   && elapsed >= bp.toConfirmed) shouldAdvance = true;
      if (order.status === 'confirmed' && elapsed >= bp.toReady)     shouldAdvance = true;
      if (order.status === 'ready'     && elapsed >= bp.toCompleted) shouldAdvance = true;

      if (shouldAdvance) {
        const nextStatus = NEXT_STATUS[order.status];
        if (!nextStatus) continue;
        advancedRef.current.add(order.id);
        (async () => {
          await supabase.from('orders').update({ status: nextStatus, updated_at: new Date().toISOString() }).eq('id', order.id);
          await supabase.from('order_status_history').insert({ order_id: order.id, from_status: order.status, to_status: nextStatus, changed_at: new Date().toISOString(), note: 'Auto-avance' });
          setTimeout(() => advancedRef.current.delete(order.id), 10000);
        })();
      }
    }
  }, [tick, orders, times]);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const advanceOrder = useCallback(async (order: Order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    advancedRef.current.add(order.id);
    await supabase.from('orders').update({ status: next, updated_at: new Date().toISOString() }).eq('id', order.id);
    await supabase.from('order_status_history').insert({ order_id: order.id, from_status: order.status, to_status: next, changed_at: new Date().toISOString() });
    setTimeout(() => advancedRef.current.delete(order.id), 5000);
    toast({ description: `Pedido avanzado a ${STATUS_LABEL[next]}` });
  }, [toast]);

  const pauseOrder = useCallback(async (order: Order, reason: string) => {
    await supabase.from('orders').update({ paused_at: new Date().toISOString(), pause_reason: reason }).eq('id', order.id);
    setPausingOrder(null);
    toast({ description: `Pedido pausado: ${reason}` });
  }, [toast]);

  const unpauseOrder = useCallback(async (order: Order) => {
    if (!order.paused_at) return;
    const pausedSec = Math.floor((Date.now() - new Date(order.paused_at).getTime()) / 1000);
    const newTotal = (order.total_paused_seconds ?? 0) + pausedSec;
    await supabase.from('orders').update({ paused_at: null, pause_reason: null, total_paused_seconds: newTotal }).eq('id', order.id);
    toast({ description: 'Pedido reanudado' });
  }, [toast]);

  const cancelOrder = useCallback(async (id: string) => {
    const order = orders.find(o => o.id === id);
    await supabase.from('orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
    if (order) await supabase.from('order_status_history').insert({ order_id: id, from_status: order.status, to_status: 'cancelled', changed_at: new Date().toISOString() });
    toast({ description: 'Pedido cancelado' });
  }, [orders, toast]);

  const copyTracking = useCallback((order: Order) => {
    const code = order.tracking_code;
    if (!code) return;
    const url = `${window.location.origin}/tracking/${code}`;
    navigator.clipboard.writeText(url).then(() => toast({ description: 'Enlace de seguimiento copiado' }));
  }, [toast]);

  const contactWa = useCallback((order: Order) => {
    if (!order.customer_phone) return;
    const code = order.tracking_code;
    const trackingUrl = code ? `\n\nSigue tu pedido en tiempo real: ${window.location.origin}/tracking/${code}` : '';
    const msg = encodeURIComponent(`${STATUS_EMOJI[order.status]} Tu pedido está en estado: *${STATUS_LABEL[order.status]}*.${trackingUrl}`);
    window.open(getWhatsAppUrl(order.customer_phone, msg), '_blank');
  }, []);

  // ── Computed metrics ─────────────────────────────────────────────────────────
  const todayOrders  = orders.filter(o => isToday(o.created_at));
  const activeOrders = orders.filter(o => !['completed','cancelled'].includes(o.status));
  const delayedOrders = activeOrders.filter(o => getRisk(o, times) === 'red');
  const completedToday = todayOrders.filter(o => o.status === 'completed');
  const pausedOrders = activeOrders.filter(o => !!o.paused_at);

  const onTimeCount = completedToday.filter(o => {
    if (!o.updated_at) return false;
    const elapsed = (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 1000 - (o.total_paused_seconds ?? 0);
    return elapsed <= getTotalExpectedSec(times, o.delivery_type === 'delivery');
  }).length;
  const complianceIdx = completedToday.length > 0 ? Math.round((onTimeCount / completedToday.length) * 100) : null;

  const avgDeliveryMin = completedToday.length > 0
    ? Math.round(completedToday.reduce((acc, o) => {
        if (!o.updated_at) return acc;
        return acc + (new Date(o.updated_at).getTime() - new Date(o.created_at).getTime()) / 60000;
      }, 0) / completedToday.length)
    : null;

  const recommendations = getRecommendations(orders, times);

  // ── Filtered orders for display ──────────────────────────────────────────────
  const displayOrders = (() => {
    let src = [...orders];
    if (filter === 'active')    src = src.filter(o => !['completed','cancelled'].includes(o.status));
    if (filter === 'delayed')   src = src.filter(o => getRisk(o, times) === 'red');
    if (filter === 'completed') src = src.filter(o => isToday(o.created_at) && o.status === 'completed');

    const cancelled = src.filter(o => o.status === 'cancelled');
    const rest      = src.filter(o => o.status !== 'cancelled');

    // Sort: red first, then yellow, then green/purple, then blue
    const priority: Record<RiskLevel, number> = { red: 0, yellow: 1, purple: 2, green: 3, blue: 4, grey: 5 };
    const sorted = rest.sort((a, b) => {
      const pd = priority[getRisk(a, times)] - priority[getRisk(b, times)];
      if (pd !== 0) return pd;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    return showCancelled ? [...sorted, ...cancelled] : sorted;
  })();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">

      {/* ── New-order alert banner (60 s visual + tappable dismiss) ─────────── */}
      {newOrderAlert && (
        <>
          <style>{`
            @keyframes orderFlash {
              0%,100% { background-color: rgb(234 88 12); }
              50%      { background-color: rgb(251 146 60); }
            }
          `}</style>
          <div
            className="flex items-center justify-center gap-3 px-4 py-3 text-white font-bold text-sm cursor-pointer flex-shrink-0 shadow-lg select-none"
            style={{ animation: 'orderFlash 0.55s ease-in-out infinite' }}
            onClick={() => { setNewOrderAlert(false); if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }}
            title="Toca para cerrar"
          >
            <Bell className="w-4 h-4 animate-bounce flex-shrink-0" />
            <span>🛒 ¡NUEVO PEDIDO ENTRANTE!</span>
            <Bell className="w-4 h-4 animate-bounce flex-shrink-0" />
            <span className="text-[11px] font-normal opacity-80 ml-1">· toca para cerrar</span>
          </div>
        </>
      )}

      {/* ── Header + Metrics ─────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-card px-4 py-3 space-y-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h1 className="font-semibold text-base">Centro de Producción</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={triggerAlerts}
              title="Probar alarma de nuevo pedido"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
            >
              <Bell className="w-3 h-3" />
              <span>Test</span>
            </button>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              En vivo
            </div>
          </div>
        </div>

        {/* Metrics strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            { label: 'Activos', val: activeOrders.length, icon: <Zap className="w-3 h-3" />, cls: 'text-foreground' },
            { label: 'Retrasados', val: delayedOrders.length, icon: <AlertTriangle className="w-3 h-3" />, cls: delayedOrders.length > 0 ? 'text-rose-600' : 'text-muted-foreground' },
            { label: 'Pausados', val: pausedOrders.length, icon: <Pause className="w-3 h-3" />, cls: pausedOrders.length > 0 ? 'text-violet-600' : 'text-muted-foreground' },
            { label: 'Entregados hoy', val: completedToday.length, icon: <CheckCircle2 className="w-3 h-3" />, cls: 'text-emerald-600' },
            { label: 'Total hoy', val: todayOrders.length, icon: <ShoppingBag className="w-3 h-3" />, cls: 'text-foreground' },
            { label: 'Promedio real', val: avgDeliveryMin != null ? `${avgDeliveryMin}m` : '—', icon: <Clock className="w-3 h-3" />, cls: avgDeliveryMin != null && avgDeliveryMin > getTotalExpectedSec(times, true)/60 ? 'text-rose-600' : 'text-foreground' },
            {
              label: 'Cumplimiento',
              val: complianceIdx != null ? `${complianceIdx}%` : '—',
              icon: complianceIdx != null && complianceIdx >= 90 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />,
              cls: complianceIdx == null ? 'text-muted-foreground' : complianceIdx >= 90 ? 'text-emerald-600' : complianceIdx >= 70 ? 'text-amber-600' : 'text-rose-600',
            },
          ].map(({ label, val, icon, cls }) => (
            <div key={label} className="bg-muted/40 rounded-lg px-3 py-2 flex items-center gap-2">
              <span className={cn('flex-shrink-0', cls)}>{icon}</span>
              <div className="min-w-0">
                <div className={cn('text-sm font-bold leading-tight tabular-nums', cls)}>{val}</div>
                <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── AI Recommendations ───────────────────────────────────────────────── */}
      <div className="border-b border-border bg-primary/5 px-4 py-2 flex-shrink-0">
        <div className="flex items-start gap-2">
          <Zap className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
          <p className="text-xs text-foreground leading-relaxed">{recommendations[0]}</p>
        </div>
      </div>

      {/* ── Filter tabs ──────────────────────────────────────────────────────── */}
      <div className="border-b border-border px-4 flex items-center gap-0.5 bg-card flex-shrink-0 overflow-x-auto">
        {([
          { id: 'active',    label: `Activos (${activeOrders.length})` },
          { id: 'delayed',   label: `Retrasados (${delayedOrders.length})` },
          { id: 'completed', label: `Entregados hoy (${completedToday.length})` },
          { id: 'all',       label: 'Todos' },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              'px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2',
              filter === tab.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
            data-testid={`tab-filter-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 py-1.5">
          <button
            onClick={() => setShowCancelled(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {showCancelled ? '— Ocultar cancelados' : '+ Ver cancelados'}
          </button>
        </div>
      </div>

      {/* ── Column headers ───────────────────────────────────────────────────── */}
      <div className="border-b border-border bg-muted/30 px-4 py-1.5 flex items-center gap-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex-shrink-0">
        <div className="w-16">Código</div>
        <div className="w-44">Cliente</div>
        <div className="flex-1">Progreso / Tiempo restante</div>
        <div className="w-24 text-center">Estado</div>
        <div className="w-16 text-right">Valor</div>
        <div className="flex-shrink-0 w-28 text-center">Acciones</div>
      </div>

      {/* ── Order list ───────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {displayOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <ShoppingBag className="w-10 h-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground">
              {filter === 'active' ? 'Sin pedidos activos' : filter === 'delayed' ? 'Sin pedidos retrasados 🎉' : 'Sin pedidos'}
            </p>
          </div>
        ) : (
          displayOrders.map(order => (
            <OrderRow
              key={order.id}
              order={order}
              times={times}
              currency={currency}
              onPause={setPausingOrder}
              onUnpause={unpauseOrder}
              onAdvance={advanceOrder}
              onCancel={cancelOrder}
              onCopyTracking={copyTracking}
              onContactWa={contactWa}
            />
          ))
        )}
      </div>

      {/* ── Legend ───────────────────────────────────────────────────────────── */}
      <div className="border-t border-border bg-card px-4 py-2 flex items-center gap-4 flex-shrink-0 flex-wrap">
        <span className="text-[10px] text-muted-foreground font-medium">Leyenda:</span>
        {[
          { color: 'bg-emerald-500', label: 'A tiempo' },
          { color: 'bg-amber-400',   label: 'Por vencer' },
          { color: 'bg-rose-500',    label: 'Retrasado' },
          { color: 'bg-violet-500',  label: 'Pausado' },
          { color: 'bg-sky-400',     label: 'Entregado' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1">
            <div className={cn('w-2.5 h-2.5 rounded-sm', color)} />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="w-3 h-3" />
          Tiempo prometido: {Math.round(getTotalExpectedSec(times, true) / 60)}m entrega · {Math.round(getTotalExpectedSec(times, false) / 60)}m local
        </div>
      </div>

      {/* ── Pause Modal ──────────────────────────────────────────────────────── */}
      {pausingOrder && (
        <PauseModal
          order={pausingOrder}
          onConfirm={reason => pauseOrder(pausingOrder, reason)}
          onClose={() => setPausingOrder(null)}
        />
      )}
    </div>
  );
}
