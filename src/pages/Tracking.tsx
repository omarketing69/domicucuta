import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, Clock, Package, Truck, ShoppingBag, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────
interface OrderItem { id: string; product_name: string; quantity: number; subtotal: number; }
interface Business { name: string; logo_url?: string | null; primary_color?: string | null; production_times?: unknown; }
interface TrackOrder {
  id: string;
  tracking_code: string;
  status: string;
  created_at: string;
  updated_at: string;
  customer_name: string | null;
  delivery_type: string | null;
  delivery_address: string | null;
  total: number;
  notes: string | null;
  paused_at: string | null;
  total_paused_seconds: number | null;
  order_items: OrderItem[];
  businesses?: Business | null;
}

interface ProductionTimes { reception: number; preparation: number; packaging: number; handoff: number; delivery: number; }
const DEFAULT_TIMES: ProductionTimes = { reception: 2, preparation: 18, packaging: 5, handoff: 3, delivery: 20 };

// ── Status definitions ────────────────────────────────────────────────────────
const STAGES = [
  { key: 'pending',   label: 'Pedido recibido',        icon: ShoppingBag, desc: 'Tu pedido fue registrado correctamente.' },
  { key: 'confirmed', label: 'En preparación',          icon: Package,     desc: 'Estamos preparando tu pedido con cuidado.' },
  { key: 'ready',     label: 'En camino',               icon: Truck,       desc: 'Tu pedido va en camino. ¡Ya casi llega!' },
  { key: 'completed', label: 'Entregado',               icon: CheckCircle2,desc: '¡Pedido entregado! Gracias por tu preferencia.' },
];
const STAGE_ORDER = ['pending','confirmed','ready','completed'];

