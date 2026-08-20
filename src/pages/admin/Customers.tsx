import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Search, Download, Bell, Plus, Upload, Edit3,
  ArrowUpDown, ChevronLeft, ChevronRight,
  Loader2, User, Phone, Mail, StickyNote, Trash2, X,
  FileSpreadsheet, AlertCircle, CheckCircle2, Tag, ShoppingBag,
  Calendar, Hash, TrendingUp, MapPin, MessageCircle, PhoneCall, Send,
  Bot, ChevronDown, ChevronUp, ShoppingCart,
} from 'lucide-react';
import { sendTwilioNotification, TwilioChannel } from '@/lib/twilioNotify';
import { getWhatsAppUrl } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import * as XLSX from 'xlsx';
import DifusionesDialog from '@/components/DifusionesDialog';
import { CustomerTimeline } from '@/components/CustomerTimeline';
import { logWaSent } from '@/lib/customerEvents';

type Customer = Database['public']['Tables']['customers']['Row'];
type Order = Database['public']['Tables']['orders']['Row'];
type AiConversation = Database['public']['Tables']['ai_conversations']['Row'];
type FilterTab = 'all' | 'inactive' | 'first_order' | 'never_ordered';
type MainView = 'customers' | 'chats';

const PAGE_SIZES = [12, 24, 48, 96];

const EMPTY_FORM = {
  name: '',
  phone: '',
  email: '',
  address: '',
  notes: '',
  is_active: true,
};

// ── Tag config ──────────────────────────────────────────────────────────────

const TAG_OPTIONS = ['VIP', 'Frecuente', 'Inactivo', 'Nueva zona', 'Corporativo'] as const;

const TAG_COLORS: Record<string, string> = {
  VIP: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border-violet-200 dark:border-violet-800',
  Frecuente: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  Inactivo: 'bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  'Nueva zona': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  Corporativo: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-orange-200 dark:border-orange-800',
};

function tagClass(tag: string) {
  return TAG_COLORS[tag] ?? 'bg-muted text-muted-foreground border-border';
}

// ── Import helpers ───────────────────────────────────────────────────────────

type ImportRow = { name: string; phone: string; email: string; address: string; notes: string; error?: string };

const TEMPLATE_CSV = `Nombre,Teléfono,Correo,Dirección,Notas
Juan Pérez,3001234567,juan@email.com,Calle 10 # 5-23 Barrio Centro,Cliente frecuente
María García,3109876543,,,`;

const COL_ALIASES: Record<string, keyof ImportRow> = {
  nombre: 'name', name: 'name',
  teléfono: 'phone', telefono: 'phone', phone: 'phone', tel: 'phone', celular: 'phone',
  correo: 'email', email: 'email', 'correo electrónico': 'email', 'correo electronico': 'email',
  dirección: 'address', direccion: 'address', address: 'address', dir: 'address', domicilio: 'address',
  notas: 'notes', notes: 'notes', nota: 'notes', observaciones: 'notes',
};

function normalizeHeader(h: string) { return h.trim().toLowerCase().replace(/\s+/g, ' '); }

function parseRows(rawRows: (string | number | boolean | null | undefined)[][]): ImportRow[] {
  if (rawRows.length < 2) return [];
  const headers = rawRows[0].map(h => normalizeHeader(String(h ?? '')));
  const fieldMap: Record<number, keyof ImportRow> = {};
  headers.forEach((h, i) => { const f = COL_ALIASES[h]; if (f) fieldMap[i] = f; });
  if (!headers.some(h => COL_ALIASES[h] === 'name')) return [];
  return rawRows.slice(1).filter(row => row.some(c => String(c ?? '').trim())).map(row => {
    const record: ImportRow = { name: '', phone: '', email: '', address: '', notes: '' };
    row.forEach((cell, i) => { const f = fieldMap[i]; if (f) record[f] = String(cell ?? '').trim(); });
    if (!record.name) record.error = 'Nombre requerido';
    return record;
  });
}

async function parseFile(file: File): Promise<ImportRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    const rows = text.split(/\r?\n/).filter(l => l.trim()).map(line => {
      const result: string[] = []; let cur = ''; let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; continue; }
        if (ch === ',' && !inQ) { result.push(cur); cur = ''; continue; }
        cur += ch;
      }
      result.push(cur); return result;
    });
    return parseRows(rows);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return parseRows(XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]);
}

// ── Utility helpers ──────────────────────────────────────────────────────────

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relativeDate(dateStr: string | null): string {
  if (!dateStr) return 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Hoy';
  if (d === 1) return 'Ayer';
  if (d < 7) return `Hace ${d} días`;
  if (d < 30) return `Hace ${Math.floor(d / 7)} sem`;
  if (d < 365) return `Hace ${Math.floor(d / 30)} meses`;
  return `Hace ${Math.floor(d / 365)} años`;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
}

// ── Order status labels ──────────────────────────────────────────────────────

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: 'Entrada', confirmed: 'En preparación', ready: 'En camino', completed: 'Entregado',
};
const ORDER_STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  confirmed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ready: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
};

// ── CustomerDetailSheet ──────────────────────────────────────────────────────

interface DetailSheetProps {
  customer: Customer | null;
  open: boolean;
  onClose: () => void;
  onUpdate: (updated: Customer) => void;
  onEdit: (c: Customer) => void;
  business?: any;
}

