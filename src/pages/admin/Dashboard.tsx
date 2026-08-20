import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import {
  Package, FolderOpen, ShoppingBag, ExternalLink,
  TrendingUp, Sparkles, Zap, Crown, ArrowUpRight, Loader2,
  MessageCircle, Users, Bell,
} from 'lucide-react';
import { Database } from '@/integrations/supabase/types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart,
} from 'recharts';
import { cn } from '@/lib/utils';
import { isTrial, trialDaysLeft, getEffectivePlan } from '@/lib/planUtils';

type Business = Database['public']['Tables']['businesses']['Row'];
type Period = 'daily' | 'weekly' | 'monthly';

// ── Plan Banner ───────────────────────────────────────────────────────────────

const PLAN_META = {
  free:    { label: 'Plan Gratuito',  icon: Sparkles, bg: 'bg-muted',       border: 'border-border',     text: 'text-muted-foreground', cta: 'Elegir un plan', ctaStyle: 'text-primary' },
  starter: { label: 'Plan Starter',   icon: Zap,      bg: 'bg-primary/5',   border: 'border-primary/20', text: 'text-primary',          cta: 'Mejorar a Pro',  ctaStyle: 'text-amber-600' },
  pro:     { label: 'Plan Pro',       icon: Crown,    bg: 'bg-amber-50',    border: 'border-amber-200',  text: 'text-amber-700',        cta: null,             ctaStyle: '' },
};

