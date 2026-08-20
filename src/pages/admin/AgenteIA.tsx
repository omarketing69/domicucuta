import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Bot, Save, Zap, Plus, Loader2, BookOpen, GitBranch,
  UserCheck, Edit2, Headphones, Trash2, Check, Clock,
  Camera, MessageCircle, MessageSquare,
} from 'lucide-react';
import { WaContact, WaConversation, WaChannel } from '@/lib/whatsappCrm';
import { hasCrmAccess } from '@/lib/sso';

// ── Types ─────────────────────────────────────────────────────────────────────

type KbItem   = { id: string; type: 'faq' | 'policy' | 'info' | 'promo'; title: string; content: string };
type FlowNode = {
  id: string; business_id: string; name: string;
  trigger_keywords: string[]; trigger_intent: string | null;
  response_template: string; sort_order: number; is_active: boolean; created_at: string;
};
type DaySchedule = { open: string; close: string } | null;
type OpsHours    = { timezone: string } & Record<string, DaySchedule | string | undefined>;

// ── Constants ─────────────────────────────────────────────────────────────────

const AI_MODELS = [
  { value: 'google/gemma-4-26b-a4b-it:free',          label: 'Gemma 4 26B — recomendado (Gratis)' },
  { value: 'google/gemma-4-31b-it:free',              label: 'Gemma 4 31B — Google (Gratis)' },
  { value: 'meta-llama/llama-3.3-70b-instruct:free',  label: 'Llama 3.3 70B — Meta (Gratis)' },
  { value: 'nousresearch/hermes-3-llama-3.1-405b:free', label: 'Hermes 3 405B — muy capaz (Gratis)' },
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

const INTENT_LABELS: Record<string, string> = {
  order: 'Pedido', inquiry: 'Consulta', complaint: 'Queja',
  follow_up: 'Seguimiento', other: 'Otro',
};

const INTENT_COLORS: Record<string, string> = {
  order:     'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  inquiry:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  complaint: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  follow_up: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  other:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function ChannelIcon({ channel, className }: { channel: WaChannel; className?: string }) {
  if (channel === 'instagram') return <Camera className={cn('text-pink-500', className)} />;
  if (channel === 'messenger') return <MessageCircle className={cn('text-blue-500', className)} />;
  return <MessageSquare className={cn('text-emerald-500', className)} />;
}

// ── General tab ───────────────────────────────────────────────────────────────

function AgentGeneralTab({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { refetch: refetchBusiness } = useBusiness();
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
      refetchBusiness();
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

// ── Page shell ────────────────────────────────────────────────────────────────

export default function AgenteIA() {
  const { business, isLoading: bizLoading } = useBusiness();
  const [tab, setTab] = useState<'general' | 'knowledge' | 'flows' | 'handoff'>('general');

  const tabs = [
    { id: 'general',   label: 'General',      icon: Bot       },
    { id: 'knowledge', label: 'Conocimiento',  icon: BookOpen  },
    { id: 'flows',     label: 'Flujos',        icon: GitBranch },
    { id: 'handoff',   label: 'Transferencia', icon: Headphones },
  ] as const;

  if (bizLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!business) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No se encontró información del negocio.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-background flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-violet-500 text-white shadow-sm shadow-violet-200 dark:shadow-violet-900">
            <Bot className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-base font-semibold leading-tight">Agente IA</h1>
            <p className="text-xs text-muted-foreground">Configura tu asistente virtual que responde a los clientes</p>
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
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

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {tab === 'general'   && <AgentGeneralTab   businessId={business.id} />}
        {tab === 'knowledge' && <AgentKnowledgeTab businessId={business.id} />}
        {tab === 'flows'     && <AgentFlowsTab     businessId={business.id} />}
        {tab === 'handoff'   && <AgentHandoffTab   businessId={business.id} />}
      </div>
    </div>
  );
}
