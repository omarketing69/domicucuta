import { useState, useMemo } from 'react';
import { Database } from '@/integrations/supabase/types';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  MessageSquare, ChevronRight, ChevronLeft, Check,
  SkipForward, Send, Users, Phone, AlertTriangle,
  ArrowLeft, ExternalLink, Sparkles, Zap, Settings, Loader2,
  CheckCircle2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type Customer = Database['public']['Tables']['customers']['Row'];
type Business = Database['public']['Tables']['businesses']['Row'];

type RecipientScope = 'active' | 'filter' | 'selected';

interface Props {
  open: boolean;
  onClose: () => void;
  allCustomers: Customer[];
  filteredCustomers: Customer[];
  selectedIds: Set<string>;
  business: Business | null;
}

type SendStatus = 'pending' | 'sent' | 'skipped';

interface QueueItem {
  customer: Customer;
  status: SendStatus;
}

type AutoContactStatus = 'pending' | 'sending' | 'sent' | 'failed';

interface AutoContact {
  customer: Customer;
  filledMessage: string;
  status: AutoContactStatus;
  error?: string;
}

const VARIABLES = [
  { token: '{nombre}', label: 'Nombre' },
  { token: '{telefono}', label: 'Teléfono' },
  { token: '{notas}', label: 'Notas' },
];

function fillTemplate(template: string, customer: Customer): string {
  return template
    .replace(/\{nombre\}/gi, customer.name)
    .replace(/\{telefono\}/gi, customer.phone || '')
    .replace(/\{notas\}/gi, customer.notes || '');
}

function cleanPhone(raw: string): string {
  let p = raw.replace(/[\s\-().+]/g, '');
  if (!p) return '';
  if (p.length === 10 && p.startsWith('3')) p = '57' + p;
  return p;
}