// ── Time helpers ──────────────────────────────────────────────────────────────
function getTimes(biz?: Business | null): ProductionTimes {
  const pt = biz?.production_times as Partial<ProductionTimes> | undefined;
  return { ...DEFAULT_TIMES, ...pt };
}
function getTotalSec(times: ProductionTimes, isDelivery: boolean): number {
  return (times.reception + times.preparation + times.packaging + (isDelivery ? times.delivery : times.handoff)) * 60;
}
function getElapsed(order: TrackOrder): number {
  const base = (Date.now() - new Date(order.created_at).getTime()) / 1000;
  const paused = order.total_paused_seconds ?? 0;
  const currentPause = order.paused_at ? (Date.now() - new Date(order.paused_at).getTime()) / 1000 : 0;
  return Math.max(0, base - paused - currentPause);
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function addMinutes(iso: string, min: number) {
  return new Date(new Date(iso).getTime() + min * 60000).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function fmtDuration(sec: number) {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.floor(Math.abs(sec) % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Tick ──────────────────────────────────────────────────────────────────────
function useTick() {
  const [, setT] = useState(0);
  useEffect(() => { const id = setInterval(() => setT(t => t + 1), 1000); return () => clearInterval(id); }, []);
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Tracking() {
  const { code } = useParams<{ code: string }>();
  const [order, setOrder] = useState<TrackOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  useTick();

  useEffect(() => {
    if (!code) return;
    (async () => {
      const { data, error } = await supabase
        .rpc('get_order_by_tracking_code', { p_tracking_code: code.toUpperCase() });
      if (error || !data) { setNotFound(true); setLoading(false); return; }
      setOrder(data as unknown as TrackOrder);
      setLoading(false);
    })();
  }, [code]);

  // Poll for status updates. The order lookup is code-scoped (via the RPC
  // above), so we can't use a postgres_changes realtime subscription here
  // without re-exposing the whole orders table to anon reads.
  useEffect(() => {
    if (!code || !order || order.status === 'completed' || order.status === 'cancelled') return;
    const interval = setInterval(async () => {
      const { data } = await supabase
        .rpc('get_order_by_tracking_code', { p_tracking_code: code.toUpperCase() });
      if (data) setOrder(data as unknown as TrackOrder);
    }, 15000);
    return () => clearInterval(interval);
  }, [code, order?.status]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (notFound || !order) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
      <ShoppingBag className="w-12 h-12 text-muted-foreground/20 mb-4" />
      <h1 className="text-lg font-semibold mb-2">Pedido no encontrado</h1>
      <p className="text-sm text-muted-foreground">El enlace de seguimiento no es válido o el pedido ya no existe.</p>
    </div>
  );

  const biz = order.businesses;
  const times = getTimes(biz);
  const isDelivery = order.delivery_type === 'delivery';
  const totalSec = getTotalSec(times, isDelivery);
  const elapsed = getElapsed(order);
  const progress = order.status === 'completed' ? 100 : Math.min(100, (elapsed / totalSec) * 100);
  const remaining = totalSec - elapsed;
  const isPaused = !!order.paused_at;
  const isCompleted = order.status === 'completed';
  const isCancelled = order.status === 'cancelled';
  const currentStageIdx = STAGE_ORDER.indexOf(order.status);
  const primaryColor = biz?.primary_color ?? '#f97316';
  const expectedMinutes = Math.round(totalSec / 60);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-border shadow-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          {biz?.logo_url && (
            <img src={biz.logo_url} alt={biz.name} className="w-8 h-8 object-contain rounded-md flex-shrink-0" />
          )}
          <div className="min-w-0">
            <h1 className="font-bold text-sm leading-tight truncate">{biz?.name ?? 'Tu pedido'}</h1>
            <p className="text-xs text-muted-foreground">Seguimiento #{order.tracking_code}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <div className={cn('w-1.5 h-1.5 rounded-full', isCompleted ? 'bg-sky-400' : 'bg-emerald-500 animate-pulse')} />
            {isCompleted ? 'Completado' : 'En vivo'}
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Status card */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-border p-5">
          {isCancelled ? (
            <div className="text-center py-4">
              <div className="text-4xl mb-2">❌</div>
              <h2 className="font-bold text-lg">Pedido cancelado</h2>
              <p className="text-sm text-muted-foreground mt-1">El pedido fue cancelado. Contacta al negocio si tienes preguntas.</p>
            </div>
          ) : (
            <>
              {/* Status header */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-xl flex-shrink-0"
                  style={{ backgroundColor: isCompleted ? '#22c55e' : isPaused ? '#8b5cf6' : primaryColor }}>
                  {STAGES[Math.max(0, currentStageIdx)]?.label.includes('camino') ? '🚴' :
                   STAGES[Math.max(0, currentStageIdx)]?.label.includes('prep') ? '👨‍🍳' :
                   STAGES[Math.max(0, currentStageIdx)]?.label.includes('Entregado') ? '✅' : '🛒'}
                </div>
                <div>
                  <h2 className="font-bold text-lg leading-tight">
                    {STAGES[Math.max(0, currentStageIdx)]?.label ?? 'Procesando'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {STAGES[Math.max(0, currentStageIdx)]?.desc}
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="relative h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={cn('absolute left-0 top-0 h-full rounded-full transition-all duration-1000',
                      isCompleted ? 'bg-sky-400' : isPaused ? 'bg-violet-500' : progress >= 100 ? 'bg-rose-500' : progress >= 75 ? 'bg-amber-400' : 'bg-emerald-500'
                    )}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                  <span>{Math.round(progress)}% completado</span>
                  {!isCompleted && !isPaused && (
                    <span className="font-mono font-bold">
                      {remaining > 0 ? `~${Math.ceil(remaining / 60)} min restantes` : `+${Math.ceil(-remaining / 60)} min de retraso`}
                    </span>
                  )}
                  {isPaused && <span className="text-violet-600 font-medium">⏸ En pausa</span>}
                  {isCompleted && <span className="text-emerald-600 font-medium">¡Entregado!</span>}
                </div>
              </div>

              {/* ETA */}
              {!isCompleted && !isCancelled && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="w-4 h-4" />
                    <span>Hora estimada de entrega</span>
                  </div>
                  <span className="font-bold">{addMinutes(order.created_at, expectedMinutes)}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Timeline */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-border p-5">
          <h3 className="font-semibold text-sm mb-4">Progreso del pedido</h3>
          <div className="space-y-0">
            {STAGES.map((stage, i) => {
              const done = STAGE_ORDER.indexOf(order.status) > i || order.status === stage.key && isCompleted;
              const active = order.status === stage.key && !isCompleted;
              const pending = !done && !active;
              const Icon = stage.icon;
              return (
                <div key={stage.key} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cn(
                      'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                      done   ? 'bg-emerald-500 text-white' :
                      active ? 'text-white' : 'bg-gray-100 dark:bg-gray-800 text-muted-foreground'
                    )} style={active ? { backgroundColor: primaryColor } : {}}>
                      {done ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </div>
                    {i < STAGES.length - 1 && (
                      <div className={cn('w-0.5 h-8 mt-1', done ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700')} />
                    )}
                  </div>
                  <div className="pt-1.5 pb-6 min-w-0">
                    <p className={cn('text-sm font-medium leading-tight', pending && 'text-muted-foreground')}>
                      {stage.label}
                      {active && <span className="ml-2 inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full font-normal"
                        style={{ backgroundColor: `${primaryColor}20`, color: primaryColor }}>
                        En curso
                      </span>}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{stage.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Order details */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-border p-5">
          <h3 className="font-semibold text-sm mb-3">Detalles del pedido</h3>
          <div className="space-y-2 mb-3">
            {order.order_items.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{item.quantity}× {item.product_name}</span>
                <span className="font-medium">${item.subtotal.toFixed(2)}</span>
              </div>
            ))}
          </div>
          {order.notes && (
            <p className="text-xs text-muted-foreground italic border-t border-border pt-2 mt-2">{order.notes}</p>
          )}
          {order.delivery_address && (
            <div className="flex items-start gap-1.5 border-t border-border pt-2 mt-2 text-xs text-muted-foreground">
              <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>{order.delivery_address}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-border pt-2 mt-2">
            <span className="text-sm font-semibold">Total</span>
            <span className="text-sm font-bold">${order.total.toFixed(2)}</span>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-muted-foreground pb-4">
          Pedido realizado a las {fmtTime(order.created_at)} · Esta página se actualiza automáticamente
        </p>
      </div>
    </div>
  );
}