function PlanBanner({ business }: { business: Business }) {
  const effectivePlan = getEffectivePlan(business) as keyof typeof PLAN_META;
  const trial = isTrial(business);
  const daysLeft = trialDaysLeft(business);
  const meta = PLAN_META[effectivePlan] ?? PLAN_META.free;
  const Icon = trial ? Sparkles : meta.icon;

  return (
    <div className={`card-elevated p-5 border ${trial ? 'border-violet-200 bg-violet-50 dark:bg-violet-950/20 dark:border-violet-800' : `${meta.border} ${meta.bg}`}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Icon className={`w-4 h-4 ${trial ? 'text-violet-600' : meta.text}`} />
          <div>
            <p className={`text-sm font-medium ${trial ? 'text-violet-700 dark:text-violet-400' : meta.text}`}>
              {trial ? 'Prueba gratuita — acceso completo' : meta.label}
            </p>
            {trial && daysLeft !== null && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {daysLeft > 0 ? `Quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'} de prueba` : 'Prueba expirada — elige un plan'}
              </p>
            )}
          </div>
        </div>
        {trial ? (
          <Link to="/pricing" className="flex items-center gap-1 text-xs font-medium text-violet-600 hover:underline">
            Ver planes <ArrowUpRight className="w-3 h-3" />
          </Link>
        ) : meta.cta ? (
          <Link to="/pricing" className={`flex items-center gap-1 text-xs font-medium hover:underline ${meta.ctaStyle}`}>
            {meta.cta} <ArrowUpRight className="w-3 h-3" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

// ── Orders Chart ──────────────────────────────────────────────────────────────

function buildDailyData(orders: { created_at: string }[]) {
  const days: { label: string; key: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric' });
    days.push({ key, label });
  }
  const counts = new Map(days.map(d => [d.key, 0]));
  orders.forEach(o => {
    const key = o.created_at.slice(0, 10);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return days.map(d => ({ label: d.label, pedidos: counts.get(d.key) ?? 0 }));
}

function buildWeeklyData(orders: { created_at: string }[]) {
  const weeks: { label: string; start: string; end: string }[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i * 7);
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    const label = `${mon.getDate()}/${mon.getMonth() + 1}`;
    weeks.push({ label, start: mon.toISOString().slice(0, 10), end: sun.toISOString().slice(0, 10) });
  }
  return weeks.map(w => ({
    label: w.label,
    pedidos: orders.filter(o => {
      const d = o.created_at.slice(0, 10);
      return d >= w.start && d <= w.end;
    }).length,
  }));
}

function buildMonthlyData(orders: { created_at: string }[]) {
  const months: { label: string; key: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' });
    months.push({ key, label });
  }
  const counts = new Map(months.map(m => [m.key, 0]));
  orders.forEach(o => {
    const key = o.created_at.slice(0, 7);
    if (counts.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return months.map(m => ({ label: m.label, pedidos: counts.get(m.key) ?? 0 }));
}

const PERIOD_LABELS: Record<Period, string> = {
  daily: 'Diario',
  weekly: 'Semanal',
  monthly: 'Mensual',
};

function OrdersChart({ businessId }: { businessId: string }) {
  const [period, setPeriod] = useState<Period>('daily');
  const [orders, setOrders] = useState<{ created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const from = new Date();
    if (period === 'daily')   from.setDate(from.getDate() - 7);
    if (period === 'weekly')  from.setDate(from.getDate() - 56);
    if (period === 'monthly') from.setFullYear(from.getFullYear() - 1);

    supabase
      .from('orders')
      .select('created_at')
      .eq('business_id', businessId)
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setOrders(data ?? []);
        setLoading(false);
      });
  }, [businessId, period]);

  const data = useMemo(() => {
    if (period === 'daily')   return buildDailyData(orders);
    if (period === 'weekly')  return buildWeeklyData(orders);
    return buildMonthlyData(orders);
  }, [orders, period]);

  const total = data.reduce((s, d) => s + d.pedidos, 0);
  const max   = Math.max(...data.map(d => d.pedidos), 1);

  return (
    <div className="card-elevated p-5">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="font-semibold text-base">Evolución de pedidos</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {total} pedido{total !== 1 ? 's' : ''} en el periodo seleccionado
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
          {(['daily', 'weekly', 'monthly'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                period === p
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <ShoppingBag className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm text-muted-foreground">Sin pedidos en este periodo</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="ordersGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              interval={period === 'monthly' ? 1 : 0}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              domain={[0, max + 1]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'hsl(var(--background))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              formatter={(value: number) => [value, 'Pedidos']}
              cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="pedidos"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#ordersGradient)"
              dot={{ fill: 'hsl(var(--primary))', r: 3, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 2, stroke: 'hsl(var(--background))' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── CRM Widget ────────────────────────────────────────────────────────────────

function CrmWidget({ businessId }: { businessId: string }) {
  const [data, setData] = useState<{ unread: number; newLeadsToday: number; activeConvs: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const iso = todayStart.toISOString();

      const [convsRes, leadsRes] = await Promise.all([
        supabase.from('wa_conversations').select('status, unread_count').eq('business_id', businessId),
        supabase.from('wa_contacts').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).gte('created_at', iso),
      ]);

      const convs = convsRes.data ?? [];
      setData({
        unread:       convs.reduce((s, c) => s + (c.unread_count ?? 0), 0),
        newLeadsToday: leadsRes.count ?? 0,
        activeConvs:  convs.filter(c => c.status !== 'resolved').length,
      });
      setLoading(false);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [businessId]);

  return (
    <div className="card-elevated p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-emerald-600" />
          <h2 className="font-medium text-sm">CRM WhatsApp</h2>
        </div>
        <Link
          to="/admin/crm"
          className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
        >
          Ver panel <ArrowUpRight className="w-3 h-3" />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-12">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Bell className="w-3.5 h-3.5 text-amber-500" />
              {(data?.unread ?? 0) > 0 && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-amber-600">{data?.unread ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">No leídos</p>
          </div>
          <div className="text-center border-x border-border">
            <Users className="w-3.5 h-3.5 text-violet-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-violet-600">{data?.newLeadsToday ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Leads hoy</p>
          </div>
          <div className="text-center">
            <MessageCircle className="w-3.5 h-3.5 text-sky-500 mx-auto mb-1" />
            <p className="text-2xl font-bold text-sky-600">{data?.activeConvs ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Activas</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { business } = useBusiness();
  const [stats, setStats] = useState({ products: 0, categories: 0, orders: 0, todayOrders: 0 });

  useEffect(() => {
    if (!business) return;
    const load = async () => {
      const [p, c, o, t] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('categories').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('created_at', new Date().toISOString().slice(0, 10)),
      ]);
      setStats({
        products: p.count || 0,
        categories: c.count || 0,
        orders: o.count || 0,
        todayOrders: t.count || 0,
      });
    };
    load();

    const channel = supabase
      .channel(`dashboard-orders-${business.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${business.id}` }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [business]);

  const tiles = [
    { label: 'Productos',      value: stats.products,    icon: Package,     href: '/admin/products',   color: 'text-blue-600 bg-blue-50' },
    { label: 'Categorías',     value: stats.categories,  icon: FolderOpen,  href: '/admin/categories', color: 'text-orange-600 bg-orange-50' },
    { label: 'Pedidos hoy',    value: stats.todayOrders, icon: TrendingUp,  href: '/admin/orders',     color: 'text-primary bg-primary/10' },
    { label: 'Pedidos totales',value: stats.orders,      icon: ShoppingBag, href: '/admin/orders',     color: 'text-purple-600 bg-purple-50' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{business?.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">Panel de administración</p>
        </div>
        {business && (
          <Link
            to={`/b/${business.slug}`}
            target="_blank"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Ver menú público
          </Link>
        )}
      </div>

      {/* Stats tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(tile => (
          <Link key={tile.label} to={tile.href} className="card-elevated p-4 hover:shadow-md transition-shadow group">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${tile.color}`}>
              <tile.icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-semibold">{tile.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{tile.label}</p>
          </Link>
        ))}
      </div>

      {/* Orders line chart */}
      {business && <OrdersChart businessId={business.id} />}

      {/* CRM WhatsApp widget */}
      {business && <CrmWidget businessId={business.id} />}

      {/* Menu link */}
      {business && (
        <div className="card-elevated p-5">
          <h2 className="font-medium mb-3 text-sm">Tu enlace de menú</h2>
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <code className="text-sm flex-1 truncate">
              {window.location.origin}/b/{business.slug}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/b/${business.slug}`)}
              className="text-xs text-primary hover:underline font-medium flex-shrink-0"
            >
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* Plan status */}
      {business && <PlanBanner business={business} />}
    </div>
  );
}