function CustomerDetailSheet({ customer, open, onClose, onUpdate, onEdit, business }: DetailSheetProps) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);
  const [contactingChannel, setContactingChannel] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'perfil' | 'historial'>('perfil');
  const notesTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeCustomerId = useRef<string | null>(null);

  useEffect(() => {
    if (!customer) return;
    setNotes(customer.notes || '');
    setTags(customer.tags || []);
    setConversations([]);
    setExpandedConv(null);
    setActiveSection('perfil');

    if (notesTimeout.current) { clearTimeout(notesTimeout.current); notesTimeout.current = null; }

    const thisId = customer.id;
    activeCustomerId.current = thisId;

    const loadData = async () => {
      // Load orders
      if (customer.phone) {
        setLoadingOrders(true);
        const { data: ordersData } = await supabase
          .from('orders')
          .select('*')
          .eq('business_id', customer.business_id)
          .eq('customer_phone', customer.phone)
          .order('created_at', { ascending: false });
        if (activeCustomerId.current === thisId) {
          setOrders(ordersData || []);
          setLoadingOrders(false);
        }
      } else {
        setOrders([]);
        setLoadingOrders(false);
      }

      // Load AI conversations — match by phone (if available) OR by name
      setLoadingConvs(true);
      const convQuery = supabase
        .from('ai_conversations')
        .select('*')
        .eq('business_id', customer.business_id)
        .order('created_at', { ascending: false })
        .limit(30);

      const orClause = customer.phone
        ? `customer_phone.eq.${customer.phone},customer_name.ilike.${customer.name}`
        : `customer_name.ilike.${customer.name}`;
      const { data: convsData } = await convQuery.or(orClause);
      if (activeCustomerId.current === thisId) {
        setConversations(convsData || []);
        setLoadingConvs(false);
      }
    };

    loadData();

    return () => {
      if (notesTimeout.current) { clearTimeout(notesTimeout.current); notesTimeout.current = null; }
    };
  }, [customer]);

  const saveNotes = useCallback(async (value: string, customerId: string) => {
    setSavingNotes(true);
    const { data } = await supabase
      .from('customers')
      .update({ notes: value.trim() || null })
      .eq('id', customerId)
      .select()
      .single();
    setSavingNotes(false);
    if (data && activeCustomerId.current === customerId) onUpdate(data as Customer);
  }, [onUpdate]);

  const handleNotesChange = (value: string) => {
    if (!customer) return;
    setNotes(value);
    const customerId = customer.id;
    if (notesTimeout.current) clearTimeout(notesTimeout.current);
    notesTimeout.current = setTimeout(() => saveNotes(value, customerId), 1200);
  };

  const toggleTag = async (tag: string) => {
    if (!customer) return;
    const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
    setTags(newTags);
    setSavingTags(true);
    const { data } = await supabase
      .from('customers')
      .update({ tags: newTags })
      .eq('id', customer.id)
      .select()
      .single();
    setSavingTags(false);
    if (data) onUpdate(data as Customer);
    else {
      setTags(tags);
      toast({ title: 'Error al guardar etiqueta', variant: 'destructive' });
    }
  };

  const totalSpent = orders.filter(o => o.status === 'completed').reduce((s, o) => s + o.total, 0);

  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto flex flex-col gap-0 p-0">
        {/* Header */}
        <div className="p-5 border-b border-border bg-muted/20">
          <SheetHeader className="mb-0">
            <SheetTitle className="sr-only">Detalle del cliente</SheetTitle>
          </SheetHeader>
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-foreground/10 flex items-center justify-center flex-shrink-0">
              <span className="text-xl font-bold text-foreground/70" translate="no">{getInitials(customer.name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xl font-bold leading-tight truncate" translate="no">{customer.name}</p>
              {customer.phone && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3" /> {customer.phone}
                </p>
              )}
              {customer.email && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Mail className="w-3 h-3" /> {customer.email}
                </p>
              )}
              {customer.address && (
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{customer.address}</span>
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" className="flex-shrink-0 gap-1.5" onClick={() => onEdit(customer)}>
              <Edit3 className="w-3.5 h-3.5" /> Editar
            </Button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <div className="rounded-xl bg-background border border-border p-2.5 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                <ShoppingBag className="w-3 h-3" /> Pedidos
              </p>
              <p className="text-lg font-bold">{customer.total_orders}</p>
            </div>
            <div className="rounded-xl bg-background border border-border p-2.5 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                <Calendar className="w-3 h-3" /> Último
              </p>
              <p className="text-xs font-semibold leading-tight mt-1">{relativeDate(customer.last_order_at)}</p>
            </div>
            <div className="rounded-xl bg-background border border-border p-2.5 text-center">
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mb-0.5">
                <TrendingUp className="w-3 h-3" /> Gastado
              </p>
              <p className="text-xs font-semibold leading-tight mt-1">{totalSpent > 0 ? formatCurrency(totalSpent) : '—'}</p>
            </div>
          </div>
        </div>

        {/* ── Section tabs ── */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveSection('perfil')}
            className={cn(
              'flex-1 py-2.5 text-xs font-semibold transition-colors',
              activeSection === 'perfil'
                ? 'border-b-2 border-primary text-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Perfil
          </button>
          <button
            onClick={() => setActiveSection('historial')}
            className={cn(
              'flex-1 py-2.5 text-xs font-semibold transition-colors',
              activeSection === 'historial'
                ? 'border-b-2 border-primary text-primary -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Historial
          </button>
        </div>

        {activeSection === 'perfil' && <div>
        {/* ── Communication actions ── */}
        {(customer.phone || customer.email) && (() => {
          const enabledChannels: string[] = business?.enabled_channels ?? [];
          const hasSms = enabledChannels.includes('sms') && !!customer.phone;
          const hasVoice = enabledChannels.includes('voice') && !!customer.phone;
          const hasEmail = enabledChannels.includes('email') && !!customer.email;
          const hasWaTwilio = enabledChannels.includes('whatsapp_twilio') && !!customer.phone;
          const hasWaLink = !!customer.phone;
          if (!hasWaLink && !hasSms && !hasVoice && !hasEmail && !hasWaTwilio) return null;

          const contact = async (channel: TwilioChannel, to: string) => {
            if (!business) return;
            setContactingChannel(channel);
            const { success, error } = await sendTwilioNotification({
              businessId: business.id,
              to,
              channel,
              message: `Hola ${customer.name}, ¿en qué podemos ayudarte?`,
            });
            setContactingChannel(null);
            if (success) {
              toast({ description: `Mensaje enviado por ${channel === 'sms' ? 'SMS' : channel === 'voice' ? 'llamada' : channel === 'email' ? 'email' : 'WhatsApp'}` });
            } else {
              toast({ description: error ?? 'Error al contactar', variant: 'destructive' });
            }
          };

          return (
            <div className="px-5 py-4 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2.5 flex items-center gap-1.5">
                <Send className="w-3 h-3" /> Contactar
              </p>
              <div className="flex flex-wrap gap-2">
                {hasWaLink && (
                  <a
                    href={getWhatsAppUrl(customer.phone!, encodeURIComponent(`Hola ${customer.name}, ¿en qué podemos ayudarte?`))}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => business?.id && logWaSent(business.id, customer.phone!, `Hola ${customer.name}, ¿en qué podemos ayudarte?`)}
                  >
                    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400" data-testid="btn-contact-wa">
                      <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                    </Button>
                  </a>
                )}
                {hasWaTwilio && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={contactingChannel !== null}
                    onClick={() => contact('whatsapp_twilio', customer.phone!)} data-testid="btn-contact-wa-twilio">
                    {contactingChannel === 'whatsapp_twilio' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                    WA Twilio
                  </Button>
                )}
                {hasSms && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={contactingChannel !== null}
                    onClick={() => contact('sms', customer.phone!)} data-testid="btn-contact-sms">
                    {contactingChannel === 'sms' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    SMS
                  </Button>
                )}
                {hasVoice && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={contactingChannel !== null}
                    onClick={() => contact('voice', customer.phone!)} data-testid="btn-contact-voice">
                    {contactingChannel === 'voice' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PhoneCall className="w-3.5 h-3.5" />}
                    Llamar
                  </Button>
                )}
                {hasEmail && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" disabled={contactingChannel !== null}
                    onClick={() => contact('email', customer.email!)} data-testid="btn-contact-email">
                    {contactingChannel === 'email' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                    Email
                  </Button>
                )}
              </div>
            </div>
          );
        })()}

        {/* Tags */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-1.5 mb-2.5">
            <Tag className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Etiquetas</span>
            {savingTags && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-auto" />}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TAG_OPTIONS.map(opt => {
              const active = tags.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => toggleTag(opt)}
                  data-testid={`tag-toggle-${opt}`}
                  className={cn(
                    'text-xs px-2.5 py-1 rounded-full border font-medium transition-all',
                    active
                      ? tagClass(opt)
                      : 'bg-muted/50 text-muted-foreground border-border hover:border-foreground/30 hover:text-foreground'
                  )}
                >
                  {active && '✓ '}{opt}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-1.5 mb-2">
            <StickyNote className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Notas internas</span>
            {savingNotes && <span className="text-xs text-muted-foreground ml-auto">Guardando…</span>}
          </div>
          <Textarea
            value={notes}
            onChange={e => handleNotesChange(e.target.value)}
            placeholder="Escribe notas sobre este cliente…"
            rows={3}
            className="resize-none text-sm"
            data-testid="textarea-customer-notes"
          />
        </div>

        {/* Order history */}
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-1.5 mb-3">
            <Hash className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Historial de pedidos</span>
          </div>
          {loadingOrders ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <ShoppingBag className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">
                {customer.phone ? 'Sin pedidos registrados' : 'Sin teléfono — no se pueden buscar pedidos'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {orders.map(order => (
                <div key={order.id} className="rounded-xl border border-border bg-muted/20 p-3 hover:bg-muted/40 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ORDER_STATUS_COLOR[order.status] ?? 'bg-muted text-muted-foreground')}>
                      {ORDER_STATUS_LABEL[order.status] ?? order.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{order.notes ? order.notes.slice(0, 50) + (order.notes.length > 50 ? '…' : '') : 'Sin notas'}</span>
                    <span className="text-sm font-semibold">{formatCurrency(order.total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Chat history */}
        <div className="p-5 flex-1">
          <div className="flex items-center gap-1.5 mb-3">
            <Bot className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">Chats IA</span>
            {conversations.length > 0 && (
              <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded-full px-1.5 font-medium">{conversations.length}</span>
            )}
          </div>
          {loadingConvs ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Bot className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Sin conversaciones IA registradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map(conv => {
                const msgs = Array.isArray(conv.messages) ? conv.messages as { role: string; content: string }[] : [];
                const isExpanded = expandedConv === conv.id;
                return (
                  <div key={conv.id} className="rounded-xl border border-border bg-muted/20 overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 hover:bg-muted/40 transition-colors text-left"
                      onClick={() => setExpandedConv(isExpanded ? null : conv.id)}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {conv.had_order && (
                          <span className={cn(
                            'flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1',
                            conv.source === 'cart'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                          )}>
                            <ShoppingCart className="w-3 h-3" />
                            {conv.source === 'cart' ? 'Carrito' : 'Pedido IA'}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {conv.source === 'cart' ? '🛒' : '🤖'} {msgs.length} msg · {new Date(conv.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    </button>
                    {isExpanded && msgs.length > 0 && (
                      <div className="px-3 pb-3 space-y-1.5 border-t border-border pt-2">
                        {msgs.map((m, i) => (
                          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                            <div className={cn(
                              'max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs leading-relaxed',
                              m.role === 'user' ? 'bg-foreground text-background' : 'bg-background border border-border text-foreground'
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
          )}
        </div>
        </div>}

        {activeSection === 'historial' && (
          <div className="p-5 flex-1 overflow-y-auto">
            <CustomerTimeline
              businessId={customer.business_id}
              phone={customer.phone ?? null}
              name={customer.name}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── CustomerCard ─────────────────────────────────────────────────────────────

interface CardProps {
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
  onClick: () => void;
  onEdit: () => void;
  totalSpent: number;
}

function CustomerCard({ customer, selected, onSelect, onClick, onEdit, totalSpent }: CardProps) {
  return (
    <div
      data-testid={`card-customer-${customer.id}`}
      className={cn(
        'relative rounded-2xl border transition-all duration-200 cursor-pointer group overflow-hidden bg-card',
        selected
          ? 'border-foreground/40 shadow-sm ring-2 ring-foreground/10'
          : 'border-border hover:border-foreground/20 hover:shadow-md'
      )}
      onClick={onClick}
    >
      {/* Active indicator strip */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl',
        customer.is_active ? 'bg-green-400 dark:bg-green-500' : 'bg-muted-foreground/20'
      )} />

      <div className="p-4 pl-5">
        {/* Top row: checkbox + avatar + name */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className="mt-0.5 flex-shrink-0"
            onClick={e => { e.stopPropagation(); onSelect(); }}
          >
            <Checkbox
              checked={selected}
              className="border-muted-foreground/40 pointer-events-none"
              data-testid={`checkbox-customer-${customer.id}`}
            />
          </div>
          <div className="w-10 h-10 rounded-xl bg-foreground/8 flex items-center justify-center flex-shrink-0 font-semibold text-sm text-foreground/60 select-none">
            {getInitials(customer.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm leading-tight truncate" translate="no">{customer.name}</p>
            {customer.phone && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1 truncate">
                <Phone className="w-3 h-3 flex-shrink-0" /> {customer.phone}
              </p>
            )}
          </div>
          {/* Edit button (hover) */}
          <button
            onClick={e => { e.stopPropagation(); onEdit(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-muted text-muted-foreground flex-shrink-0"
            data-testid={`button-edit-customer-${customer.id}`}
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Tags */}
        {customer.tags && customer.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {customer.tags.slice(0, 3).map(tag => (
              <span key={tag} className={cn('text-xs px-2 py-0.5 rounded-full border font-medium', tagClass(tag))}>
                {tag}
              </span>
            ))}
            {customer.tags.length > 3 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                +{customer.tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mt-1">
          <span className="flex items-center gap-1">
            <ShoppingBag className="w-3 h-3" />
            {customer.total_orders} pedido{customer.total_orders !== 1 ? 's' : ''}
          </span>
          <span>{relativeDate(customer.last_order_at)}</span>
        </div>

        {/* Spent row */}
        {totalSpent > 0 && (
          <div className="flex items-center gap-1 text-xs mt-1">
            <TrendingUp className="w-3 h-3 text-muted-foreground" />
            <span className="font-medium text-foreground/80">{formatCurrency(totalSpent)}</span>
            <span className="text-muted-foreground">gastado</span>
          </div>
        )}

        {/* Notes preview */}
        {customer.notes && (
          <p className="text-xs text-muted-foreground/70 mt-2 line-clamp-1 italic">
            {customer.notes}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Customers page ──────────────────────────────────────────────────────

export default function Customers() {
  const { business } = useBusiness();
  const { toast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [spentByPhone, setSpentByPhone] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [sortAsc, setSortAsc] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [phoneConflict, setPhoneConflict] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [difusionOpen, setDifusionOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importDone, setImportDone] = useState<{ added: number; updated: number; errors: number } | null>(null);

  const [mainView, setMainView] = useState<MainView>('customers');
  const [allChats, setAllChats] = useState<AiConversation[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [chatSearch, setChatSearch] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sheetCustomer, setSheetCustomer] = useState<Customer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const load = async () => {
    if (!business) return;
    const [{ data: customersData }, { data: ordersData }] = await Promise.all([
      supabase.from('customers').select('*').eq('business_id', business.id).order('last_order_at', { ascending: !sortAsc, nullsFirst: false }).order('name', { ascending: sortAsc }),
      supabase.from('orders').select('customer_phone,total,status').eq('business_id', business.id),
    ]);
    const spentMap = new Map<string, number>();
    if (ordersData) {
      for (const order of ordersData) {
        if (order.status === 'completed' && order.customer_phone) {
          spentMap.set(order.customer_phone, (spentMap.get(order.customer_phone) ?? 0) + order.total);
        }
      }
    }
    setCustomers(customersData || []);
    setSpentByPhone(spentMap);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business, sortAsc]);

  useEffect(() => {
    if (!business) return;
    const channel = supabase
      .channel(`crm-customers-${business.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers', filter: `business_id=eq.${business.id}` }, () => { load(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `business_id=eq.${business.id}` }, () => { load(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [business]);

  const loadChats = async () => {
    if (!business) return;
    setLoadingChats(true);
    const { data } = await supabase
      .from('ai_conversations')
      .select('*')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false })
      .limit(200);
    setAllChats(data || []);
    setLoadingChats(false);
  };

  useEffect(() => {
    if (mainView === 'chats' && business) loadChats();
  }, [mainView, business]);

  const filtered = useMemo(() => {
    let list = customers;
    if (tab === 'inactive') list = list.filter(c => !c.is_active);
    else if (tab === 'first_order') list = list.filter(c => c.total_orders === 1);
    else if (tab === 'never_ordered') list = list.filter(c => c.total_orders === 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.notes || '').toLowerCase().includes(q) ||
        (c.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [customers, tab, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const tabCounts = useMemo(() => ({
    all: customers.length,
    inactive: customers.filter(c => !c.is_active).length,
    first_order: customers.filter(c => c.total_orders === 1).length,
    never_ordered: customers.filter(c => c.total_orders === 0).length,
  }), [customers]);

  const allPageSelected = paginated.length > 0 && paginated.every(c => selected.has(c.id));
  const toggleAll = () => {
    if (allPageSelected) setSelected(prev => { const s = new Set(prev); paginated.forEach(c => s.delete(c.id)); return s; });
    else setSelected(prev => { const s = new Set(prev); paginated.forEach(c => s.add(c.id)); return s; });
  };
  const toggleOne = (id: string) => setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const openAdd = () => { setEditingCustomer(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '', notes: c.notes || '', is_active: c.is_active });
    setDialogOpen(true);
  };
  const closeDialog = () => { setDialogOpen(false); setEditingCustomer(null); setForm(EMPTY_FORM); setPhoneConflict(null); };

  const findPhoneOwner = async (phone: string, excludeId?: string) => {
    const q = supabase.from('customers').select('id, name').eq('business_id', business!.id).eq('phone', phone.trim());
    if (excludeId) q.neq('id', excludeId);
    const { data } = await q.maybeSingle();
    return data ?? null;
  };

  const save = async () => {
    if (!business || !form.name.trim()) return;
    setSaving(true);
    setPhoneConflict(null);
    const phone = form.phone.trim() || null;

    if (editingCustomer) {
      const { error } = await supabase.from('customers').update({
        name: form.name.trim(),
        phone,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
      }).eq('id', editingCustomer.id).eq('business_id', business.id);
      if (error) {
        console.error('[Customers save error]', error);
        const isPhoneDup = error.message.includes('idx_customers_business_phone') || error.message.includes('unique');
        if (isPhoneDup && phone) {
          const owner = await findPhoneOwner(phone, editingCustomer.id);
          setPhoneConflict(owner ? { id: owner.id, name: owner.name } : { id: '', name: '(desconocido)' });
        } else {
          toast({ title: 'Error al actualizar', description: error.message, variant: 'destructive' });
        }
        setSaving(false);
        return;
      }
      toast({ title: 'Cliente actualizado' });
    } else {
      const { error } = await supabase.from('customers').insert({
        business_id: business.id,
        name: form.name.trim(),
        phone,
        email: form.email.trim() || null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        is_active: form.is_active,
        total_orders: 0,
      });
      if (error) {
        console.error('[Customers insert error]', error);
        const isPhoneDup = error.message.includes('idx_customers_business_phone') || error.message.includes('unique');
        if (isPhoneDup && phone) {
          const owner = await findPhoneOwner(phone);
          setPhoneConflict(owner ? { id: owner.id, name: owner.name } : { id: '', name: '(desconocido)' });
        } else {
          toast({ title: 'Error al añadir', description: error.message, variant: 'destructive' });
        }
        setSaving(false);
        return;
      }
      toast({ title: 'Cliente añadido' });
    }
    setSaving(false);
    closeDialog();
    load();
  };

  const deleteSelected = async () => {
    if (!selected.size) return;
    await supabase.from('customers').delete().in('id', [...selected]);
    setSelected(new Set());
    toast({ title: `${selected.size} cliente(s) eliminado(s)` });
    load();
  };

  const exportCSV = () => {
    const rows = [
      ['Nombre', 'Teléfono', 'Correo', 'Dirección', 'Etiquetas', 'Total pedidos', 'Activo', 'Notas', 'Creado'],
      ...filtered.map(c => [
        c.name, c.phone || '', c.email || '', c.address || '',
        (c.tags || []).join('; '),
        String(c.total_orders),
        c.is_active ? 'Sí' : 'No',
        c.notes || '',
        new Date(c.created_at).toLocaleDateString('es-CO'),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    link.download = `clientes-${business?.slug || 'export'}.csv`;
    link.click();
  };

  const downloadTemplate = () => {
    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(TEMPLATE_CSV);
    link.download = 'plantilla-clientes.csv';
    link.click();
  };

  const openImport = () => { setImportRows([]); setImportDone(null); setImportOpen(true); };

  const handleFileDrop = async (file: File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(ext)) {
      toast({ title: 'Formato no soportado', description: 'Usa CSV, XLSX o XLS', variant: 'destructive' }); return;
    }
    const rows = await parseFile(file);
    if (!rows.length) { toast({ title: 'Archivo vacío o sin columna "Nombre"', variant: 'destructive' }); return; }
    setImportRows(rows); setImportDone(null);
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (file) await handleFileDrop(file);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); const file = e.dataTransfer.files?.[0]; if (file) await handleFileDrop(file);
  };

  const validRows = importRows.filter(r => !r.error);
  const errorRows = importRows.filter(r => r.error);

  const runImport = async () => {
    if (!business || !validRows.length) return;
    setImporting(true);
    setImportProgress({ current: 0, total: validRows.length });
    let added = 0; let updated = 0; let errors = 0;

    const normPhone = (p: string) => p.replace(/\D/g, '').replace(/^57(\d{10})$/, '$1');
    const normName  = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');

    // Load ALL existing customers (phone and name index), page through to avoid truncation
    const allExisting: { id: string; phone: string | null; name: string }[] = [];
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from('customers')
        .select('id, phone, name')
        .eq('business_id', business.id)
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      allExisting.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }

    const phoneToId = new Map<string, string>();
    const nameToId  = new Map<string, string>();
    allExisting.forEach(c => {
      if (c.phone) phoneToId.set(normPhone(c.phone), c.id);
      nameToId.set(normName(c.name), c.id);
    });

    // Track IDs already touched in this import run to avoid double-processing
    const touchedIds = new Set<string>();

    for (let idx = 0; idx < validRows.length; idx++) {
      setImportProgress({ current: idx + 1, total: validRows.length });
      const r = validRows[idx];
      const phone = r.phone?.trim() || null;
      const nPhone = phone ? normPhone(phone) : '';
      const nName  = normName(r.name);

      // Resolve existing record: phone match first, then name fallback
      let existingId = (nPhone && phoneToId.get(nPhone)) || nameToId.get(nName) || null;
      if (existingId && touchedIds.has(existingId)) existingId = null; // avoid double-update same record

      if (existingId) {
        const { error } = await supabase.from('customers').update({
          name: r.name,
          phone: phone,
          email: r.email || null,
          address: r.address || null,
          notes: r.notes || null,
        }).eq('id', existingId);
        if (error) errors++;
        else {
          updated++;
          touchedIds.add(existingId);
          if (nPhone) phoneToId.set(nPhone, existingId);
          nameToId.set(nName, existingId);
        }
      } else {
        const { data: inserted, error } = await supabase.from('customers').insert({
          business_id: business.id,
          name: r.name,
          phone: phone,
          email: r.email || null,
          address: r.address || null,
          notes: r.notes || null,
          is_active: true,
          total_orders: 0,
        }).select('id').maybeSingle();
        if (error) errors++;
        else {
          added++;
          if (inserted) {
            touchedIds.add(inserted.id);
            if (nPhone) phoneToId.set(nPhone, inserted.id);
            nameToId.set(nName, inserted.id);
          }
        }
      }
    }

    setImporting(false);
    setImportDone({ added, updated, errors });
    if (added > 0 || updated > 0) load();
  };

  const openSheet = (c: Customer) => { setSheetCustomer(c); setSheetOpen(true); };
  const handleSheetUpdate = (updated: Customer) => {
    setCustomers(cs => cs.map(c => c.id === updated.id ? updated : c));
    setSheetCustomer(updated);
  };

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'Todo' },
    { key: 'inactive', label: 'Inactivo' },
    { key: 'first_order', label: 'Primer pedido' },
    { key: 'never_ordered', label: 'Sin pedidos' },
  ];

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            onClick={() => setMainView('customers')}
            className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
              mainView === 'customers' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            data-testid="tab-view-customers"
          >
            <User className="w-3.5 h-3.5" /> Clientes
          </button>
          <button
            onClick={() => setMainView('chats')}
            className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5',
              mainView === 'chats' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
            data-testid="tab-view-chats"
          >
            <Bot className="w-3.5 h-3.5" /> Chats IA
            {allChats.length > 0 && (
              <span className="text-xs bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 rounded-full px-1.5 font-medium">{allChats.length}</span>
            )}
          </button>
        </div>
        {mainView === 'customers' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openImport} data-testid="button-import-customers">
              <Upload className="w-3.5 h-3.5" /> Importar
            </Button>
            {selected.size > 0 && (
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" onClick={deleteSelected}>
                <Trash2 className="w-3.5 h-3.5" /> Eliminar ({selected.size})
              </Button>
            )}
            <Button size="sm" className="gap-1.5 bg-foreground text-background hover:bg-foreground/90" onClick={openAdd} data-testid="button-add-customer">
              <Plus className="w-3.5 h-3.5" /> Añadir cliente
            </Button>
          </div>
        )}
      </div>

      {/* ── Chats IA view ── */}
      {mainView === 'chats' && (
        <div className="card-elevated rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={chatSearch}
                onChange={e => setChatSearch(e.target.value)}
                placeholder="Buscar por nombre de cliente…"
                className="pl-9 bg-muted/40 border-0 focus-visible:ring-1"
                data-testid="input-chat-search"
              />
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={loadChats} data-testid="button-refresh-chats">
              <Loader2 className={cn('w-3.5 h-3.5', loadingChats && 'animate-spin')} /> Actualizar
            </Button>
          </div>
          <div className="p-4">
            {loadingChats ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (() => {
              const q = chatSearch.trim().toLowerCase();
              const filtered2 = q
                ? allChats.filter(c => (c.customer_name || '').toLowerCase().includes(q))
                : allChats;
              if (filtered2.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Bot className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground font-medium">
                      {q ? 'Sin resultados' : 'Aún no hay conversaciones IA registradas'}
                    </p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Las conversaciones aparecen aquí cuando los clientes usan el asistente del menú
                    </p>
                  </div>
                );
              }
              return (
                <div className="space-y-2">
                  {filtered2.map(conv => {
                    const msgs = Array.isArray(conv.messages) ? conv.messages as { role: string; content: string }[] : [];
                    const isExp = expandedChat === conv.id;
                    return (
                      <div key={conv.id} className="rounded-xl border border-border bg-card overflow-hidden">
                        <button
                          className="w-full flex items-center gap-3 p-3 hover:bg-muted/40 transition-colors text-left"
                          onClick={() => setExpandedChat(isExp ? null : conv.id)}
                        >
                          <div className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0',
                            conv.source === 'cart'
                              ? 'bg-green-100 dark:bg-green-900/30'
                              : 'bg-violet-100 dark:bg-violet-900/30'
                          )}>
                            {conv.source === 'cart'
                              ? <ShoppingCart className="w-4 h-4 text-green-600 dark:text-green-400" />
                              : <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">
                                {conv.customer_name || 'Visitante anónimo'}
                              </span>
                              {conv.had_order && (
                                <span className={cn(
                                  'text-xs px-1.5 py-0.5 rounded-full font-medium flex items-center gap-1 flex-shrink-0',
                                  conv.source === 'cart'
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                                )}>
                                  <ShoppingCart className="w-3 h-3" />
                                  {conv.source === 'cart' ? 'Carrito' : 'Pedido IA'}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {conv.source === 'cart' ? '🛒 Menú digital' : '🤖 Asistente IA'} · {new Date(conv.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          {isExp ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                        </button>
                        {isExp && msgs.length > 0 && (
                          <div className="px-4 pb-4 border-t border-border pt-3 space-y-2 bg-muted/10">
                            {msgs.map((m, i) => (
                              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                                <div className={cn(
                                  'max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed',
                                  m.role === 'user' ? 'bg-foreground text-background' : 'bg-background border border-border text-foreground'
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
              );
            })()}
          </div>
          <div className="px-4 py-2.5 border-t border-border bg-muted/20">
            <span className="text-sm text-muted-foreground">{allChats.length} conversación{allChats.length !== 1 ? 'es' : ''} · {allChats.filter(c => c.had_order).length} con pedido</span>
          </div>
        </div>
      )}

      {/* ── Main container (Customers view) ── */}
      {mainView === 'customers' && <div className="card-elevated rounded-xl overflow-hidden">
        {/* Search + actions row */}
        <div className="flex items-center gap-2 p-3 border-b border-border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar por nombre, teléfono, correo, etiqueta…"
              className="pl-9 bg-muted/40 border-0 focus-visible:ring-1"
              data-testid="input-customer-search"
            />
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={exportCSV}>
            <Download className="w-3.5 h-3.5" /> Exportar
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={() => setDifusionOpen(true)} data-testid="button-difusiones">
            <Bell className="w-3.5 h-3.5" /> Difusiones
          </Button>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center justify-between px-3 border-b border-border">
          <div className="flex items-center overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setPage(1); }}
                className={cn(
                  'px-3 py-2.5 text-sm border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5',
                  tab === t.key
                    ? 'border-foreground text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
                <span className={cn(
                  'text-xs rounded-full px-1.5 font-medium',
                  tab === t.key ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                )}>
                  {tabCounts[t.key]}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 py-2 flex-shrink-0">
            <div className="flex items-center gap-0.5">
              <div
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-muted cursor-pointer"
                onClick={toggleAll}
                title="Seleccionar página"
              >
                <Checkbox checked={allPageSelected} onCheckedChange={toggleAll} className="border-muted-foreground/40 pointer-events-none" />
              </div>
              <Button
                variant="ghost" size="icon" className="w-7 h-7"
                title={sortAsc ? 'Ordenar Z-A' : 'Ordenar A-Z'}
                onClick={() => setSortAsc(a => !a)}
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Cards grid */}
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : paginated.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <User className="w-10 h-10 text-muted-foreground/30 mb-3" />
              <p className="text-muted-foreground font-medium">
                {search ? 'Sin resultados para esta búsqueda' : 'No hay clientes aún'}
              </p>
              {!search && (
                <p className="text-sm text-muted-foreground/70 mt-1">
                  Añade tu primer cliente o importa desde Excel / CSV
                </p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {paginated.map(customer => (
                <CustomerCard
                  key={customer.id}
                  customer={customer}
                  selected={selected.has(customer.id)}
                  onSelect={() => toggleOne(customer.id)}
                  onClick={() => openSheet(customer)}
                  onEdit={() => openEdit(customer)}
                  totalSpent={spentByPhone.get(customer.phone || '') ?? 0}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
          <span className="text-sm text-muted-foreground">
            {filtered.length} cliente{filtered.length !== 1 ? 's' : ''}
            {selected.size > 0 && <span className="ml-2 text-foreground font-medium">· {selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>}
          </span>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="text-sm border border-input rounded px-1.5 py-0.5 bg-background h-7"
            >
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Button variant="outline" size="icon" className="w-7 h-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <span className="text-sm text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="icon" className="w-7 h-7" onClick={() => setPage(p => Math.min(pageCount, p + 1))} disabled={page >= pageCount}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>}

      {/* ── Customer Detail Sheet ── */}
      <CustomerDetailSheet
        customer={sheetCustomer}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onUpdate={handleSheetUpdate}
        onEdit={c => { setSheetOpen(false); openEdit(c); }}
        business={business}
      />

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={v => { if (!v) closeDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Editar cliente' : 'Añadir cliente'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre completo" autoFocus data-testid="input-customer-name" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> Teléfono</Label>
              <Input
                value={form.phone}
                onChange={e => { setForm(f => ({ ...f, phone: e.target.value })); setPhoneConflict(null); }}
                placeholder="+57 300 000 0000"
                type="tel"
                data-testid="input-customer-phone"
              />
              {phoneConflict && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {phoneConflict.id
                        ? <>Teléfono ya registrado para <span className="underline">{phoneConflict.name}</span></>
                        : 'Teléfono duplicado, pero no se encontró el cliente dueño'
                      }
                    </p>
                    {phoneConflict.id && (
                      <button
                        type="button"
                        className="mt-1 text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:opacity-80"
                        onClick={() => {
                          const c = customers.find(x => x.id === phoneConflict.id);
                          if (c) { closeDialog(); openSheet(c); }
                        }}
                      >
                        Abrir ese cliente →
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" /> Correo electrónico</Label>
              <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="cliente@ejemplo.com" type="email" data-testid="input-customer-email" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Dirección</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Calle, barrio, referencia..." data-testid="input-customer-address" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Notas</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notas sobre este cliente..." rows={3} data-testid="input-customer-notes" />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Cliente activo</p>
                <p className="text-xs text-muted-foreground">Los clientes inactivos no aparecen en difusiones</p>
              </div>
              <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDialog} disabled={saving}>
              <X className="w-3.5 h-3.5 mr-1.5" /> Cancelar
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()} data-testid="button-save-customer">
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {editingCustomer ? 'Guardar cambios' : 'Añadir cliente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Difusiones Dialog ── */}
      <DifusionesDialog
        open={difusionOpen}
        onClose={() => setDifusionOpen(false)}
        allCustomers={customers}
        filteredCustomers={filtered}
        selectedIds={selected}
        business={business}
      />

      {/* ── Import Dialog ── */}
      <Dialog open={importOpen} onOpenChange={v => { if (!v && !importing) setImportOpen(false); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
              Importar clientes desde archivo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted/50 border border-border px-4 py-3 text-sm space-y-1.5">
              <p className="font-medium">Formato aceptado: CSV · Excel (.xlsx / .xls)</p>
              <p className="text-muted-foreground">
                Columnas: <span className="font-mono bg-background px-1 rounded">Nombre</span> (obligatorio),{' '}
                <span className="font-mono bg-background px-1 rounded">Teléfono</span>,{' '}
                <span className="font-mono bg-background px-1 rounded">Correo</span>,{' '}
                <span className="font-mono bg-background px-1 rounded">Dirección</span>,{' '}
                <span className="font-mono bg-background px-1 rounded">Notas</span>
              </p>
              <button onClick={downloadTemplate} className="text-primary underline underline-offset-2 text-xs mt-1 hover:opacity-80">
                ↓ Descargar plantilla CSV de ejemplo
              </button>
            </div>

            {(importRows.length === 0 || importDone) && (
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => { setImportRows([]); setImportDone(null); if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 cursor-pointer transition-colors select-none',
                  dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/30'
                )}
                data-testid="dropzone-import"
              >
                <Upload className={cn('w-8 h-8', dragging ? 'text-primary' : 'text-muted-foreground')} />
                <div className="text-center">
                  <p className="text-sm font-medium">Arrastra tu archivo aquí</p>
                  <p className="text-xs text-muted-foreground mt-0.5">o haz clic para seleccionar · CSV, XLSX, XLS</p>
                </div>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleInputChange} />

            {importDone && (
              <div className={cn(
                'flex items-center gap-3 rounded-lg px-4 py-3 text-sm',
                importDone.errors === 0
                  ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
                  : 'bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300'
              )}>
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <div>
                  {importDone.added > 0 && (
                    <p className="font-medium">{importDone.added} cliente{importDone.added !== 1 ? 's' : ''} nuevo{importDone.added !== 1 ? 's' : ''} añadido{importDone.added !== 1 ? 's' : ''}</p>
                  )}
                  {importDone.updated > 0 && (
                    <p className="font-medium">{importDone.updated} cliente{importDone.updated !== 1 ? 's' : ''} actualizado{importDone.updated !== 1 ? 's' : ''}</p>
                  )}
                  {importDone.errors > 0 && <p className="text-xs mt-0.5">{importDone.errors} fila{importDone.errors !== 1 ? 's' : ''} con error no se procesaron</p>}
                </div>
              </div>
            )}

            {importRows.length > 0 && !importDone && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Vista previa — {validRows.length} cliente{validRows.length !== 1 ? 's' : ''} válido{validRows.length !== 1 ? 's' : ''}
                    {errorRows.length > 0 && <span className="ml-2 text-destructive text-xs">· {errorRows.length} con error</span>}
                  </p>
                  <button onClick={() => { setImportRows([]); if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }} className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                    Cambiar archivo
                  </button>
                </div>
                <div className="rounded-lg border border-border overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nombre</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Teléfono</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Correo</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">Dirección</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">Notas</th>
                        <th className="w-6 px-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {importRows.map((row, i) => (
                        <tr key={i} className={cn('hover:bg-muted/20', row.error && 'bg-red-50 dark:bg-red-900/10')}>
                          <td className="px-3 py-1.5" translate="no">{row.name || <span className="text-destructive italic">vacío</span>}</td>
                          <td className="px-3 py-1.5 hidden sm:table-cell text-muted-foreground">{row.phone}</td>
                          <td className="px-3 py-1.5 hidden sm:table-cell text-muted-foreground">{row.email}</td>
                          <td className="px-3 py-1.5 hidden md:table-cell text-muted-foreground truncate max-w-[120px]">{row.address}</td>
                          <td className="px-3 py-1.5 hidden md:table-cell text-muted-foreground truncate max-w-[120px]">{row.notes}</td>
                          <td className="px-2 py-1.5">
                            {row.error && <span title={row.error}><AlertCircle className="w-3.5 h-3.5 text-destructive" /></span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              <X className="w-3.5 h-3.5 mr-1.5" /> {importDone ? 'Cerrar' : 'Cancelar'}
            </Button>
            {importRows.length > 0 && !importDone && (
              <Button onClick={runImport} disabled={importing || validRows.length === 0} data-testid="button-confirm-import">
                {importing
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />{importProgress.current}/{importProgress.total}</>
                  : <><Upload className="w-3.5 h-3.5 mr-1.5" />Importar {validRows.length} cliente{validRows.length !== 1 ? 's' : ''}</>
                }
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
