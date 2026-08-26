import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Link, useNavigate } from 'react-router-dom';
import {
  Users, MessageSquare, Clock, Send, Plus, Search,
  Wifi, WifiOff, Crown, Loader2, BarChart3,
  Check, CheckCheck, Circle, Phone, ArrowLeft,
  RefreshCw, AlertCircle, Inbox, Bot, Save, Zap, Megaphone, Trash2, X,
  TrendingUp, ShoppingBag, Calendar, ChevronRight, Activity,
  Camera, MessageCircle, BookOpen, GitBranch, UserCheck, Edit2, Headphones,
  FileUp, Download, Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Switch } from '@/components/ui/switch';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  WaContact, WaConversation, WaMessage, WaContactStatus, WaChannel,
  CHANNEL_LABELS, CHANNEL_COLORS,
  sendMetaMessage, subscribeToConversations, subscribeToMessages,
} from '@/lib/whatsappCrm';
import { hasCrmAccess } from '@/lib/sso';
import { getEffectivePlan } from '@/lib/planUtils';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrmSection = 'overview' | 'leads' | 'conversations' | 'queue' | 'agents' | 'followups' | 'actions';

type ConvWithContact = WaConversation & {
  contact: WaContact;
  last_message_preview?: string | null;
  last_message_direction?: 'inbound' | 'outbound' | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<WaContactStatus, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  interested: 'Interesado',
  customer: 'Cliente',
  recurring: 'Recurrente',
};