function buildWaLink(phone: string, text: string): string {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return '';
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(text)}`;
}

export default function DifusionesDialog({ open, onClose, allCustomers, filteredCustomers, selectedIds, business }: Props) {
  const [step, setStep] = useState<'compose' | 'send' | 'auto_sending' | 'done'>('compose');
  const [message, setMessage] = useState('Hola {nombre}, te escribimos desde nuestro negocio. 👋');
  const [scope, setScope] = useState<RecipientScope>('active');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState(0);
  const [autoMode, setAutoMode] = useState(false);
  const [autoContacts, setAutoContacts] = useState<AutoContact[]>([]);
  const [autoGlobalError, setAutoGlobalError] = useState<string | null>(null);
  const navigate = useNavigate();

  const isPro = business?.plan === 'pro';
  const hasWaCreds = !!(business?.wa_phone_number_id && business?.wa_access_token);

  const recipients = useMemo((): Customer[] => {
    let list: Customer[];
    if (scope === 'active') list = allCustomers.filter(c => c.is_active);
    else if (scope === 'filter') list = filteredCustomers;
    else list = allCustomers.filter(c => selectedIds.has(c.id));
    return list;
  }, [scope, allCustomers, filteredCustomers, selectedIds]);

  const withPhone = recipients.filter(c => !!c.phone);
  const withoutPhone = recipients.filter(c => !c.phone);
  const preview = withPhone[0];

  const insertVariable = (token: string) => {
    setMessage(m => m + token);
  };

  const startSend = () => {
    if (!withPhone.length || !message.trim()) return;
    if (autoMode && isPro && hasWaCreds) {
      runAutoSend();
    } else {
      const q: QueueItem[] = withPhone.map(c => ({ customer: c, status: 'pending' }));
      setQueue(q);
      setCursor(0);
      setStep('send');
    }
  };

  const runAutoSend = async () => {
    if (!business) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setAutoGlobalError('Sin sesión activa. Por favor recarga la página.');
      setStep('done');
      return;
    }

    // Initialise all contacts as 'sending' — the single backend call processes all in parallel
    const initial: AutoContact[] = withPhone.map(c => ({
      customer: c,
      filledMessage: fillTemplate(message, c),
      status: 'sending',
    }));
    setAutoContacts(initial);
    setAutoGlobalError(null);
    setStep('auto_sending');

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-whatsapp-broadcast`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          business_id: business.id,
          recipients: withPhone.map(c => ({ clientId: c.id, phone: c.phone!, name: c.name, notes: c.notes || '' })),
          message,
        }),
      });

      if (!res.ok || !res.body) {
        const errData: unknown = await res.json().catch(() => ({}));
        const errMsg = (errData as { error?: string })?.error ?? `Error ${res.status}`;
        setAutoGlobalError(errMsg);
        setStep('done');
        return;
      }

      // Build a clientId→index map for stable correlation regardless of duplicate phones
      const idIndex = new Map<string, number>(
        withPhone.map((c, i) => [c.id, i])
      );

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      // Read the SSE stream; update each contact as its result arrives
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json: unknown = JSON.parse(line.slice(6));
          const event = json as {
            done?: boolean;
            clientId?: string;
            ok?: boolean;
            error?: string;
          };

          if (event.done) {
            // Stream finished — transition to done step
            setStep('done');
            return;
          }

          if (event.clientId !== undefined) {
            const idx = idIndex.get(event.clientId);
            if (idx !== undefined) {
              setAutoContacts(prev =>
                prev.map((item, i) =>
                  i === idx
                    ? { ...item, status: event.ok ? 'sent' : 'failed', error: event.error }
                    : item
                )
              );
            }
          }
        }
      }

      setStep('done');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Error de red al conectar con el servidor';
      setAutoGlobalError(errMsg);
      setStep('done');
    }
  };

  const current = queue[cursor];
  const waLink = current
    ? buildWaLink(current.customer.phone!, fillTemplate(message, current.customer))
    : '';

  const markAndAdvance = (status: SendStatus) => {
    setQueue(q => q.map((item, i) => i === cursor ? { ...item, status } : item));
    if (cursor + 1 >= queue.length) {
      setStep('done');
    } else {
      setCursor(c => c + 1);
    }
  };

  const sentCount = queue.filter(q => q.status === 'sent').length;
  const skippedCount = queue.filter(q => q.status === 'skipped').length;
  const progress = queue.length > 0 ? Math.round(((sentCount + skippedCount) / queue.length) * 100) : 0;

  const handleClose = () => {
    setStep('compose');
    setMessage('Hola {nombre}, te escribimos desde nuestro negocio. 👋');
    setScope('active');
    setQueue([]);
    setCursor(0);
    setAutoMode(false);
    setAutoContacts([]);
    setAutoGlobalError(null);
    onClose();
  };

  const autoSentCount = autoContacts.filter(c => c.status === 'sent').length;
  const autoFailedList = autoContacts.filter(c => c.status === 'failed');
  const autoPendingCount = autoContacts.filter(c => c.status === 'pending' || c.status === 'sending').length;
  const autoProgress = autoContacts.length > 0
    ? Math.round(((autoSentCount + autoFailedList.length) / autoContacts.length) * 100)
    : 0;

  const scopeOptions: { key: RecipientScope; label: string; count: number }[] = [
    {
      key: 'active',
      label: 'Todos los activos',
      count: allCustomers.filter(c => c.is_active).length,
    },
    {
      key: 'filter',
      label: 'Filtro actual',
      count: filteredCustomers.length,
    },
    {
      key: 'selected',
      label: `Seleccionados (${selectedIds.size})`,
      count: selectedIds.size,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-600" />
            {step === 'compose' && 'Nueva difusión'}
            {step === 'send' && `Enviando · ${sentCount + skippedCount} de ${queue.length}`}
            {step === 'auto_sending' && 'Enviando automáticamente…'}
            {step === 'done' && 'Difusión completada'}
          </DialogTitle>
        </DialogHeader>

        {/* ── STEP 1: COMPOSE ── */}
        {step === 'compose' && (
          <div className="space-y-5">
            {/* Message */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Mensaje</label>
              <Textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={4}
                placeholder="Escribe tu mensaje aquí..."
                className="resize-none"
                data-testid="textarea-difusion-message"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground">Insertar:</span>
                {VARIABLES.map(v => (
                  <button
                    key={v.token}
                    onClick={() => insertVariable(v.token)}
                    className="text-xs px-2 py-0.5 rounded-full border border-border bg-muted/50 hover:bg-muted transition-colors font-mono"
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>

            {/* Live preview */}
            {preview && message.trim() && (
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Vista previa — {preview.name}</p>
                <p className="text-sm whitespace-pre-wrap">{fillTemplate(message, preview)}</p>
              </div>
            )}

            {/* Recipients scope */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Destinatarios</label>
              <div className="grid grid-cols-3 gap-2">
                {scopeOptions.map(opt => (
                  <button
                    key={opt.key}
                    disabled={opt.key === 'selected' && selectedIds.size === 0}
                    onClick={() => setScope(opt.key)}
                    className={cn(
                      'rounded-lg border px-3 py-2.5 text-left transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed',
                      scope === opt.key
                        ? 'border-foreground bg-foreground/5'
                        : 'border-border hover:border-foreground/40'
                    )}
                  >
                    <span className="block font-medium text-xs">{opt.label}</span>
                    <span className="text-lg font-bold leading-tight">{opt.count}</span>
                    <span className="text-xs text-muted-foreground block">clientes</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Warning: no phone */}
            {withoutPhone.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <p>
                  <span className="font-medium">{withoutPhone.length} cliente{withoutPhone.length !== 1 ? 's' : ''}</span> no tiene
                  {withoutPhone.length !== 1 ? 'n' : ''} número de teléfono y ser
                  {withoutPhone.length !== 1 ? 'án' : 'á'} omitido{withoutPhone.length !== 1 ? 's' : ''}.
                </p>
              </div>
            )}

            {/* ── Auto-mode section ── */}
            <div className="rounded-xl border border-border overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                <div className="flex items-center gap-2">
                  <Zap className={cn('w-4 h-4', isPro ? 'text-violet-500' : 'text-muted-foreground')} />
                  <span className="text-sm font-medium">Envío automático</span>
                  {!isPro && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                      Plan Pro
                    </span>
                  )}
                </div>
                {isPro && hasWaCreds && (
                  <button
                    type="button"
                    onClick={() => setAutoMode(v => !v)}
                    className={cn(
                      'relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none',
                      autoMode ? 'bg-violet-600' : 'bg-muted-foreground/30'
                    )}
                    data-testid="toggle-auto-mode"
                    aria-label="Activar envío automático"
                  >
                    <span
                      className={cn(
                        'inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform',
                        autoMode ? 'translate-x-[18px]' : 'translate-x-0.5'
                      )}
                    />
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="px-4 py-3 border-t border-border">
                {!isPro ? (
                  <p className="text-xs text-muted-foreground">
                    Con el Plan Pro puedes enviar mensajes directamente vía la API de WhatsApp Business, sin intervención manual.
                  </p>
                ) : !hasWaCreds ? (
                  <div className="flex items-start gap-2">
                    <Settings className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Configura tu WhatsApp Business API para activar el envío automático.</p>
                      <button
                        type="button"
                        onClick={() => { handleClose(); navigate('/admin/settings'); }}
                        className="text-xs text-blue-600 dark:text-blue-400 underline underline-offset-2 mt-0.5 hover:opacity-80"
                        data-testid="link-go-to-settings-wa"
                      >
                        Ir a Configuración →
                      </button>
                    </div>
                  </div>
                ) : autoMode ? (
                  <p className="text-xs text-violet-700 dark:text-violet-400 font-medium">
                    Modo automático activado — los mensajes se enviarán directamente via API al hacer clic en "Enviar ahora".
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Activa el toggle para enviar todos los mensajes automáticamente en un clic via WhatsApp Business API.
                  </p>
                )}
              </div>
            </div>

            {/* Manual mode info (only when auto is off) */}
            {!autoMode && withPhone.length > 0 && (
              <div className="flex items-start gap-2 text-sm text-muted-foreground rounded-lg bg-muted/40 border border-border px-3 py-2.5">
                <Users className="w-4 h-4 flex-shrink-0 text-green-600 mt-0.5" />
                <span>
                  La app abrirá WhatsApp uno por uno para los <strong className="text-foreground">{withPhone.length} contacto{withPhone.length !== 1 ? 's' : ''}</strong> con teléfono.
                  {' '}<strong className="text-foreground">Tú debes presionar Enviar en WhatsApp</strong> para cada mensaje — la app no los envía automáticamente.
                </span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button
                onClick={startSend}
                disabled={!withPhone.length || !message.trim()}
                className={cn('gap-1.5', autoMode && isPro && hasWaCreds ? 'bg-violet-600 hover:bg-violet-700 text-white' : '')}
                data-testid="button-start-difusion"
              >
                {autoMode && isPro && hasWaCreds ? (
                  <><Zap className="w-3.5 h-3.5" /> Enviar ahora · {withPhone.length} mensajes</>
                ) : (
                  <><Send className="w-3.5 h-3.5" /> Comenzar · {withPhone.length} mensajes</>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP AUTO_SENDING ── */}
        {step === 'auto_sending' && (
          <div className="space-y-4">
            {/* Header progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-600" />
                  Enviando automáticamente…
                </span>
                <span className="text-muted-foreground text-xs">
                  {autoSentCount + autoFailedList.length} / {autoContacts.length}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-violet-500 rounded-full transition-all duration-300"
                  style={{ width: `${autoProgress}%` }}
                />
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="text-green-600 font-medium">✓ {autoSentCount} enviado{autoSentCount !== 1 ? 's' : ''}</span>
                {autoFailedList.length > 0 && <span className="text-red-600">✗ {autoFailedList.length} fallido{autoFailedList.length !== 1 ? 's' : ''}</span>}
                {autoPendingCount > 0 && <span>{autoPendingCount} restante{autoPendingCount !== 1 ? 's' : ''}</span>}
              </div>
            </div>

            {/* Per-contact list */}
            <div className="rounded-lg border border-border overflow-hidden max-h-72 overflow-y-auto">
              {autoContacts.map((item) => (
                <div key={item.customer.id} className={cn(
                  'flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-0 text-sm',
                  item.status === 'sending' && 'bg-violet-50 dark:bg-violet-900/10'
                )}>
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {item.status === 'pending' && <span className="w-2 h-2 rounded-full bg-muted-foreground/30" />}
                    {item.status === 'sending' && <Loader2 className="w-4 h-4 animate-spin text-violet-500" />}
                    {item.status === 'sent' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    {item.status === 'failed' && <XCircle className="w-4 h-4 text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block" translate="no">{item.customer.name}</span>
                    {item.status === 'failed' && item.error && (
                      <span className="text-xs text-red-600 dark:text-red-400">{item.error}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{item.customer.phone}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-center text-muted-foreground">No cierres este diálogo mientras se procesan los envíos.</p>
          </div>
        )}

        {/* ── STEP 2: MANUAL SEND QUEUE ── */}
        {step === 'send' && current && (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800 px-3 py-2.5">
              <p className="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-1.5">¿Cómo funciona?</p>
              <ol className="space-y-1">
                {[
                  'Haz clic en "Abrir en WhatsApp" — se abrirá la conversación con el mensaje listo.',
                  'Presiona Enviar dentro de WhatsApp.',
                  'Vuelve aquí y haz clic en "Enviado ✓" para continuar con el siguiente.',
                ].map((s, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-blue-700 dark:text-blue-300">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 flex items-center justify-center font-bold text-[10px] mt-0.5">{i + 1}</span>
                    {s}
                  </li>
                ))}
              </ol>
            </div>

            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progreso</span>
                <span>{sentCount + skippedCount} / {queue.length}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span className="text-green-600 font-medium">✓ {sentCount} enviado{sentCount !== 1 ? 's' : ''}</span>
                {skippedCount > 0 && <span>↷ {skippedCount} saltado{skippedCount !== 1 ? 's' : ''}</span>}
                <span>{queue.length - sentCount - skippedCount} pendiente{queue.length - sentCount - skippedCount !== 1 ? 's' : ''}</span>
              </div>
            </div>

            {/* Customer card */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-base" translate="no">{current.customer.name}</p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" />
                    {current.customer.phone}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-2.5 py-1">
                  {cursor + 1} / {queue.length}
                </span>
              </div>

              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2.5">
                <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1 flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Mensaje personalizado
                </p>
                <p className="text-sm text-green-900 dark:text-green-200 whitespace-pre-wrap">
                  {fillTemplate(message, current.customer)}
                </p>
              </div>

              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full rounded-lg bg-[#25D366] hover:bg-[#20bc5a] text-white font-semibold py-3 transition-colors text-sm"
                data-testid="link-open-whatsapp"
              >
                <ExternalLink className="w-4 h-4" />
                Paso 1 — Abrir en WhatsApp y enviar
              </a>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-center text-muted-foreground">
                Paso 3 — ¿Ya enviaste el mensaje en WhatsApp?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => markAndAdvance('skipped')}
                  data-testid="button-skip-customer"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  Saltar este
                </Button>
                <Button
                  className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => markAndAdvance('sent')}
                  data-testid="button-mark-sent"
                >
                  <Check className="w-3.5 h-3.5" />
                  Sí, enviado ✓
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => setCursor(c => Math.max(0, c - 1))}
                disabled={cursor === 0}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => setStep('done')}
              >
                Terminar ahora
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => setCursor(c => Math.min(queue.length - 1, c + 1))}
                disabled={cursor >= queue.length - 1}
              >
                Siguiente
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* ── STEP 3: DONE ── */}
        {step === 'done' && (
          <div className="space-y-4 py-2">
            {/* Auto mode result */}
            {autoContacts.length > 0 || autoGlobalError ? (
              <>
                {autoGlobalError ? (
                  <div className="flex flex-col items-center text-center gap-3 py-4">
                    <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                      <XCircle className="w-8 h-8 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xl font-bold">Error en el envío automático</p>
                      <p className="text-sm text-muted-foreground mt-1">{autoGlobalError}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-col items-center text-center gap-3 py-4">
                      <div className={cn(
                        'w-16 h-16 rounded-full flex items-center justify-center',
                        autoFailedList.length === 0
                          ? 'bg-green-100 dark:bg-green-900/30'
                          : 'bg-amber-100 dark:bg-amber-900/30'
                      )}>
                        {autoFailedList.length === 0
                          ? <CheckCircle2 className="w-8 h-8 text-green-600" />
                          : <Zap className="w-8 h-8 text-amber-500" />
                        }
                      </div>
                      <div>
                        <p className="text-xl font-bold">¡Difusión automática completada!</p>
                        <p className="text-muted-foreground text-sm mt-1">Resumen del envío via WhatsApp Business API</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-4">
                        <p className="text-3xl font-bold text-green-700 dark:text-green-400">{autoSentCount}</p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">Enviado{autoSentCount !== 1 ? 's' : ''} exitosamente</p>
                      </div>
                      <div className={cn(
                        'rounded-xl border px-3 py-4',
                        autoFailedList.length > 0
                          ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                          : 'bg-muted/50 border-border'
                      )}>
                        <p className={cn('text-3xl font-bold', autoFailedList.length > 0 ? 'text-red-700 dark:text-red-400' : '')}>
                          {autoFailedList.length}
                        </p>
                        <p className={cn('text-xs mt-1', autoFailedList.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                          Fallido{autoFailedList.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    {autoFailedList.length > 0 && (
                      <div className="rounded-lg border border-red-200 dark:border-red-800 overflow-hidden">
                        <div className="bg-red-50 dark:bg-red-900/20 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-1.5">
                          <XCircle className="w-3.5 h-3.5" /> Envíos fallidos
                        </div>
                        <div className="divide-y divide-border max-h-40 overflow-y-auto">
                          {autoFailedList.map((item, i) => (
                            <div key={i} className="px-3 py-2 text-sm">
                              <div className="flex items-center justify-between">
                                <span className="font-medium" translate="no">{item.customer.name}</span>
                                <span className="text-xs text-muted-foreground">{item.customer.phone}</span>
                              </div>
                              <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{item.error}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {autoFailedList.length > 0 && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                        <strong>Nota:</strong> Meta requiere que el contacto haya iniciado una conversación contigo en las últimas 24 horas para mensajes sin plantilla. Para campañas de marketing en frío, usa plantillas aprobadas por Meta.
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              /* Manual mode done */
              <>
                <div className="flex flex-col items-center text-center gap-3 py-4">
                  <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                    <Check className="w-8 h-8 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold">¡Difusión completada!</p>
                    <p className="text-muted-foreground text-sm mt-1">Resumen de la sesión de envío</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-4">
                    <p className="text-3xl font-bold text-green-700 dark:text-green-400">{sentCount}</p>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">Enviado{sentCount !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 border border-border px-3 py-4">
                    <p className="text-3xl font-bold">{skippedCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">Saltado{skippedCount !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="rounded-xl bg-muted/50 border border-border px-3 py-4">
                    <p className="text-3xl font-bold">{queue.length - sentCount - skippedCount}</p>
                    <p className="text-xs text-muted-foreground mt-1">Pendiente{queue.length - sentCount - skippedCount !== 1 ? 's' : ''}</p>
                  </div>
                </div>

                {queue.filter(q => q.status === 'skipped').length > 0 && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <div className="bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                      Contactos saltados
                    </div>
                    <div className="divide-y divide-border max-h-32 overflow-y-auto">
                      {queue.filter(q => q.status === 'skipped').map(item => (
                        <div key={item.customer.id} className="px-3 py-2 text-sm flex items-center justify-between">
                          <span translate="no">{item.customer.name}</span>
                          <a
                            href={buildWaLink(item.customer.phone!, fillTemplate(message, item.customer))}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-green-600 underline underline-offset-2 hover:opacity-80 flex items-center gap-0.5"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Abrir
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => { setStep('compose'); setCursor(0); setQueue([]); setAutoContacts([]); setAutoGlobalError(null); }}
                className="gap-1.5"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Nueva difusión
              </Button>
              <Button onClick={handleClose}>Cerrar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