const STATUS_COLORS: Record<WaContactStatus, string> = {
  new:       'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  interested:'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  customer:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  recurring: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'ahora';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function WaStatusDot({ status }: { status: WaMessage['status'] }) {
  if (status === 'read')      return <CheckCheck className="w-3.5 h-3.5 text-sky-400" />;
  if (status === 'delivered') return <CheckCheck className="w-3.5 h-3.5 text-muted-foreground" />;
  if (status === 'sent')      return <Check className="w-3.5 h-3.5 text-muted-foreground" />;
  if (status === 'failed')    return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
  return <Circle className="w-3 h-3 text-muted-foreground" />;
}

function ChannelIcon({ channel, className }: { channel: WaChannel; className?: string }) {
  if (channel === 'instagram') return <Camera className={cn('text-pink-500', className)} />;
  if (channel === 'messenger') return <MessageCircle className={cn('text-blue-500', className)} />;
  return <MessageSquare className={cn('text-emerald-500', className)} />;
}

// ── Data hooks ────────────────────────────────────────────────────────────────

function useContacts(businessId: string, search: string, status?: WaContactStatus) {
  return useQuery({
    queryKey: ['wa_contacts', businessId, search, status],
    queryFn: async () => {
      let q = supabase
        .from('wa_contacts')
        .select('*', { count: 'exact' })
        .eq('business_id', businessId)
        .order('last_interaction_at', { ascending: false })
        .limit(100);
      if (status) q = q.eq('status', status);
      if (search) q = q.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
      const { data, error, count } = await q;
      if (error) throw error;
      return { contacts: (data ?? []) as WaContact[], count: count ?? 0 };
    },
    enabled: !!businessId,
  });
}

function useConversations(businessId: string) {
  return useQuery({
    queryKey: ['wa_conversations', businessId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_conversations')
        .select('*, contact:wa_contacts(*)')
        .eq('business_id', businessId)
        .order('last_message_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!data || data.length === 0) return [];

      // Batch-fetch the latest message per conversation for preview
      const convIds = data.map(c => c.id);
      const { data: msgs } = await supabase
        .from('wa_messages')
        .select('conversation_id, content, direction, created_at')
        .in('conversation_id', convIds)
        .order('created_at', { ascending: false })
        .limit(convIds.length * 20); // generous ceiling to capture at least 1 per conv

      const lastMsgMap = new Map<string, { content: string | null; direction: string }>();
      for (const m of msgs ?? []) {
        if (!lastMsgMap.has(m.conversation_id)) {
          lastMsgMap.set(m.conversation_id, { content: m.content, direction: m.direction });
        }
      }

      return data.map(c => ({
        ...c,
        last_message_preview: lastMsgMap.get(c.id)?.content ?? null,
        last_message_direction: (lastMsgMap.get(c.id)?.direction ?? null) as 'inbound' | 'outbound' | null,
      })) as ConvWithContact[];
    },
    enabled: !!businessId,
  });
}

function useMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ['wa_messages', conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from('wa_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as WaMessage[];
    },
    enabled: !!conversationId,
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CrmSidebar({
  section,
  setSection,
  openConvCount,
  unreadCount,
  pendingCount,
  waConnected,
}: {
  section: CrmSection;
  setSection: (s: CrmSection) => void;
  openConvCount: number;
  unreadCount: number;
  pendingCount: number;
  waConnected: boolean;
}) {
  const navItems: { id: CrmSection; label: string; icon: typeof BarChart3; badge?: number }[] = [
    { id: 'overview',       label: 'Overview',       icon: BarChart3 },
    { id: 'leads',          label: 'Leads',          icon: Users },
    { id: 'conversations',  label: 'Conversaciones', icon: MessageSquare, badge: unreadCount || undefined },
    { id: 'queue',          label: 'Cola',           icon: Inbox,        badge: pendingCount || undefined },
    { id: 'agents',         label: 'Agente IA',      icon: Bot },
    { id: 'followups',      label: 'Seguimientos',   icon: Clock },
    { id: 'actions',        label: 'Acciones',       icon: RefreshCw },
  ];

  return (
    <div className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-muted/20">
      {/* WA status */}
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {waConnected
            ? <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            : <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />}
          <span className={cn('text-xs font-medium', waConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
            {waConnected ? 'WhatsApp conectado' : 'Sin configurar'}
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(item => (
          <button
            key={item.id}
            data-testid={`crm-nav-${item.id}`}
            onClick={() => setSection(item.id)}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
              section === item.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.badge != null && item.badge > 0 && (
              <Badge variant="destructive" className="h-5 min-w-5 px-1 text-[10px]">
                {item.badge > 99 ? '99+' : item.badge}
              </Badge>
            )}
          </button>
        ))}
      </nav>

      {/* Stats footer */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-[11px] text-muted-foreground">
          {openConvCount} conversaciones abiertas
        </p>
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

const FUNNEL_COLORS: Record<string, string> = {
  new:       '#94a3b8',
  contacted: '#60a5fa',
  interested:'#fbbf24',
  customer:  '#34d399',
  recurring: '#a78bfa',
};

function OverviewView({ businessId }: { businessId: string }) {
  const [activityDays, setActivityDays] = useState<7 | 30>(7);

  // ── Metrics: messages today, new leads, active convs, unread, WA orders, AI rate
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['crm_overview_stats', businessId],
    queryFn: async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const iso = todayStart.toISOString();

      const [
        msgsRes, leadsRes, convsRes, waOrdersRes, aiRes, outboundRes, funnelRes,
      ] = await Promise.all([
        // Fetch channel field so we can compute per-channel breakdown
        supabase.from('wa_messages').select('channel')
          .eq('business_id', businessId).eq('direction', 'inbound').gte('created_at', iso),
        supabase.from('wa_contacts').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).gte('created_at', iso),
        supabase.from('wa_conversations').select('status, unread_count')
          .eq('business_id', businessId),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('wa_attributed', true).gte('created_at', iso),
        supabase.from('wa_messages').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('direction', 'outbound').eq('sent_by_ai', true).gte('created_at', iso),
        supabase.from('wa_messages').select('id', { count: 'exact', head: true })
          .eq('business_id', businessId).eq('direction', 'outbound').gte('created_at', iso),
        supabase.from('wa_contacts').select('status').eq('business_id', businessId),
      ]);

      const convs = convsRes.data ?? [];
      const activeConvs  = convs.filter(c => c.status !== 'resolved').length;
      const unread       = convs.reduce((s, c) => s + (c.unread_count ?? 0), 0);
      const totalOut     = outboundRes.count ?? 0;
      const aiRate       = totalOut > 0 ? Math.round(((aiRes.count ?? 0) / totalOut) * 100) : 0;
      const funnelRaw    = funnelRes.data ?? [];
      const statusCounts = Object.fromEntries(
        (Object.keys(STATUS_LABELS) as WaContactStatus[]).map(s => [
          s, funnelRaw.filter(c => c.status === s).length,
        ])
      );

      // Per-channel message breakdown
      const msgRows = msgsRes.data ?? [];
      const msgsByChannel: Record<string, number> = {};
      for (const row of msgRows) {
        const ch = (row.channel as string) ?? 'whatsapp';
        msgsByChannel[ch] = (msgsByChannel[ch] ?? 0) + 1;
      }
      const msgsToday = msgRows.length;

      return {
        msgsToday,
        msgsByChannel,
        newLeads:   leadsRes.count ?? 0,
        activeConvs,
        unread,
        waOrders:   waOrdersRes.count ?? 0,
        aiRate,
        statusCounts,
        totalContacts: funnelRaw.length,
      };
    },
    enabled: !!businessId,
    refetchInterval: 30_000,
  });

  // ── Activity chart: messages vs orders per day
  const { data: activityData } = useQuery({
    queryKey: ['crm_activity', businessId, activityDays],
    queryFn: async () => {
      const from = new Date();
      from.setDate(from.getDate() - activityDays + 1);
      from.setHours(0, 0, 0, 0);
      const [msgsRes, ordersRes] = await Promise.all([
        supabase.from('wa_messages').select('created_at')
          .eq('business_id', businessId).eq('direction', 'inbound')
          .gte('created_at', from.toISOString()),
        supabase.from('orders').select('created_at')
          .eq('business_id', businessId)
          .gte('created_at', from.toISOString()),
      ]);
      const days: string[] = [];
      for (let i = activityDays - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
      }
      const msgMap   = new Map(days.map(d => [d, 0]));
      const orderMap = new Map(days.map(d => [d, 0]));
      (msgsRes.data ?? []).forEach(m => {
        const d = m.created_at.slice(0, 10);
        if (msgMap.has(d)) msgMap.set(d, (msgMap.get(d) ?? 0) + 1);
      });
      (ordersRes.data ?? []).forEach(o => {
        const d = o.created_at.slice(0, 10);
        if (orderMap.has(d)) orderMap.set(d, (orderMap.get(d) ?? 0) + 1);
      });
      return days.map(d => ({
        label:    new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }),
        mensajes: msgMap.get(d) ?? 0,
        pedidos:  orderMap.get(d) ?? 0,
      }));
    },
    enabled: !!businessId,
  });

  const metricCards = [
    { label: 'Leads nuevos hoy',  value: stats?.newLeads   ?? 0, icon: Users,         color: 'text-violet-600',  bg: 'bg-violet-50 dark:bg-violet-950/30' },
    { label: 'Conversaciones activas', value: stats?.activeConvs ?? 0, icon: Activity, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
    { label: 'Mensajes no leídos', value: stats?.unread    ?? 0, icon: Clock,         color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-950/30' },
    { label: 'Pedidos vía WhatsApp', value: stats?.waOrders ?? 0, icon: ShoppingBag,  color: 'text-rose-600',    bg: 'bg-rose-50 dark:bg-rose-950/30' },
    { label: 'Tasa respuesta IA', value: `${stats?.aiRate ?? 0}%`, icon: Bot,          color: 'text-indigo-600',  bg: 'bg-indigo-50 dark:bg-indigo-950/30' },
  ];

  // Per-channel breakdown for "Mensajes hoy"
  const channelBreakdown: { channel: WaChannel; label: string; count: number }[] = [
    { channel: 'whatsapp',  label: 'WA',  count: stats?.msgsByChannel?.['whatsapp']  ?? 0 },
    { channel: 'instagram', label: 'IG',  count: stats?.msgsByChannel?.['instagram'] ?? 0 },
    { channel: 'messenger', label: 'FB',  count: stats?.msgsByChannel?.['messenger'] ?? 0 },
  ];

  const funnelData = stats
    ? (Object.keys(STATUS_LABELS) as WaContactStatus[]).map(s => ({
        status: s,
        label:  STATUS_LABELS[s],
        count:  stats.statusCounts[s] ?? 0,
        color:  FUNNEL_COLORS[s],
      }))
    : [];
  const maxFunnel = Math.max(...funnelData.map(f => f.count), 1);

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Overview del CRM</h2>
          {statsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Metric cards — "Mensajes hoy" with channel breakdown + 5 standard cards */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {/* Mensajes hoy — special card with per-channel breakdown */}
          <div className="rounded-xl p-4 bg-sky-50 dark:bg-sky-950/30 space-y-2">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-white/60 dark:bg-black/20 text-sky-600">
                <MessageSquare className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground leading-tight">Mensajes hoy</p>
                <p className="text-2xl font-bold mt-0.5 text-sky-600">{stats?.msgsToday ?? 0}</p>
              </div>
            </div>
            {/* Per-channel mini breakdown */}
            <div className="flex items-center gap-2 pt-0.5">
              {channelBreakdown.map(ch => ch.count > 0 && (
                <span key={ch.channel} className={cn(
                  'flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
                  CHANNEL_COLORS[ch.channel]
                )}>
                  <ChannelIcon channel={ch.channel} className="w-3 h-3" />
                  {ch.count}
                </span>
              ))}
              {(stats?.msgsToday ?? 0) === 0 && (
                <span className="text-[10px] text-muted-foreground">Sin mensajes</span>
              )}
            </div>
          </div>

          {metricCards.map(c => (
            <div key={c.label} className={cn('rounded-xl p-4 flex items-start gap-3', c.bg)}>
              <div className={cn('p-2 rounded-lg bg-white/60 dark:bg-black/20', c.color)}>
                <c.icon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground leading-tight">{c.label}</p>
                <p className={cn('text-2xl font-bold mt-0.5', c.color)}>{c.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Activity chart */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Actividad del canal</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Mensajes recibidos vs pedidos generados</p>
            </div>
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
              {([7, 30] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setActivityDays(d)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    activityDays === d
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          {!activityData ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-3">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-3 h-0.5 bg-sky-500 rounded inline-block" />
                  Mensajes WA
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="w-3 h-0.5 bg-emerald-500 rounded inline-block" />
                  Pedidos
                </span>
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={activityData} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <defs>
                    <linearGradient id="crmMsgsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#0ea5e9" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="crmOrdersGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#10b981" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval={activityDays === 7 ? 0 : 4} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--background))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '11px' }}
                    formatter={(v: number, name: string) => [v, name === 'mensajes' ? 'Mensajes' : 'Pedidos']}
                  />
                  <Area type="monotone" dataKey="mensajes" stroke="#0ea5e9" strokeWidth={2} fill="url(#crmMsgsGrad)" dot={false} />
                  <Area type="monotone" dataKey="pedidos"  stroke="#10b981" strokeWidth={2} fill="url(#crmOrdersGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </>
          )}
        </div>

        {/* Lead funnel */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold">Funnel de leads</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stats?.totalContacts ?? 0} contactos en el CRM
              </p>
            </div>
          </div>
          <div className="space-y-2.5">
            {funnelData.map(f => (
              <div key={f.status} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 text-right flex-shrink-0">{f.label}</span>
                <div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.round((f.count / maxFunnel) * 100)}%`,
                      backgroundColor: f.color,
                    }}
                  />
                </div>
                <span className="text-xs font-semibold w-6 text-right flex-shrink-0">{f.count}</span>
              </div>
            ))}
          </div>
          {/* Conversion hint */}
          {stats && stats.totalContacts > 0 && (
            <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
              {Math.round(((stats.statusCounts['customer'] ?? 0) + (stats.statusCounts['recurring'] ?? 0)) / stats.totalContacts * 100)}% de leads convertidos a clientes
            </p>
          )}
        </div>

        {/* Onboarding hint if no data */}
        {!statsLoading && (stats?.totalContacts ?? 0) === 0 && (
          <div className="rounded-xl border p-4 space-y-2">
            <p className="text-sm font-medium">Primeros pasos</p>
            <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
              <li>Configura tu WhatsApp Business API en <strong>Configuración → WhatsApp</strong></li>
              <li>Registra el webhook en Meta for Developers</li>
              <li>Los mensajes entrantes aparecerán en Conversaciones automáticamente</li>
            </ul>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

// ── ContactDetailSheet — unified WA messages + orders for one contact ──────────

function ContactDetailSheet({
  contact,
  businessId,
  open,
  onClose,
}: {
  contact: WaContact | null;
  businessId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'whatsapp' | 'orders'>('whatsapp');

  // WA messages for this contact (includes channel for per-message icon)
  const { data: messages, isLoading: msgsLoading } = useQuery({
    queryKey: ['contact_messages', contact?.id],
    queryFn: async () => {
      if (!contact) return [];
      const { data } = await supabase
        .from('wa_messages')
        .select('id, direction, content, sent_by_ai, created_at, status, channel')
        .eq('business_id', businessId)
        .eq('contact_id', contact.id)
        .order('created_at', { ascending: false })
        .limit(40);
      return (data ?? []).reverse();
    },
    enabled: !!contact && open,
  });

  // Orders for this contact (by phone)
  const { data: orders, isLoading: ordersLoading } = useQuery({
    queryKey: ['contact_orders', businessId, contact?.phone],
    queryFn: async () => {
      if (!contact?.phone) return [];
      const { data } = await supabase
        .from('orders')
        .select('id, status, total, created_at, notes, delivery_type, wa_attributed')
        .eq('business_id', businessId)
        .eq('customer_phone', contact.phone)
        .order('created_at', { ascending: false })
        .limit(30);
      return data ?? [];
    },
    enabled: !!contact?.phone && open,
  });

  const ORDER_STATUS_LABEL: Record<string, string> = {
    pending: 'Entrada', confirmed: 'En preparación', ready: 'En camino',
    completed: 'Entregado', cancelled: 'Cancelado',
  };
  const ORDER_STATUS_COLOR: Record<string, string> = {
    pending:   'bg-amber-100 text-amber-700',
    confirmed: 'bg-blue-100 text-blue-700',
    ready:     'bg-violet-100 text-violet-700',
    completed: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-rose-100 text-rose-600',
  };

  function fmtCurrency(n: number) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
  }

  if (!contact) return null;

  const totalSpent = (orders ?? []).filter(o => o.status === 'completed').reduce((s, o) => s + o.total, 0);

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-border bg-muted/20 flex-shrink-0">
          <SheetHeader className="mb-3">
            <SheetTitle className="sr-only">Detalle del contacto</SheetTitle>
          </SheetHeader>
          <div className="flex items-start gap-3">
            <Avatar className="w-12 h-12 flex-shrink-0">
              <AvatarFallback className="text-base font-bold">{initials(contact.name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base leading-tight truncate">{contact.name ?? contact.phone}</p>
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                <Phone className="w-3 h-3" /> {contact.phone}
              </p>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium mt-1 inline-block', STATUS_COLORS[contact.status])}>
                {STATUS_LABELS[contact.status]}
              </span>
            </div>
          </div>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 mt-3">
            <div className="rounded-lg bg-background border p-2 text-center">
              <p className="text-xs text-muted-foreground">Mensajes</p>
              <p className="text-sm font-bold">{messages?.length ?? '—'}</p>
            </div>
            <div className="rounded-lg bg-background border p-2 text-center">
              <p className="text-xs text-muted-foreground">Pedidos</p>
              <p className="text-sm font-bold">{orders?.length ?? '—'}</p>
            </div>
            <div className="rounded-lg bg-background border p-2 text-center">
              <p className="text-xs text-muted-foreground">Gastado</p>
              <p className="text-xs font-bold">{totalSpent > 0 ? fmtCurrency(totalSpent) : '—'}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border flex-shrink-0">
          {([
            { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
            { id: 'orders',   label: 'Pedidos',  icon: ShoppingBag },
          ] as const).map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              data-testid={`contact-tab-${t.id}`}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors border-b-2',
                tab === t.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'whatsapp' ? (
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {msgsLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !messages?.length ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">Sin mensajes registrados</p>
                  </div>
                ) : (
                  messages.map(msg => {
                    const msgCh = (msg as unknown as { channel?: string }).channel as WaChannel ?? 'whatsapp';
                    return (
                    <div
                      key={msg.id}
                      className={cn('flex', msg.direction === 'outbound' ? 'justify-end' : 'justify-start')}
                    >
                      <div
                        className={cn(
                          'max-w-[78%] rounded-2xl px-3 py-2 text-sm',
                          msg.direction === 'outbound'
                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                            : 'bg-muted rounded-bl-sm'
                        )}
                      >
                        <p className="leading-snug break-words">{msg.content}</p>
                        <div className={cn(
                          'flex items-center gap-1 mt-1 text-[10px]',
                          msg.direction === 'outbound' ? 'text-primary-foreground/60 justify-end' : 'text-muted-foreground justify-end'
                        )}>
                          {msg.sent_by_ai && <Bot className="w-2.5 h-2.5" />}
                          <ChannelIcon channel={msgCh} className="w-2.5 h-2.5 opacity-70" />
                          {fmtTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-4 space-y-2">
                {ordersLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : !orders?.length ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <ShoppingBag className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {contact.phone ? 'Sin pedidos registrados' : 'Sin teléfono — no se pueden buscar pedidos'}
                    </p>
                  </div>
                ) : (
                  orders.map(order => (
                    <div key={order.id} className="rounded-xl border bg-card p-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ORDER_STATUS_COLOR[order.status] ?? 'bg-muted text-muted-foreground')}>
                          {ORDER_STATUS_LABEL[order.status] ?? order.status}
                        </span>
                        {order.wa_attributed && (
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                            <MessageSquare className="w-3 h-3" /> Via WA
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(order.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {order.notes ? order.notes.slice(0, 45) + (order.notes.length > 45 ? '…' : '') : 'Sin notas'}
                        </span>
                        <span className="text-sm font-bold">{fmtCurrency(order.total)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Lead import helpers ────────────────────────────────────────────────────────

type LeadRow = { phone: string; name: string; notes: string; status: WaContactStatus };

const COL_MAP: Record<string, keyof LeadRow> = {
  telefono: 'phone', phone: 'phone', tel: 'phone', celular: 'phone', movil: 'phone', móvil: 'phone',
  nombre: 'name', name: 'name', contacto: 'name', cliente: 'name',
  notas: 'notes', notes: 'notes', nota: 'notes', comentario: 'notes', comentarios: 'notes',
  estado: 'status', status: 'status', etapa: 'status', fase: 'status',
};

const VALID_STATUSES = new Set<string>(['new', 'contacted', 'interested', 'customer', 'recurring']);
const STATUS_ALIASES: Record<string, WaContactStatus> = {
  nuevo: 'new', new: 'new',
  contactado: 'contacted', contacted: 'contacted',
  interesado: 'interested', interested: 'interested',
  cliente: 'customer', customer: 'customer',
  recurrente: 'recurring', recurring: 'recurring',
};

function parseLeadSheet(file: File): Promise<{ leads: LeadRow[]; skippedParse: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
        const leads: LeadRow[] = [];
        let skippedParse = 0;
        for (const row of rows) {
          const mapped: Partial<LeadRow> = {};
          for (const [rawKey, val] of Object.entries(row)) {
            const key = rawKey.toLowerCase().trim().replace(/\s+/g, '');
            const field = COL_MAP[key];
            if (field) mapped[field] = String(val ?? '').trim();
          }
          if (!mapped.phone) { skippedParse++; continue; }
          const statusRaw = (mapped.status ?? '').toLowerCase();
          const status: WaContactStatus = VALID_STATUSES.has(statusRaw)
            ? (statusRaw as WaContactStatus)
            : (STATUS_ALIASES[statusRaw] ?? 'new');
          leads.push({ phone: mapped.phone, name: mapped.name || mapped.phone, notes: mapped.notes ?? '', status });
        }
        resolve({ leads, skippedParse });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo'));
    reader.readAsArrayBuffer(file);
  });
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['telefono', 'nombre', 'notas', 'estado'],
    ['573001234567', 'Juan Pérez', 'Interesado en el combo familiar', 'new'],
    ['573009876543', 'María López', 'Prefiere domicilio', 'contacted'],
  ]);
  ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 35 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  XLSX.writeFile(wb, 'plantilla_leads.xlsx');
}

function LeadImportDialog({ businessId, open, onOpenChange }: { businessId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [parseSkipped, setParseSkipped] = useState(0);
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setParseSkipped(0); setFileName(''); setParsed(false); };

  const handleFile = async (file: File) => {
    setFileName(file.name);
    try {
      const { leads, skippedParse } = await parseLeadSheet(file);
      setRows(leads);
      setParseSkipped(skippedParse);
      setParsed(true);
    } catch {
      toast({ title: 'Error al leer el archivo', description: 'Verifica que sea un .xlsx, .xls o .csv válido.', variant: 'destructive' });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setImporting(true);
    let imported = 0; let skippedDb = 0;
    const CHUNK = 100;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK).map(r => ({
        business_id: businessId,
        phone: r.phone,
        name: r.name,
        notes: r.notes || null,
        status: r.status,
      }));
      const { error } = await supabase.from('wa_contacts')
        .upsert(chunk, { onConflict: 'business_id,phone', ignoreDuplicates: false });
      if (error) {
        // Fallback: try row-by-row so valid rows in the chunk still import
        for (const row of chunk) {
          const { error: rowErr } = await supabase.from('wa_contacts')
            .upsert([row], { onConflict: 'business_id,phone', ignoreDuplicates: false });
          if (rowErr) skippedDb++;
          else imported++;
        }
      } else {
        imported += chunk.length;
      }
    }
    setImporting(false);
    const totalSkipped = parseSkipped + skippedDb;
    const parts: string[] = [];
    if (imported > 0) parts.push(`${imported} lead${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''}`);
    if (parseSkipped > 0) parts.push(`${parseSkipped} sin teléfono omitido${parseSkipped !== 1 ? 's' : ''}`);
    if (skippedDb > 0) parts.push(`${skippedDb} con error de base de datos`);
    toast({
      title: totalSkipped > 0 ? 'Importación con advertencias' : 'Importación completada',
      description: parts.join(' · ') || 'Sin cambios.',
    });
    qc.invalidateQueries({ queryKey: ['wa_contacts', businessId] });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar leads desde archivo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {/* Template download */}
          <div className="flex items-center justify-between p-3 bg-muted/40 rounded-lg border border-dashed border-border">
            <div>
              <p className="text-sm font-medium">¿Primera vez?</p>
              <p className="text-xs text-muted-foreground">Descarga la plantilla con el formato correcto</p>
            </div>
            <Button size="sm" variant="outline" onClick={downloadTemplate} className="gap-1.5">
              <Download className="w-3.5 h-3.5" /> Plantilla .xlsx
            </Button>
          </div>

          {/* Drop zone */}
          {!parsed ? (
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'flex flex-col items-center justify-center gap-3 h-36 rounded-lg border-2 border-dashed cursor-pointer transition-colors',
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
              )}
            >
              <Upload className="w-8 h-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Arrastra tu archivo aquí</p>
                <p className="text-xs text-muted-foreground">o haz clic para seleccionar · .xlsx, .xls, .csv</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* File info bar */}
              <div className="flex items-center justify-between px-3 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <FileUp className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700 dark:text-green-400 truncate max-w-[220px]">{fileName}</span>
                  <span className="text-xs text-green-600 dark:text-green-500 font-medium">{rows.length} lead{rows.length !== 1 ? 's' : ''} detectado{rows.length !== 1 ? 's' : ''}</span>
                  {parseSkipped > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">{parseSkipped} sin teléfono</span>
                  )}
                </div>
                <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Preview table */}
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="bg-muted/40 px-3 py-1.5 border-b border-border">
                  <p className="text-xs font-medium text-muted-foreground">Vista previa — primeros {Math.min(rows.length, 5)} de {rows.length} registros</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Teléfono</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nombre</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Notas</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-1.5 font-mono">{r.phone}</td>
                          <td className="px-3 py-1.5 truncate max-w-[120px]">{r.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[120px]">{r.notes || '—'}</td>
                          <td className="px-3 py-1.5">
                            <span className={cn('px-1.5 py-0.5 rounded-full font-medium', STATUS_COLORS[r.status])}>
                              {STATUS_LABELS[r.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Los leads con teléfono duplicado se actualizarán sin crear duplicados.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); reset(); }}>Cancelar</Button>
          <Button onClick={handleImport} disabled={!parsed || importing || !rows.length} className="gap-2">
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            {importing ? 'Importando…' : `Importar ${rows.length > 0 ? rows.length + ' lead' + (rows.length !== 1 ? 's' : '') : 'leads'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Leads ─────────────────────────────────────────────────────────────────────

function LeadsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<WaContactStatus | 'all'>('all');
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [selectedContact, setSelectedContact] = useState<WaContact | null>(null);

  const { data, isLoading } = useContacts(businessId, search, statusFilter === 'all' ? undefined : statusFilter);

  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`crm-leads-${businessId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wa_contacts', filter: `business_id=eq.${businessId}` }, () => {
        qc.invalidateQueries({ queryKey: ['wa_contacts', businessId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [businessId, qc]);

  const handleCreate = async () => {
    if (!form.phone.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('wa_contacts').insert({
      business_id: businessId,
      phone: form.phone.trim(),
      name: form.name.trim() || form.phone.trim(),
      notes: form.notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Lead creado' });
      qc.invalidateQueries({ queryKey: ['wa_contacts', businessId] });
      setNewLeadOpen(false);
      setForm({ name: '', phone: '', notes: '' });
    }
  };

  const handleStatusChange = async (contactId: string, status: WaContactStatus) => {
    const { error } = await supabase.from('wa_contacts').update({ status }).eq('id', contactId);
    if (!error) qc.invalidateQueries({ queryKey: ['wa_contacts', businessId] });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Buscar nombre o teléfono…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-crm-leads-search"
          />
        </div>
        <Select value={statusFilter} onValueChange={v => setStatusFilter(v as WaContactStatus | 'all')}>
          <SelectTrigger className="w-36 h-9" data-testid="select-crm-leads-status">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {(Object.keys(STATUS_LABELS) as WaContactStatus[]).map(s => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} data-testid="button-crm-import-leads" className="gap-1.5">
          <FileUp className="w-4 h-4" />
          Importar
        </Button>
        <Button size="sm" onClick={() => setNewLeadOpen(true)} data-testid="button-crm-new-lead">
          <Plus className="w-4 h-4 mr-1.5" />
          Nuevo lead
        </Button>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.contacts.length ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <Users className="w-10 h-10 opacity-30" />
            <p className="text-sm">No hay leads todavía</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-3 font-medium text-muted-foreground">Contacto</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Teléfono</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estado</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Score</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Última interacción</th>
              </tr>
            </thead>
            <tbody>
              {data.contacts.map(contact => (
                <tr
                  key={contact.id}
                  data-testid={`row-lead-${contact.id}`}
                  onClick={() => setSelectedContact(contact)}
                  className="border-b border-border hover:bg-muted/20 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar className="w-7 h-7">
                        <AvatarFallback className="text-xs">{initials(contact.name)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <span className="font-medium">{contact.name ?? contact.phone}</span>
                        <ChevronRight className="w-3 h-3 text-muted-foreground inline ml-1 opacity-0 group-hover:opacity-100" />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{contact.phone}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <Select
                      value={contact.status}
                      onValueChange={v => handleStatusChange(contact.id, v as WaContactStatus)}
                    >
                      <SelectTrigger className={cn('h-6 w-32 text-xs border-0 px-2', STATUS_COLORS[contact.status])}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_LABELS) as WaContactStatus[]).map(s => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-muted-foreground">{contact.score}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {fmtTime(contact.last_interaction_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* Unified contact detail sheet */}
      <ContactDetailSheet
        contact={selectedContact}
        businessId={businessId}
        open={!!selectedContact}
        onClose={() => setSelectedContact(null)}
      />

      {/* Import Dialog */}
      <LeadImportDialog businessId={businessId} open={importOpen} onOpenChange={setImportOpen} />

      {/* New Lead Dialog */}
      <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="lead-phone">Teléfono WhatsApp *</Label>
              <Input
                id="lead-phone"
                placeholder="573001234567"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                data-testid="input-new-lead-phone"
              />
              <p className="text-xs text-muted-foreground">Incluye el código de país (ej: 57 para Colombia)</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-name">Nombre</Label>
              <Input
                id="lead-name"
                placeholder="Nombre del contacto"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-new-lead-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-notes">Notas</Label>
              <Textarea
                id="lead-notes"
                placeholder="Notas opcionales…"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                data-testid="input-new-lead-notes"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewLeadOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving || !form.phone.trim()} data-testid="button-new-lead-save">
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Message Thread ────────────────────────────────────────────────────────────

function MessageThread({
  conversation,
  businessId,
  onBack,
}: {
  conversation: ConvWithContact;
  businessId: string;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const { data: messages = [], isLoading } = useMessages(conversation.id);

  // Mark conversation as read
  useEffect(() => {
    if (conversation.unread_count > 0) {
      supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', conversation.id).then(() => {
        qc.invalidateQueries({ queryKey: ['wa_conversations', businessId] });
      });
    }
  }, [conversation.id, conversation.unread_count, businessId, qc]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Realtime subscription
  useEffect(() => {
    const channel = subscribeToMessages(conversation.id, () => {
      qc.invalidateQueries({ queryKey: ['wa_messages', conversation.id] });
    });
    return () => { supabase.removeChannel(channel); };
  }, [conversation.id, qc]);

  const handleSend = async () => {
    const msg = text.trim();
    if (!msg) return;
    setSending(true);
    setText('');
    const ch = conversation.channel ?? 'whatsapp';
    const recipientId = ch === 'whatsapp'
      ? (conversation.contact?.phone ?? '')
      : (conversation.contact?.external_id ?? '');
    const result = await sendMetaMessage({
      channel: ch as WaChannel,
      recipientId,
      message: msg,
      businessId,
      conversationId: conversation.id,
      contactId: conversation.contact?.id ?? '',
    });
    setSending(false);
    if (!result.success) {
      toast({ title: 'Error al enviar', description: result.error, variant: 'destructive' });
      setText(msg);
    } else {
      if (conversation.needs_human) {
        await supabase.from('wa_conversations').update({ needs_human: false }).eq('id', conversation.id);
      }
      qc.invalidateQueries({ queryKey: ['wa_messages', conversation.id] });
      qc.invalidateQueries({ queryKey: ['wa_conversations', businessId] });
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 lg:hidden" onClick={onBack}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Avatar className="w-8 h-8">
          <AvatarFallback className="text-xs">{initials(conversation.contact?.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-sm leading-tight truncate">
              {conversation.contact?.name ?? conversation.contact?.phone ?? conversation.contact?.external_id}
            </p>
            <span className={cn(
              'flex-shrink-0 flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium',
              CHANNEL_COLORS[(conversation.channel ?? 'whatsapp') as WaChannel]
            )}>
              <ChannelIcon channel={(conversation.channel ?? 'whatsapp') as WaChannel} className="w-3 h-3" />
              {CHANNEL_LABELS[(conversation.channel ?? 'whatsapp') as WaChannel]}
            </span>
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Phone className="w-3 h-3" />
            {conversation.contact?.phone ?? conversation.contact?.external_id ?? '—'}
          </p>
        </div>
        <div className="ml-auto flex-shrink-0 flex items-center gap-2">
          {conversation.needs_human && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 gap-1 text-xs border-amber-300 text-amber-700 dark:text-amber-400 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
              onClick={async () => {
                await supabase.from('wa_conversations').update({ needs_human: false }).eq('id', conversation.id);
                qc.invalidateQueries({ queryKey: ['wa_conversations', businessId] });
              }}
            >
              <Bot className="w-3 h-3" />
              Reactivar IA
            </Button>
          )}
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium',
            conversation.contact?.status ? STATUS_COLORS[conversation.contact.status as WaContactStatus] : ''
          )}>
            {STATUS_LABELS[conversation.contact?.status as WaContactStatus] ?? '—'}
          </span>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4">
        <div className="py-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No hay mensajes aún. Envía el primero.
            </p>
          ) : (
            messages.map(msg => {
              const isOut = msg.direction === 'outbound';
              const isAi  = msg.sent_by_ai === true;
              return (
                <div
                  key={msg.id}
                  data-testid={`msg-${msg.direction}-${msg.id}`}
                  className={cn('flex flex-col gap-1', isOut ? 'items-end' : 'items-start')}
                >
                  {/* AI badge shown above the bubble */}
                  {isAi && (
                    <span className="flex items-center gap-1 text-[10px] text-violet-600 dark:text-violet-400 font-medium px-1">
                      <Bot className="w-3 h-3" />
                      Respuesta automática
                    </span>
                  )}
                  <div className={cn(
                    'max-w-[75%] rounded-2xl px-3.5 py-2.5 space-y-1',
                    isOut
                      ? isAi
                        ? 'bg-violet-600 text-white rounded-br-sm'
                        : 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  )}>
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content ?? '—'}</p>
                    <div className={cn(
                      'flex items-center gap-1 text-[10px]',
                      isOut ? 'justify-end text-white/70' : 'text-muted-foreground'
                    )}>
                      <span>{fmtTime(msg.wa_timestamp ?? msg.created_at)}</span>
                      {isOut && <WaStatusDot status={msg.status} />}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
        <textarea
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder="Escribe un mensaje…"
          className="flex-1 resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-28"
          style={{ height: 'auto', minHeight: '40px' }}
          data-testid="input-crm-message"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="flex-shrink-0 h-10 w-10 p-0 rounded-xl"
          data-testid="button-crm-send"
        >
          {sending
            ? <Loader2 className="w-4 h-4 animate-spin" />
            : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}

// ── Conversations view ────────────────────────────────────────────────────────

const CHANNEL_FILTER_OPTIONS: { value: WaChannel | 'all'; label: string }[] = [
  { value: 'all',       label: 'Todos' },
  { value: 'whatsapp',  label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'messenger', label: 'Messenger' },
];

function ConversationsView({
  businessId,
  filter = 'all',
}: {
  businessId: string;
  filter?: 'all' | 'pending';
}) {
  const qc = useQueryClient();
  const { data: conversations = [], isLoading } = useConversations(businessId);
  const [selected, setSelected] = useState<ConvWithContact | null>(null);
  const [channelFilter, setChannelFilter] = useState<WaChannel | 'all'>('all');

  // Realtime subscription
  useEffect(() => {
    const channel = subscribeToConversations(businessId, () => {
      qc.invalidateQueries({ queryKey: ['wa_conversations', businessId] });
    });
    return () => { supabase.removeChannel(channel); };
  }, [businessId, qc]);

  const filtered = conversations
    .filter(c => filter === 'pending' ? c.status === 'pending' : c.status !== 'resolved')
    .filter(c => channelFilter === 'all' || (c.channel ?? 'whatsapp') === channelFilter)
    .sort(filter === 'pending'
      ? (a, b) => new Date(a.last_message_at ?? 0).getTime() - new Date(b.last_message_at ?? 0).getTime()
      : () => 0
    );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className={cn(
        'border-r border-border flex flex-col',
        selected ? 'hidden lg:flex w-72 flex-shrink-0' : 'flex-1 lg:flex lg:w-72 lg:flex-shrink-0'
      )}>
        <div className="px-4 py-3 border-b border-border flex-shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              {filter === 'pending' ? 'Cola de espera' : 'Conversaciones activas'}
            </p>
            <p className="text-xs text-muted-foreground">{filtered.length} {filter === 'pending' ? 'pendientes' : 'abiertas'}</p>
          </div>
          {/* Channel filter chips */}
          <div className="flex items-center gap-1 flex-wrap">
            {CHANNEL_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                data-testid={`conv-channel-filter-${opt.value}`}
                onClick={() => setChannelFilter(opt.value)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors',
                  channelFilter === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <MessageSquare className="w-10 h-10 opacity-30" />
              <p className="text-sm">
                {filter === 'pending' ? 'Sin mensajes en cola' : 'Sin conversaciones'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(conv => (
                <button
                  key={conv.id}
                  data-testid={`conv-item-${conv.id}`}
                  onClick={() => setSelected(conv)}
                  className={cn(
                    'w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors',
                    selected?.id === conv.id
                      ? 'bg-primary/5 border-l-2 border-l-primary'
                      : 'hover:bg-muted/30'
                  )}
                >
                  <Avatar className="w-9 h-9 flex-shrink-0 mt-0.5">
                    <AvatarFallback className="text-xs">
                      {initials(conv.contact?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {conv.contact?.name ?? conv.contact?.phone ?? conv.contact?.external_id}
                        </p>
                        {(conv.channel ?? 'whatsapp') !== 'whatsapp' && (
                          <span className={cn(
                            'flex-shrink-0 flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded font-semibold',
                            CHANNEL_COLORS[(conv.channel ?? 'whatsapp') as WaChannel]
                          )}>
                            <ChannelIcon channel={(conv.channel ?? 'whatsapp') as WaChannel} className="w-2.5 h-2.5" />
                            {conv.channel === 'instagram' ? 'IG' : 'FB'}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground flex-shrink-0">
                        {fmtTime(conv.last_message_at)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.last_message_preview
                          ? (
                            <span className="flex items-center gap-1">
                              {conv.last_message_direction === 'outbound' && (
                                <span className="text-sky-500 flex-shrink-0">↑</span>
                              )}
                              {conv.last_message_preview.slice(0, 55)}
                              {conv.last_message_preview.length > 55 ? '…' : ''}
                            </span>
                          )
                          : (conv.contact?.phone ?? conv.contact?.external_id ?? '—')}
                      </p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {conv.needs_human && (
                          <Badge className="h-4 px-1 text-[9px] bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700">
                            Humano
                          </Badge>
                        )}
                        {conv.unread_count > 0 && (
                          <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
                            {conv.unread_count}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Thread */}
      <div className={cn('flex-1', selected ? 'flex flex-col' : 'hidden lg:flex lg:flex-col')}>
        {selected ? (
          <MessageThread
            conversation={selected}
            businessId={businessId}
            onBack={() => setSelected(null)}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <MessageSquare className="w-12 h-12 opacity-20" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agentes IA view ───────────────────────────────────────────────────────────

const INTENT_LABELS: Record<string, string> = {
  order: 'Pedido',
  inquiry: 'Consulta',
  complaint: 'Queja',
  follow_up: 'Seguimiento',
  other: 'Otro',
};

const INTENT_COLORS: Record<string, string> = {
  order:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  inquiry:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  complaint: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  follow_up: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  other:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

// ── AgentesView constants ─────────────────────────────────────────────────────

const AI_MODELS = [
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B — recomendado (Gratis)' },
  { value: 'qwen/qwen-2.5-72b-instruct:free',        label: 'Qwen 2.5 72B — muy capaz (Gratis)' },
  { value: 'google/gemma-3-27b-it:free',              label: 'Gemma 3 27B — Google (Gratis)' },
  { value: 'mistralai/mistral-7b-instruct:free',      label: 'Mistral 7B — ligero y rápido (Gratis)' },
];

const VOICE_LANGS = [
  { value: 'es-CO', label: '🇨🇴 Español (Colombia)' },
  { value: 'es-MX', label: '🇲🇽 Español (México)' },
  { value: 'es-ES', label: '🇪🇸 Español (España)' },
  { value: 'es-AR', label: '🇦🇷 Español (Argentina)' },
  { value: 'es-US', label: '🇺🇸 Español (EE.UU.)' },
  { value: 'en-US', label: '🇺🇸 English (US)' },
];

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS_MAP: Record<string, string> = {
  mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom',
};

type KbItem   = { id: string; type: 'faq' | 'policy' | 'info' | 'promo'; title: string; content: string };
type FlowNode = {
  id: string; business_id: string; name: string;
  trigger_keywords: string[]; trigger_intent: string | null;
  response_template: string; sort_order: number; is_active: boolean; created_at: string;
};
type DaySchedule = { open: string; close: string } | null;
type OpsHours    = { timezone: string } & Record<string, DaySchedule | string | undefined>;

// ── Main container ────────────────────────────────────────────────────────────

function AgentesView({ businessId }: { businessId: string }) {
  const [tab, setTab] = useState<'general' | 'knowledge' | 'flows' | 'handoff'>('general');

  const tabs = [
    { id: 'general',   label: 'General',      icon: Bot       },
    { id: 'knowledge', label: 'Conocimiento',  icon: BookOpen  },
    { id: 'flows',     label: 'Flujos',        icon: GitBranch },
    { id: 'handoff',   label: 'Transferencia', icon: Headphones },
  ] as const;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-6 flex items-center flex-shrink-0 bg-background">
        {tabs.map(t => (
          <button
            key={t.id}
            data-testid={`tab-agent-${t.id}`}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap',
              tab === t.id
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {tab === 'general'   && <AgentGeneralTab   businessId={businessId} />}
        {tab === 'knowledge' && <AgentKnowledgeTab businessId={businessId} />}
        {tab === 'flows'     && <AgentFlowsTab     businessId={businessId} />}
        {tab === 'handoff'   && <AgentHandoffTab   businessId={businessId} />}
      </div>
    </div>
  );
}

// ── General tab ───────────────────────────────────────────────────────────────

function AgentGeneralTab({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const defaultHours: OpsHours = {
    timezone: 'America/Bogota',
    mon: { open: '08:00', close: '22:00' }, tue: { open: '08:00', close: '22:00' },
    wed: { open: '08:00', close: '22:00' }, thu: { open: '08:00', close: '22:00' },
    fri: { open: '08:00', close: '22:00' }, sat: { open: '09:00', close: '20:00' },
    sun: null,
  };
  const [form, setForm] = useState({
    ai_enabled: false, ai_prompt: '', ai_auto_reply_mode: 'disabled',
    ai_model: 'meta-llama/llama-3.3-70b-instruct:free', ai_operating_hours: defaultHours as OpsHours,
    ai_voice_lang: 'es-CO',
  });

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['business_ai_config', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('businesses')
        .select('ai_enabled, ai_prompt, ai_auto_reply_mode, ai_model, ai_operating_hours, ai_voice_lang')
        .eq('id', businessId).single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    enabled: !!businessId,
  });

  useEffect(() => {
    if (cfg) setForm(f => ({
      ...f,
      ai_enabled:          (cfg.ai_enabled as boolean) ?? false,
      ai_prompt:           (cfg.ai_prompt as string) ?? '',
      ai_auto_reply_mode:  (cfg.ai_auto_reply_mode as string) ?? 'disabled',
      ai_model:            (cfg.ai_model as string) ?? 'meta-llama/llama-3.3-70b-instruct:free',
      ai_operating_hours:  (cfg.ai_operating_hours as OpsHours) ?? defaultHours,
      ai_voice_lang:       (cfg.ai_voice_lang as string) ?? 'es-CO',
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const { data: aiMessages = [], isLoading: logLoading } = useQuery({
    queryKey: ['ai_message_log', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_messages')
        .select('id, content, created_at, channel, intent, flow_node_name, contact:wa_contacts(name, phone, external_id)')
        .eq('business_id', businessId).eq('sent_by_ai', true)
        .order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!businessId,
    refetchInterval: 30_000,
  });

  const save = async (patch?: Partial<typeof form>) => {
    setSaving(true);
    const f = { ...form, ...patch };
    try {
      const update: Record<string, unknown> = {
        ai_enabled: f.ai_enabled,
        ai_prompt: f.ai_prompt.trim() || null,
        ai_auto_reply_mode: f.ai_auto_reply_mode,
        ai_model: f.ai_model,
        ai_voice_lang: f.ai_voice_lang,
      };
      if (f.ai_auto_reply_mode === 'off_hours') update.ai_operating_hours = f.ai_operating_hours;
      const { error } = await supabase.from('businesses').update(update).eq('id', businessId);
      if (error) throw error;
      toast({ title: 'Configuración guardada' });
      qc.invalidateQueries({ queryKey: ['business_ai_config', businessId] });
    } catch (err) {
      toast({ title: 'Error al guardar', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const setDayHours = (day: string, field: 'open' | 'close', val: string) =>
    setForm(f => ({ ...f, ai_operating_hours: { ...f.ai_operating_hours, [day]: { ...(f.ai_operating_hours[day] as DaySchedule ?? { open: '08:00', close: '22:00' }), [field]: val } } }));

  const toggleDay = (day: string, enabled: boolean) =>
    setForm(f => ({ ...f, ai_operating_hours: { ...f.ai_operating_hours, [day]: enabled ? { open: '08:00', close: '22:00' } : null } }));

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      {/* Config card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-5">
        <p className="text-sm font-semibold">Configuración del agente</p>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Activar respuesta automática</p>
            <p className="text-xs text-muted-foreground mt-0.5">El agente responde mensajes entrantes con IA</p>
          </div>
          <Switch data-testid="switch-ai-enabled" checked={form.ai_enabled}
            onCheckedChange={v => setForm(f => ({ ...f, ai_enabled: v }))} />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Modo de respuesta</Label>
          <Select value={form.ai_auto_reply_mode} onValueChange={v => setForm(f => ({ ...f, ai_auto_reply_mode: v }))}>
            <SelectTrigger data-testid="select-ai-mode" className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disabled">Desactivado (solo clasificación de intención)</SelectItem>
              <SelectItem value="always">Siempre — responder todos los mensajes</SelectItem>
              <SelectItem value="off_hours">Fuera de horario — solo cuando está cerrado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Modelo de IA</Label>
          <Select value={form.ai_model} onValueChange={v => setForm(f => ({ ...f, ai_model: v }))}>
            <SelectTrigger data-testid="select-ai-model" className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {AI_MODELS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Voz del asistente en el menú público</Label>
          <Select value={form.ai_voice_lang} onValueChange={v => setForm(f => ({ ...f, ai_voice_lang: v }))}>
            <SelectTrigger data-testid="select-ai-voice-lang" className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>
              {VOICE_LANGS.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Idioma y acento de la voz que lee las respuestas del asistente.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ai-prompt" className="text-sm font-medium">
            Instrucciones del agente <span className="text-muted-foreground font-normal">(opcional)</span>
          </Label>
          <Textarea id="ai-prompt" data-testid="textarea-ai-prompt" rows={4}
            placeholder="Eres un asistente virtual amable para [tu negocio]..."
            value={form.ai_prompt} onChange={e => setForm(f => ({ ...f, ai_prompt: e.target.value }))}
            className="font-mono text-xs resize-none" />
          <p className="text-xs text-muted-foreground">Vacío = prompt por defecto (incluye menú automáticamente).</p>
        </div>

        <Button data-testid="button-save-ai-config" onClick={() => save()} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar
        </Button>
      </div>

      {/* Business hours (off_hours mode only) */}
      {form.ai_auto_reply_mode === 'off_hours' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-semibold">Horario del negocio</p>
          </div>
          <p className="text-xs text-muted-foreground">El agente solo responde cuando el negocio está cerrado.</p>
          <div className="space-y-2">
            {DAY_KEYS.map(day => {
              const dh = form.ai_operating_hours[day] as DaySchedule;
              const active = dh !== null && dh !== undefined;
              return (
                <div key={day} className="flex items-center gap-3">
                  <Switch checked={active} onCheckedChange={v => toggleDay(day, v)} />
                  <span className="text-sm w-8 text-muted-foreground">{DAY_LABELS_MAP[day]}</span>
                  {active && dh ? (
                    <>
                      <Input type="time" value={dh.open} onChange={e => setDayHours(day, 'open', e.target.value)} className="w-28 text-sm h-8" />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input type="time" value={dh.close} onChange={e => setDayHours(day, 'close', e.target.value)} className="w-28 text-sm h-8" />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Cerrado</span>
                  )}
                </div>
              );
            })}
          </div>
          <Button size="sm" onClick={() => save()} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Guardar horario
          </Button>
        </div>
      )}

      {/* AI log */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-500" />
          <p className="text-sm font-medium">Log de respuestas IA</p>
          <Badge variant="secondary" className="text-xs ml-auto">{aiMessages.length}</Badge>
        </div>
        {logLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : aiMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <Bot className="w-8 h-8 opacity-20" />
            <p className="text-sm">Aún no hay respuestas automáticas</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {aiMessages.map(msg => {
              const contact = Array.isArray(msg.contact) ? msg.contact[0] : msg.contact;
              const intentKey = (msg.intent ?? 'other') as string;
              const ch = ((msg as Record<string, unknown>).channel as WaChannel) ?? 'whatsapp';
              return (
                <div key={msg.id} className="px-5 py-3 flex items-start gap-3">
                  <Avatar className="w-7 h-7 flex-shrink-0 mt-0.5">
                    <AvatarFallback className="text-[10px]">{initials((contact as Record<string, unknown>)?.name as string ?? (contact as Record<string, unknown>)?.phone as string)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="text-sm font-medium truncate">
                        {((contact as Record<string, unknown>)?.name ?? (contact as Record<string, unknown>)?.phone ?? (contact as Record<string, unknown>)?.external_id ?? 'Desconocido') as string}
                      </p>
                      <ChannelIcon channel={ch} className="w-3 h-3 flex-shrink-0" />
                      {msg.intent && (
                        <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', INTENT_COLORS[intentKey] ?? INTENT_COLORS.other)}>
                          {INTENT_LABELS[intentKey] ?? intentKey}
                        </span>
                      )}
                      {(msg as Record<string, unknown>).flow_node_name && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                          Flujo: {(msg as Record<string, unknown>).flow_node_name as string}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto flex-shrink-0">{fmtTime(msg.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{msg.content ?? '—'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Knowledge tab ─────────────────────────────────────────────────────────────

function AgentKnowledgeTab({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editItem, setEditItem] = useState<KbItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [blank, setBlank] = useState<Omit<KbItem, 'id'>>({ type: 'faq', title: '', content: '' });

  const { data: items = [] } = useQuery({
    queryKey: ['business_kb', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('businesses')
        .select('ai_knowledge_base').eq('id', businessId).single();
      if (error) throw error;
      return ((data as Record<string, unknown>).ai_knowledge_base as KbItem[]) ?? [];
    },
    enabled: !!businessId,
  });

  const persistItems = async (updated: KbItem[]) => {
    setSaving(true);
    try {
      const { error } = await supabase.from('businesses')
        .update({ ai_knowledge_base: updated } as Record<string, unknown>)
        .eq('id', businessId);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['business_kb', businessId] });
      toast({ title: 'Base de conocimiento guardada' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const addItem = async () => {
    if (!blank.title.trim() || !blank.content.trim()) return;
    await persistItems([...items, { id: crypto.randomUUID(), ...blank }]);
    setAdding(false);
    setBlank({ type: 'faq', title: '', content: '' });
  };

  const updateItem = async () => {
    if (!editItem) return;
    await persistItems(items.map(i => i.id === editItem.id ? editItem : i));
    setEditItem(null);
  };

  const KB_TYPE_LABELS: Record<string, string> = { faq: 'FAQ', policy: 'Política', info: 'Info', promo: 'Promoción' };
  const KB_TYPE_COLORS: Record<string, string> = {
    faq:    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    policy: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    info:   'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
    promo:  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  };

  return (
    <div className="p-6 space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Base de conocimiento</h3>
          <p className="text-xs text-muted-foreground mt-0.5">FAQs, políticas e info que el agente usará al responder.</p>
        </div>
        <Button size="sm" className="gap-1.5 flex-shrink-0" onClick={() => { setAdding(true); setBlank({ type: 'faq', title: '', content: '' }); }}>
          <Plus className="w-3.5 h-3.5" /> Agregar
        </Button>
      </div>

      {adding && (
        <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-3">
          <p className="text-xs font-semibold text-primary">Nuevo item</p>
          <div className="flex gap-2">
            <Select value={blank.type} onValueChange={v => setBlank(b => ({ ...b, type: v as KbItem['type'] }))}>
              <SelectTrigger className="w-32 text-xs h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="faq">FAQ</SelectItem>
                <SelectItem value="policy">Política</SelectItem>
                <SelectItem value="info">Información</SelectItem>
                <SelectItem value="promo">Promoción</SelectItem>
              </SelectContent>
            </Select>
            <Input placeholder={blank.type === 'faq' ? 'Pregunta...' : 'Título...'}
              value={blank.title} onChange={e => setBlank(b => ({ ...b, title: e.target.value }))} className="h-8 text-sm flex-1" />
          </div>
          <Textarea placeholder={blank.type === 'faq' ? 'Respuesta...' : 'Contenido...'} rows={3}
            value={blank.content} onChange={e => setBlank(b => ({ ...b, content: e.target.value }))} className="text-sm resize-none" />
          <div className="flex gap-2">
            <Button size="sm" onClick={addItem} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Guardar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        </div>
      )}

      {items.length === 0 && !adding ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <BookOpen className="w-8 h-8 opacity-20" />
          <p className="text-sm">Sin items. Agrega FAQs, políticas u otra información.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="rounded-xl border border-border bg-card p-4">
              {editItem?.id === item.id ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Select value={editItem.type} onValueChange={v => setEditItem(e => e ? { ...e, type: v as KbItem['type'] } : e)}>
                      <SelectTrigger className="w-32 text-xs h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="faq">FAQ</SelectItem>
                        <SelectItem value="policy">Política</SelectItem>
                        <SelectItem value="info">Información</SelectItem>
                        <SelectItem value="promo">Promoción</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input value={editItem.title} onChange={e => setEditItem(ei => ei ? { ...ei, title: e.target.value } : ei)} className="h-8 text-sm flex-1" />
                  </div>
                  <Textarea rows={3} value={editItem.content} onChange={e => setEditItem(ei => ei ? { ...ei, content: e.target.value } : ei)} className="text-sm resize-none" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={updateItem} disabled={saving} className="gap-1.5">
                      {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Guardar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditItem(null)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex-shrink-0 mt-0.5', KB_TYPE_COLORS[item.type])}>
                    {KB_TYPE_LABELS[item.type]}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.content}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="icon" variant="ghost" className="w-7 h-7" onClick={() => setEditItem(item)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive"
                      onClick={() => persistItems(items.filter(i => i.id !== item.id))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Flows tab ─────────────────────────────────────────────────────────────────

function AgentFlowsTab({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<{ open: boolean; node: Partial<FlowNode> | null }>({ open: false, node: null });
  const [saving, setSaving] = useState(false);
  const [kwRaw, setKwRaw] = useState('');

  const { data: nodes = [], isLoading } = useQuery({
    queryKey: ['ai_flow_nodes', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('ai_flow_nodes')
        .select('*').eq('business_id', businessId).order('sort_order');
      if (error) throw error;
      return (data ?? []) as FlowNode[];
    },
    enabled: !!businessId,
  });

  const setField = (field: string, val: unknown) =>
    setDlg(d => ({ ...d, node: d.node ? { ...d.node, [field]: val } : d.node }));

  const saveNode = async () => {
    const n = dlg.node;
    if (!n?.name?.trim() || !n?.response_template?.trim()) {
      toast({ title: 'Nombre y respuesta son requeridos', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: n.name, trigger_keywords: kwRaw.split(',').map(k => k.trim()).filter(Boolean),
        trigger_intent: n.trigger_intent ?? null,
        response_template: n.response_template,
        sort_order: n.sort_order ?? 0, is_active: n.is_active ?? true,
      };
      const { error } = n.id
        ? await supabase.from('ai_flow_nodes').update(payload).eq('id', n.id)
        : await supabase.from('ai_flow_nodes').insert({ ...payload, business_id: businessId } as Record<string, unknown>);
      if (error) throw error;
      toast({ title: n.id ? 'Flujo actualizado' : 'Flujo creado' });
      qc.invalidateQueries({ queryKey: ['ai_flow_nodes', businessId] });
      setDlg({ open: false, node: null });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const deleteNode = async (id: string) => {
    await supabase.from('ai_flow_nodes').delete().eq('id', id);
    qc.invalidateQueries({ queryKey: ['ai_flow_nodes', businessId] });
  };

  const toggleActive = async (node: FlowNode) => {
    await supabase.from('ai_flow_nodes').update({ is_active: !node.is_active } as Record<string, unknown>).eq('id', node.id);
    qc.invalidateQueries({ queryKey: ['ai_flow_nodes', businessId] });
  };

  const n = dlg.node;

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Flujos automatizados</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Respuestas fijas activadas por palabras clave o intención, antes de llamar a la IA.</p>
        </div>
        <Button size="sm" className="gap-1.5 flex-shrink-0"
          onClick={() => { setKwRaw(''); setDlg({ open: true, node: { name: '', trigger_keywords: [], trigger_intent: null, response_template: '', sort_order: nodes.length, is_active: true } }); }}>
          <Plus className="w-3.5 h-3.5" /> Agregar flujo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <GitBranch className="w-8 h-8 opacity-20" />
          <p className="text-sm">Sin flujos. Agrega uno para respuestas instantáneas a consultas frecuentes.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Nombre</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Palabras clave</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Intención</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Activo</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {nodes.map(node => (
                <tr key={node.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{node.name}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(node.trigger_keywords ?? []).slice(0, 3).map(kw => (
                        <span key={kw} className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">{kw}</span>
                      ))}
                      {(node.trigger_keywords ?? []).length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{node.trigger_keywords.length - 3}</span>
                      )}
                      {!node.trigger_keywords?.length && <span className="text-muted-foreground text-xs italic">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {node.trigger_intent ? (
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', INTENT_COLORS[node.trigger_intent] ?? INTENT_COLORS.other)}>
                        {INTENT_LABELS[node.trigger_intent] ?? node.trigger_intent}
                      </span>
                    ) : <span className="text-muted-foreground text-xs italic">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Switch checked={node.is_active} onCheckedChange={() => toggleActive(node)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="w-7 h-7"
                        onClick={() => { setKwRaw((node.trigger_keywords ?? []).join(', ')); setDlg({ open: true, node: { ...node } }); }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="w-7 h-7 text-destructive hover:text-destructive"
                        onClick={() => deleteNode(node.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={dlg.open} onOpenChange={open => !open && setDlg({ open: false, node: null })}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{n?.id ? 'Editar flujo' : 'Nuevo flujo'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Nombre</Label>
              <Input placeholder="Ej: Bienvenida, Horario, Domicilios..." value={n?.name ?? ''} onChange={e => setField('name', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                Palabras clave <span className="text-muted-foreground font-normal">(separadas por coma)</span>
              </Label>
              <Input placeholder="hola, horario, precio, domicilio..."
                value={kwRaw}
                onChange={e => setKwRaw(e.target.value)}
                onBlur={() => setField('trigger_keywords', kwRaw.split(',').map(k => k.trim()).filter(Boolean))} />
              <p className="text-xs text-muted-foreground">Si el mensaje contiene alguna de estas palabras, se activa el flujo.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Intención <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Select value={n?.trigger_intent ?? '__none__'} onValueChange={v => setField('trigger_intent', v === '__none__' ? null : v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Sin filtro de intención" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin filtro</SelectItem>
                  {Object.entries(INTENT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Respuesta automática</Label>
                <button
                  type="button"
                  onClick={() => setField('response_template', ((n?.response_template ?? '') + (n?.response_template ? '\n' : '') + '{{promociones}}').trim())}
                  className="text-xs text-green-600 hover:text-green-700 font-medium flex items-center gap-1 px-2 py-0.5 rounded bg-green-50 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                >
                  + Insertar promociones activas
                </button>
              </div>
              <Textarea rows={4} placeholder="El mensaje que el agente enviará cuando se active este flujo..."
                value={n?.response_template ?? ''} onChange={e => setField('response_template', e.target.value)} className="resize-none" />
              <p className="text-xs text-muted-foreground">Usa <code className="bg-muted px-1 rounded">{'{{promociones}}'}</code> para insertar automáticamente las promociones activas del catálogo.</p>
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Activo</Label>
              <Switch checked={n?.is_active ?? true} onCheckedChange={v => setField('is_active', v)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDlg({ open: false, node: null })}>Cancelar</Button>
            <Button onClick={saveNode} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Handoff tab ───────────────────────────────────────────────────────────────

function AgentHandoffTab({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keywords, setKeywords] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: cfg } = useQuery({
    queryKey: ['business_handoff', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('businesses')
        .select('ai_handoff_keywords').eq('id', businessId).single();
      if (error) throw error;
      return ((data as Record<string, unknown>).ai_handoff_keywords as string[] | null) ?? [];
    },
    enabled: !!businessId,
  });

  useEffect(() => { if (cfg) setKeywords(cfg.join(', ')); }, [cfg]);

  const { data: handoffConvs = [], isLoading: convsLoading } = useQuery({
    queryKey: ['handoff_conversations', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('wa_conversations')
        .select('*, contact:wa_contacts(name, phone, external_id, channel)')
        .eq('business_id', businessId).eq('needs_human', true)
        .order('last_message_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as WaConversation[];
    },
    enabled: !!businessId,
    refetchInterval: 15_000,
  });

  const saveKeywords = async () => {
    setSaving(true);
    try {
      const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
      const { error } = await supabase.from('businesses')
        .update({ ai_handoff_keywords: kws } as Record<string, unknown>).eq('id', businessId);
      if (error) throw error;
      toast({ title: 'Palabras clave guardadas' });
      qc.invalidateQueries({ queryKey: ['business_handoff', businessId] });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally { setSaving(false); }
  };

  const reactivateAI = async (convId: string) => {
    const { error } = await supabase.from('wa_conversations')
      .update({ needs_human: false } as Record<string, unknown>).eq('id', convId);
    if (error) toast({ title: 'Error al reactivar', variant: 'destructive' });
    else {
      toast({ title: 'IA reactivada' });
      qc.invalidateQueries({ queryKey: ['handoff_conversations', businessId] });
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Headphones className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-semibold">Palabras clave de transferencia</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Cuando el cliente use alguna de estas palabras, la IA se pausa y se avisa que un humano lo atenderá.
        </p>
        <div className="space-y-1.5">
          <Input placeholder="hablar con humano, agente, representante, urgente..."
            value={keywords} onChange={e => setKeywords(e.target.value)} />
          <p className="text-xs text-muted-foreground">Separa con comas.</p>
        </div>
        <Button size="sm" onClick={saveKeywords} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-amber-500" />
          <p className="text-sm font-medium">Conversaciones esperando agente humano</p>
          {handoffConvs.length > 0 && (
            <Badge className="ml-auto text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {handoffConvs.length}
            </Badge>
          )}
        </div>
        {convsLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : handoffConvs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
            <UserCheck className="w-8 h-8 opacity-20" />
            <p className="text-sm">Sin conversaciones pendientes de atención humana</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {handoffConvs.map(conv => {
              const contact = (Array.isArray(conv.contact) ? conv.contact[0] : conv.contact) as WaContact | null;
              const ch = (conv.channel ?? 'whatsapp') as WaChannel;
              return (
                <div key={conv.id} className="px-5 py-3.5 flex items-center gap-3">
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarFallback className="text-xs">{initials(contact?.name ?? contact?.phone)}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{contact?.name ?? contact?.phone ?? contact?.external_id ?? 'Desconocido'}</p>
                      <ChannelIcon channel={ch} className="w-3.5 h-3.5 flex-shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground">{fmtTime(conv.last_message_at)}</p>
                  </div>
                  <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0 text-xs" onClick={() => reactivateAI(conv.id)}>
                    <Bot className="w-3 h-3" /> Reactivar IA
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Acciones / Difusión masiva ────────────────────────────────────────────────

type BulkChannel = 'meta_whatsapp' | 'twilio_whatsapp' | 'twilio_sms';

const BULK_CHANNEL_LABELS: Record<BulkChannel, string> = {
  meta_whatsapp:   'WhatsApp (tu número)',
  twilio_whatsapp: 'WhatsApp vía Twilio',
  twilio_sms:      'SMS vía Twilio',
};

function AccionesView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { business } = useBusiness();
  const isPro = getEffectivePlan(business ?? undefined) === 'pro';
  const [campaignName, setCampaignName] = useState('');
  const [message, setMessage] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'status' | 'tags'>('all');
  const [filterValue, setFilterValue] = useState('');
  const [channel, setChannel] = useState<BulkChannel>('meta_whatsapp');
  const [sending, setSending] = useState(false);

  // Preview recipient count
  const { data: recipientCount = 0 } = useQuery({
    queryKey: ['bulk_preview', businessId, filterType, filterValue],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase
        .from('wa_contacts')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId);
      if (filterType === 'status' && filterValue) q = q.eq('status', filterValue);
      else if (filterType === 'tags' && filterValue) {
        const tags = filterValue.split(',').map((t: string) => t.trim()).filter(Boolean);
        if (tags.length) q = q.overlaps('tags', tags);
      }
      const { count } = await q;
      return count ?? 0;
    },
    enabled: !!businessId,
  });

  // Campaign history
  const { data: campaigns = [], isLoading: histLoading } = useQuery({
    queryKey: ['wa_bulk_jobs', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('wa_bulk_jobs')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!businessId,
    refetchInterval: sending ? 3000 : false,
  });

  const [scheduledAt, setScheduledAt] = useState('');

  const handleSend = async () => {
    if (!campaignName.trim() || !message.trim()) {
      toast({ title: 'Completa el nombre y el mensaje', variant: 'destructive' });
      return;
    }
    if (recipientCount === 0) {
      toast({ title: 'Sin contactos para ese filtro', variant: 'destructive' });
      return;
    }
    setSending(true);
    try {
      const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

      if (isScheduled) {
        // Create scheduled job record in DB (status='pending' until pg_cron triggers bulk-send)
        const { error } = await supabase.from('wa_bulk_jobs').insert({
          business_id:  businessId,
          name:         campaignName.trim(),
          message:      message.trim(),
          filter_type:  filterType,
          filter_value: filterValue.trim() || null,
          channel,
          status:       'pending',
          total_count:  recipientCount,
          scheduled_at: new Date(scheduledAt).toISOString(),
        });
        if (error) throw error;
        const when = new Date(scheduledAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        toast({ title: `Campaña programada para ${when}` });
      } else {
        // Immediate send via Edge Function
        const { data, error } = await supabase.functions.invoke('bulk-send', {
          body: {
            business_id: businessId,
            name:        campaignName.trim(),
            message:     message.trim(),
            filter:      { type: filterType, value: filterValue.trim() || undefined },
            channel,
          },
        });
        if (error) throw error;
        toast({ title: `Campaña enviada: ${(data as { sent: number; total: number }).sent} de ${(data as { sent: number; total: number }).total} mensajes` });
      }

      setCampaignName('');
      setMessage('');
      setFilterType('all');
      setFilterValue('');
      setScheduledAt('');
      qc.invalidateQueries({ queryKey: ['wa_bulk_jobs', businessId] });
    } catch (err: unknown) {
      toast({ title: 'Error al enviar difusión', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const JOB_STATUS: Record<string, { label: string; cls: string }> = {
    pending:   { label: 'Pendiente', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    sending:   { label: 'Enviando…', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
    completed: { label: 'Completada', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
    failed:    { label: 'Fallida', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 space-y-6 max-w-3xl">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <Megaphone className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h2 className="font-semibold text-lg leading-tight">Difusión masiva</h2>
            <p className="text-sm text-muted-foreground">
              Envía un mensaje de WhatsApp a múltiples contactos a la vez.
            </p>
          </div>
        </div>

        {/* Composer */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <p className="text-sm font-medium">Nueva campaña</p>

          {!isPro ? (
            <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-4 py-3 text-sm text-violet-800 dark:text-violet-300">
              La difusión masiva es una función del Plan Pro. Actualiza tu plan para enviar campañas a todos tus contactos de una vez, por WhatsApp (tu número) o por Twilio (SMS y WhatsApp adicional).
            </div>
          ) : (
          <>
          <div className="space-y-1.5">
            <Label className="text-sm">Canal de envío</Label>
            <Select value={channel} onValueChange={v => setChannel(v as BulkChannel)}>
              <SelectTrigger data-testid="select-bulk-channel" className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meta_whatsapp">{BULK_CHANNEL_LABELS.meta_whatsapp}</SelectItem>
                <SelectItem value="twilio_whatsapp">{BULK_CHANNEL_LABELS.twilio_whatsapp}</SelectItem>
                <SelectItem value="twilio_sms">{BULK_CHANNEL_LABELS.twilio_sms}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm">Nombre de la campaña</Label>
            <Input
              data-testid="input-campaign-name"
              placeholder="Ej: Promoción de fin de semana"
              value={campaignName}
              onChange={e => setCampaignName(e.target.value)}
            />
          </div>

          {/* Filter */}
          <div className="space-y-1.5">
            <Label className="text-sm">Destinatarios</Label>
            <div className="flex gap-2 flex-wrap">
              <Select value={filterType} onValueChange={v => { setFilterType(v as 'all' | 'status' | 'tags'); setFilterValue(''); }}>
                <SelectTrigger data-testid="select-filter-type" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los contactos</SelectItem>
                  <SelectItem value="status">Por estado</SelectItem>
                  <SelectItem value="tags">Por etiqueta</SelectItem>
                </SelectContent>
              </Select>

              {filterType === 'status' && (
                <Select value={filterValue} onValueChange={setFilterValue}>
                  <SelectTrigger data-testid="select-filter-status" className="w-44">
                    <SelectValue placeholder="Seleccionar estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {(['new','contacted','interested','customer','recurring'] as WaContactStatus[]).map(s => (
                      <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {filterType === 'tags' && (
                <Input
                  data-testid="input-filter-tags"
                  placeholder="VIP, Frecuente (separadas por coma)"
                  className="w-64"
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {recipientCount > 0
                ? `${recipientCount} contacto${recipientCount !== 1 ? 's' : ''} seleccionado${recipientCount !== 1 ? 's' : ''}`
                : 'Sin contactos para ese filtro'}
            </p>
          </div>

          {/* Message */}
          <div className="space-y-1.5">
            <Label className="text-sm">Mensaje</Label>
            <Textarea
              data-testid="textarea-campaign-message"
              placeholder="Hola {{nombre}}, tenemos una promoción especial para ti..."
              rows={4}
              value={message}
              onChange={e => setMessage(e.target.value)}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Usa <code className="bg-muted px-1 rounded">{'{{nombre}}'}</code> para personalizar con el nombre del contacto.
              {message.length > 0 && <span> · {message.length} caracteres</span>}
            </p>
          </div>

          {/* Schedule */}
          <div className="space-y-1.5">
            <Label className="text-sm">Programar envío (opcional)</Label>
            <Input
              data-testid="input-campaign-schedule"
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
              className="w-64"
            />
            <p className="text-xs text-muted-foreground">
              Deja vacío para enviar inmediatamente. Los programados requieren activar pg_cron en Supabase.
            </p>
          </div>

          <Button
            data-testid="button-send-campaign"
            onClick={handleSend}
            disabled={sending || recipientCount === 0}
            className="gap-2"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending
              ? (scheduledAt && new Date(scheduledAt) > new Date() ? 'Programando…' : 'Enviando…')
              : (scheduledAt && new Date(scheduledAt) > new Date()
                  ? `Programar para ${recipientCount} contacto${recipientCount !== 1 ? 's' : ''}`
                  : `Enviar a ${recipientCount} contacto${recipientCount !== 1 ? 's' : ''}`)}
          </Button>
          </>
          )}
        </div>

        {/* History */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-muted-foreground" />
            <p className="text-sm font-medium">Historial de difusiones</p>
            <Badge variant="secondary" className="text-xs ml-auto">{campaigns.length}</Badge>
          </div>

          {histLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
              <Megaphone className="w-8 h-8 opacity-20" />
              <p className="text-sm">Sin difusiones enviadas aún</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {campaigns.map((c: Record<string, unknown>) => {
                const s = JOB_STATUS[c.status as string] ?? JOB_STATUS.pending;
                return (
                  <div key={c.id as string} className="px-5 py-3 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name as string}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.created_at as string).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {' · '}{c.total_count as number} contactos
                        {' · '}{BULK_CHANNEL_LABELS[(c.channel as BulkChannel) ?? 'meta_whatsapp']}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs flex-shrink-0">
                      <div className="text-center">
                        <p className="font-semibold text-foreground">{String(c.sent_count ?? 0)}</p>
                        <p className="text-muted-foreground">enviados</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-emerald-600">{String(c.delivered_count ?? 0)}</p>
                        <p className="text-muted-foreground">entregados</p>
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-red-600">{String(c.failed_count ?? 0)}</p>
                        <p className="text-muted-foreground">fallidos</p>
                      </div>
                      <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full', s.cls)}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Seguimientos automáticos ──────────────────────────────────────────────────

interface FollowupRule {
  id: string;
  business_id: string;
  name: string;
  trigger_event: 'no_reply' | 'order_status';
  trigger_condition: Record<string, string>;
  delay_hours: number;
  message_template: string;
  is_active: boolean;
  created_at: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  no_reply:     'Sin respuesta',
  order_status: 'Estado de pedido',
};

const ORDER_STATUS_OPTS: { value: string; label: string }[] = [
  { value: 'confirmed', label: 'En preparación' },
  { value: 'ready',     label: 'En camino' },
  { value: 'completed', label: 'Entregado' },
];

const INTENT_OPTS: { value: string; label: string }[] = [
  { value: '__any__',    label: 'Cualquier intención' },
  { value: 'order',      label: 'Pedido' },
  { value: 'inquiry',    label: 'Consulta' },
  { value: 'complaint',  label: 'Queja' },
  { value: 'follow_up',  label: 'Seguimiento' },
];

const EMPTY_RULE_FORM = {
  name: '',
  trigger_event: 'no_reply' as 'no_reply' | 'order_status',
  trigger_condition: {} as Record<string, string>,
  delay_hours: 24,
  message_template: '',
  is_active: true,
};

function SeguimientosView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_RULE_FORM);
  const [saving, setSaving] = useState(false);
  const [instanceFilter, setInstanceFilter] = useState<'all'|'pending'|'sent'|'canceled'|'failed'>('all');

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['wa_followup_rules', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('wa_followup_rules')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: true });
      return (data ?? []) as FollowupRule[];
    },
    enabled: !!businessId,
  });

  const { data: instances = [] } = useQuery({
    queryKey: ['wa_followup_instances', businessId, instanceFilter],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase
        .from('wa_followup_instances')
        .select('id, name, phone, message, scheduled_at, status, sent_at, created_at, wa_followup_rules(name)')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (instanceFilter !== 'all') q = q.eq('status', instanceFilter);
      const { data } = await q;
      return (data ?? []) as Array<{
        id: string; name: string | null; phone: string; message: string;
        scheduled_at: string; status: string; sent_at: string | null; created_at: string;
        wa_followup_rules: { name: string } | null;
      }>;
    },
    enabled: !!businessId,
  });

  const handleCancelInstance = async (id: string) => {
    await supabase.from('wa_followup_instances').update({ status: 'canceled' }).eq('id', id);
    qc.invalidateQueries({ queryKey: ['wa_followup_instances', businessId] });
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_RULE_FORM);
    setDialogOpen(true);
  };

  const openEdit = (r: FollowupRule) => {
    setEditingId(r.id);
    setForm({
      name: r.name,
      trigger_event: r.trigger_event,
      trigger_condition: r.trigger_condition ?? {},
      delay_hours: r.delay_hours,
      message_template: r.message_template,
      is_active: r.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.message_template.trim()) {
      toast({ title: 'Completa el nombre y el mensaje', variant: 'destructive' });
      return;
    }
    if (form.trigger_event === 'order_status' && !form.trigger_condition.order_status) {
      toast({ title: 'Selecciona el estado del pedido', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase
          .from('wa_followup_rules')
          .update({ ...form })
          .eq('id', editingId);
        if (error) throw error;
        toast({ title: 'Regla actualizada' });
      } else {
        const { error } = await supabase
          .from('wa_followup_rules')
          .insert({ ...form, business_id: businessId });
        if (error) throw error;
        toast({ title: 'Regla creada' });
      }
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ['wa_followup_rules', businessId] });
    } catch (err: unknown) {
      toast({ title: 'Error al guardar', description: err instanceof Error ? err.message : 'Error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('wa_followup_rules').delete().eq('id', id);
    if (error) toast({ title: 'Error al eliminar', variant: 'destructive' });
    else qc.invalidateQueries({ queryKey: ['wa_followup_rules', businessId] });
  };

  const handleToggle = async (r: FollowupRule) => {
    await supabase.from('wa_followup_rules').update({ is_active: !r.is_active }).eq('id', r.id);
    qc.invalidateQueries({ queryKey: ['wa_followup_rules', businessId] });
  };

  const describeCondition = (r: FollowupRule): string => {
    if (r.trigger_event === 'no_reply') {
      const intent = r.trigger_condition?.intent ?? '';
      const label = INTENT_OPTS.find(o => o.value === intent)?.label ?? 'Cualquier intención';
      return `${label} · sin respuesta en ${r.delay_hours}h`;
    }
    if (r.trigger_event === 'order_status') {
      const st = r.trigger_condition?.order_status ?? '';
      const label = ORDER_STATUS_OPTS.find(o => o.value === st)?.label ?? st;
      return `Pedido → ${label}`;
    }
    return '';
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="p-6 space-y-6 max-w-3xl">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="font-semibold text-lg leading-tight">Seguimientos automáticos</h2>
              <p className="text-sm text-muted-foreground">
                Configura mensajes que se envían cuando se cumple una condición.
              </p>
            </div>
          </div>
          <Button data-testid="button-new-rule" onClick={openCreate} size="sm" className="gap-2 flex-shrink-0">
            <Plus className="w-4 h-4" />
            Nueva regla
          </Button>
        </div>

        {/* Info banner */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20 px-4 py-3 text-sm">
          <p className="font-medium text-blue-700 dark:text-blue-300">Cómo funcionan las reglas</p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
            Las reglas de <strong>Estado de pedido</strong> se activan automáticamente al mover un pedido en el Kanban.
            Las reglas de <strong>Sin respuesta</strong> requieren habilitar pg_cron en Supabase (Dashboard → Database → Extensions → pg_cron).
          </p>
        </div>

        {/* Rules list */}
        {isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Clock className="w-8 h-8 opacity-20" />
            <p className="text-sm">Sin reglas configuradas</p>
            <Button variant="outline" size="sm" onClick={openCreate} className="gap-2">
              <Plus className="w-4 h-4" />Crear primera regla
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(r => (
              <div key={r.id} className="rounded-xl border border-border bg-card px-5 py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium">{r.name}</p>
                    <span className={cn(
                      'text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                      r.trigger_event === 'no_reply'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                    )}>
                      {TRIGGER_LABELS[r.trigger_event] ?? r.trigger_event}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{describeCondition(r)}</p>
                  <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{r.message_template}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Switch
                    data-testid={`toggle-rule-${r.id}`}
                    checked={r.is_active}
                    onCheckedChange={() => handleToggle(r)}
                  />
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)}>
                    <Save className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(r.id)}
                    data-testid={`button-delete-rule-${r.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Follow-up instances list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-semibold">Mensajes programados y enviados</h3>
            <div className="flex gap-1 flex-wrap">
              {(['all','pending','sent','canceled','failed'] as const).map(f => (
                <Button
                  key={f}
                  size="sm"
                  variant={instanceFilter === f ? 'default' : 'ghost'}
                  className="h-7 text-xs"
                  onClick={() => setInstanceFilter(f)}
                >
                  {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendientes' : f === 'sent' ? 'Enviados' : f === 'canceled' ? 'Cancelados' : 'Fallidos'}
                </Button>
              ))}
            </div>
          </div>

          {instances.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              {instanceFilter === 'all' ? 'Sin mensajes programados aún' : `Sin mensajes con estado "${instanceFilter}"`}
            </p>
          ) : (
            <div className="space-y-1.5">
              {instances.map(inst => {
                const statusCls: Record<string, string> = {
                  pending:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                  sent:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                  canceled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
                  failed:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                };
                const statusLabel: Record<string, string> = {
                  pending: 'Pendiente', sent: 'Enviado', canceled: 'Cancelado', failed: 'Fallido',
                };
                const ruleName = (inst.wa_followup_rules as { name: string } | null)?.name;
                return (
                  <div key={inst.id} className="rounded-lg border border-border bg-card px-4 py-2.5 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <p className="text-xs font-medium">{inst.name ?? inst.phone}</p>
                        {inst.name && <span className="text-[10px] text-muted-foreground">{inst.phone}</span>}
                        {ruleName && (
                          <span className="text-[10px] text-muted-foreground/60">· {ruleName}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{inst.message}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {new Date(inst.scheduled_at).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded-full', statusCls[inst.status] ?? 'bg-gray-100 text-gray-600')}>
                        {statusLabel[inst.status] ?? inst.status}
                      </span>
                      {inst.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleCancelInstance(inst.id)}
                          data-testid={`button-cancel-instance-${inst.id}`}
                          title="Cancelar"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar regla' : 'Nueva regla de seguimiento'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre de la regla</Label>
              <Input
                data-testid="input-rule-name"
                placeholder="Ej: Reenganche de interesados"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Tipo de trigger</Label>
              <Select
                value={form.trigger_event}
                onValueChange={v => setForm(f => ({
                  ...f,
                  trigger_event: v as 'no_reply' | 'order_status',
                  trigger_condition: {},
                }))}
              >
                <SelectTrigger data-testid="select-trigger-event">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no_reply">Sin respuesta — lead no contesta en X horas</SelectItem>
                  <SelectItem value="order_status">Estado de pedido — pedido cambia de estado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.trigger_event === 'no_reply' && (
              <>
                <div className="space-y-1.5">
                  <Label>Estado del contacto (filtro opcional)</Label>
                  <Select
                    value={form.trigger_condition.contact_status || '__any__'}
                    onValueChange={v => setForm(f => ({
                      ...f,
                      trigger_condition: {
                        ...f.trigger_condition,
                        contact_status: v === '__any__' ? undefined : v,
                      },
                    }))}
                  >
                    <SelectTrigger data-testid="select-rule-contact-status">
                      <SelectValue placeholder="Cualquier estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__any__">Cualquier estado</SelectItem>
                      <SelectItem value="new">Nuevo</SelectItem>
                      <SelectItem value="contacted">Contactado</SelectItem>
                      <SelectItem value="interested">Interesado</SelectItem>
                      <SelectItem value="customer">Cliente</SelectItem>
                      <SelectItem value="recurring">Recurrente</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Filtra por el estado del lead en el CRM (ej: solo contactos marcados como Interesados).
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Filtrar por intención del último mensaje</Label>
                  <Select
                    value={form.trigger_condition.intent || '__any__'}
                    onValueChange={v => setForm(f => ({
                      ...f,
                      trigger_condition: {
                        ...f.trigger_condition,
                        intent: v === '__any__' ? undefined : v,
                      },
                    }))}
                  >
                    <SelectTrigger data-testid="select-rule-intent">
                      <SelectValue placeholder="Cualquier intención" />
                    </SelectTrigger>
                    <SelectContent>
                      {INTENT_OPTS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Horas sin respuesta del cliente</Label>
                  <Input
                    data-testid="input-rule-delay"
                    type="number"
                    min={1}
                    max={168}
                    value={form.delay_hours}
                    onChange={e => setForm(f => ({ ...f, delay_hours: Number(e.target.value) }))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Se activa cuando el último mensaje fue enviado por la empresa y el cliente no contestó en este tiempo.
                  </p>
                </div>
              </>
            )}

            {form.trigger_event === 'order_status' && (
              <div className="space-y-1.5">
                <Label>Estado del pedido que activa el envío</Label>
                <Select
                  value={form.trigger_condition.order_status ?? ''}
                  onValueChange={v => setForm(f => ({ ...f, trigger_condition: { order_status: v } }))}
                >
                  <SelectTrigger data-testid="select-rule-order-status">
                    <SelectValue placeholder="Seleccionar estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUS_OPTS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Mensaje a enviar</Label>
              <Textarea
                data-testid="textarea-rule-message"
                placeholder="Hola {{nombre}}, ¿te podemos ayudar con algo? 😊"
                rows={3}
                value={form.message_template}
                onChange={e => setForm(f => ({ ...f, message_template: e.target.value }))}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Usa <code className="bg-muted px-1 rounded">{'{{nombre}}'}</code> para personalizar.
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label>Regla activa</Label>
              <Switch
                checked={form.is_active}
                onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingId ? 'Actualizar' : 'Crear regla'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Placeholder views ─────────────────────────────────────────────────────────

function PlaceholderView({ icon: Icon, title, description }: {
  icon: typeof Clock;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-8">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <Icon className="w-8 h-8 opacity-40" />
      </div>
      <div className="text-center">
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm mt-1">{description}</p>
      </div>
    </div>
  );
}

// ── Plan gate ─────────────────────────────────────────────────────────────────

function ProGate() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-8">
      <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
        <Crown className="w-8 h-8 text-amber-600 dark:text-amber-400" />
      </div>
      <div className="text-center max-w-sm">
        <h2 className="text-xl font-bold mb-2">CRM disponible en el plan Pro</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Gestiona conversaciones de WhatsApp, leads y seguimientos desde un solo lugar.
          Actualiza a Pro para desbloquear el CRM.
        </p>
      </div>
      <Link to="/pricing">
        <Button className="gap-2" data-testid="button-crm-upgrade">
          <Crown className="w-4 h-4" />
          Ver planes
        </Button>
      </Link>
    </div>
  );
}

// ── Main CRM page ─────────────────────────────────────────────────────────────

export default function Crm() {
  const { business, loading } = useBusiness();
  const navigate = useNavigate();
  const [section, setSection] = useState<CrmSection>('overview');
  const { data: conversations = [] } = useConversations(business?.id ?? '');

  const isPro = hasCrmAccess(business?.plan);
  const waConnected = !!(business?.wa_phone_number_id && business?.wa_access_token);
  const openCount   = conversations.filter(c => c.status !== 'resolved').length;
  const unreadCount = conversations.reduce((s, c) => s + (c.unread_count ?? 0), 0);
  const pendingCount = conversations.filter(c => c.status === 'pending').length;

  // Route guard — redirect non-Pro users immediately
  useEffect(() => {
    if (!loading && !isPro) {
      navigate('/pricing', { replace: true });
    }
  }, [loading, isPro, navigate]);

  if (loading || !isPro) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Break out of AdminLayout's p-6 and go full-height
  return (
    <div className="-m-6 flex" style={{ height: 'calc(100vh - 48px)' }}>
      <CrmSidebar
        section={section}
        setSection={setSection}
        openConvCount={openCount}
        unreadCount={unreadCount}
        pendingCount={pendingCount}
        waConnected={waConnected}
      />

      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        {section === 'overview' && <OverviewView businessId={business!.id} />}
        {section === 'leads' && <LeadsView businessId={business!.id} />}
        {section === 'conversations' && (
          <ConversationsView businessId={business!.id} filter="all" />
        )}
        {section === 'queue' && (
          <ConversationsView businessId={business!.id} filter="pending" />
        )}
        {section === 'agents' && <AgentesView businessId={business!.id} />}
        {section === 'followups' && <SeguimientosView businessId={business!.id} />}
        {section === 'actions' && <AccionesView businessId={business!.id} />}
      </div>
    </div>
  );
}
