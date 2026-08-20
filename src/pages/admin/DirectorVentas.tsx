import { useState, useRef, useCallback, useEffect } from 'react';
import { Bot, Mic, MicOff, Send, Plus, Volume2, VolumeX, Loader2, TrendingUp, ChevronRight, Trash2, MessageSquare, Info, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Session {
  id: string;
  title: string | null;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return `Hoy ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diffDays === 1) return `Ayer`;
  if (diffDays < 7) return d.toLocaleDateString('es-CO', { weekday: 'long' });
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

export default function DirectorVentas() {
  const { business } = useBusiness();
  const { session: authSession } = useAuth();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [micError, setMicError] = useState('');
  const [contextOpen, setContextOpen] = useState(false);

  const recognRef = useRef<SpeechRecognition | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions
  const loadSessions = useCallback(async () => {
    if (!business?.id) return;
    setSessionsLoading(true);
    const { data, error } = await supabase
      .from('advisor_sessions')
      .select('id, title, messages, created_at, updated_at')
      .eq('business_id', business.id)
      .order('updated_at', { ascending: false })
      .limit(30);
    if (!error && data) {
      setSessions(data as Session[]);
    }
    setSessionsLoading(false);
  }, [business?.id]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Voice output
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-CO';
    utterance.rate = 1.05;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel();
  }, []);

  // Send message
  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || !business?.id || loading) return;
    const jwt = authSession?.access_token;
    if (!jwt) { toast.error('Sesión expirada. Vuelve a iniciar sesión.'); return; }

    const q = question.trim();
    const optimisticMsg: Message = { role: 'user', content: q };
    const newMessages = [...messages, optimisticMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/sales-advisor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          business_id: business.id,
          session_id: activeSessionId ?? undefined,
          question: q,
          history: messages.slice(-12),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Error ${res.status}`);
      }

      const data = await res.json() as { answer: string; session_id: string };
      const assistantMsg: Message = { role: 'assistant', content: data.answer };
      setMessages([...newMessages, assistantMsg]);

      if (!activeSessionId && data.session_id) {
        setActiveSessionId(data.session_id);
      }

      speak(data.answer);
      loadSessions();
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Error desconocido';
      toast.error(`No pude conectarme al Director de Ventas: ${errMsg}`);
      setMessages(newMessages); // keep user message
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }, [business?.id, authSession?.access_token, loading, messages, activeSessionId, speak, loadSessions]);

  // Load session
  const openSession = useCallback((session: Session) => {
    stopSpeaking();
    setActiveSessionId(session.id);
    setMessages(Array.isArray(session.messages) ? session.messages as Message[] : []);
    setInput('');
  }, [stopSpeaking]);

  // New session
  const newSession = useCallback(() => {
    stopSpeaking();
    setActiveSessionId(null);
    setMessages([]);
    setInput('');
  }, [stopSpeaking]);

  // Delete session
  const deleteSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('advisor_sessions').delete().eq('id', id);
    if (activeSessionId === id) newSession();
    setSessions(prev => prev.filter(s => s.id !== id));
    toast.success('Sesión eliminada');
  }, [activeSessionId, newSession]);

  // Mic
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || (window as Window & typeof globalThis & { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) { setMicError('Tu navegador no soporta reconocimiento de voz.'); return; }

    if (recognRef.current) { recognRef.current.abort(); recognRef.current = null; }
    setMicError('');
    const recog = new SR();
    recog.lang = 'es-CO';
    recog.continuous = false;
    recog.interimResults = false;
    recognRef.current = recog;

    recog.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ').trim();
      if (transcript) { sendMessage(transcript); }
    };
    recog.onerror = (e) => {
      if (e.error === 'not-allowed') setMicError('Permite el acceso al micrófono en tu navegador.');
      else if (e.error === 'no-speech') setMicError('No se detectó voz. Intenta de nuevo.');
      setListening(false);
      recognRef.current = null;
    };
    recog.onend = () => { setListening(false); recognRef.current = null; };
    recog.start();
    setListening(true);
  }, [sendMessage]);

  const stopListening = useCallback(() => {
    recognRef.current?.abort();
    recognRef.current = null;
    setListening(false);
  }, []);

  const handleMic = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full bg-background">
      {/* ── Session Sidebar ──────────────────────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-sidebar">
        <div className="p-3 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
            onClick={newSession}
            data-testid="btn-nueva-consulta"
          >
            <Plus className="w-4 h-4" />
            Nueva consulta
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-8 px-3">
              <MessageSquare className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">Aún no hay consultas</p>
            </div>
          ) : (
            sessions.map(s => (
              <button
                key={s.id}
                onClick={() => openSession(s)}
                data-testid={`btn-session-${s.id}`}
                className={cn(
                  'w-full text-left px-2.5 py-2 rounded-lg text-xs transition-colors group flex items-start gap-2',
                  activeSessionId === s.id
                    ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
                )}
              >
                <ChevronRight className={cn(
                  'w-3 h-3 mt-0.5 flex-shrink-0 transition-opacity',
                  activeSessionId === s.id ? 'opacity-100 text-emerald-600' : 'opacity-0 group-hover:opacity-50'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-foreground/80">
                    {s.title ?? 'Consulta sin título'}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatSessionDate(s.updated_at)}
                  </p>
                </div>
                <button
                  onClick={(e) => deleteSession(s.id, e)}
                  data-testid={`btn-delete-session-${s.id}`}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-destructive transition-opacity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Chat Area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="border-b border-border px-6 py-3 flex items-center gap-3 bg-background/80 backdrop-blur-sm">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-sm">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-foreground">Director de Ventas IA</h1>
            <p className="text-xs text-muted-foreground">
              {business?.name ? `Experto en ventas de ${business.name}` : 'Cargando...'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setContextOpen(o => !o)}
              data-testid="btn-toggle-context"
              title="Ver qué datos tiene el Director de Ventas"
              className={cn(
                'p-1.5 rounded-lg transition-colors flex items-center gap-1 text-xs',
                contextOpen
                  ? 'text-emerald-700 bg-emerald-50'
                  : 'text-muted-foreground hover:bg-accent'
              )}
            >
              <Info className="w-4 h-4" />
              {!contextOpen && <ChevronDown className="w-3 h-3" />}
              {contextOpen && <ChevronDown className="w-3 h-3 rotate-180" />}
            </button>
            <button
              onClick={() => { setVoiceEnabled(v => !v); if (voiceEnabled) stopSpeaking(); }}
              data-testid="btn-toggle-voice"
              title={voiceEnabled ? 'Silenciar respuestas' : 'Activar voz'}
              className={cn(
                'p-1.5 rounded-lg transition-colors',
                voiceEnabled
                  ? 'text-emerald-600 hover:bg-emerald-50'
                  : 'text-muted-foreground hover:bg-accent'
              )}
            >
              {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Context panel */}
        {contextOpen && (
          <div className="border-b border-border bg-emerald-50/60 dark:bg-emerald-950/20 px-6 py-3">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-300 mb-2">
              El Director de Ventas conoce automáticamente:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>✅ Tu menú completo (categorías, productos y precios)</span>
              <span>✅ Métricas de pedidos de los últimos 30 días</span>
              <span>✅ Base de conocimiento (FAQs, horarios, políticas)</span>
              <span>✅ Clientes VIP y clientes inactivos</span>
              <span>✅ Ingresos estimados y ticket promedio</span>
              <span>✅ Historial de conversaciones anteriores contigo</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Para actualizar la base de conocimiento ve a{' '}
              <a href="/admin/agente-ia" className="underline text-emerald-700">Agente IA → Configuración</a>.
            </p>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full text-center max-w-sm mx-auto gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <Bot className="w-7 h-7 text-emerald-600" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground mb-1">Director de Ventas IA</h2>
                <p className="text-sm text-muted-foreground">
                  Tu experto en ventas y marketing para {business?.name ?? 'tu negocio'}.
                  Conoce tu menú, tus clientes y tus métricas reales.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 w-full text-left mt-2">
                {[
                  '¿Cómo puedo atraer más clientes los lunes?',
                  '¿Qué producto debería promocionar esta semana?',
                  'Crea un mensaje de WhatsApp para mis clientes VIP',
                  '¿Cómo recupero un cliente que no compra hace 3 semanas?',
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    data-testid={`btn-prompt-${prompt.slice(0, 20).replace(/\s/g, '-')}`}
                    className="text-left px-3 py-2 rounded-lg border border-border text-xs text-foreground hover:bg-accent hover:border-emerald-200 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                data-testid={`msg-${msg.role}-${i}`}
                className={cn('flex gap-3', msg.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                    <TrendingUp className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div
                  className={cn(
                    'max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-emerald-500 text-white rounded-tr-sm'
                      : 'bg-muted text-foreground rounded-tl-sm'
                  )}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-semibold text-muted-foreground">
                    Tú
                  </div>
                )}
              </div>
            ))
          )}

          {loading && (
            <div className="flex gap-3 justify-start">
              <div className="w-7 h-7 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                <TrendingUp className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="bg-muted rounded-xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                <span className="text-sm text-muted-foreground">Analizando tu negocio...</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-border p-4 bg-background">
          {micError && (
            <p className="text-xs text-destructive mb-2 text-center">{micError}</p>
          )}
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta algo sobre tu negocio, clientes o ventas…"
              disabled={loading || listening}
              data-testid="input-director-question"
              className="min-h-[44px] max-h-32 resize-none text-sm flex-1"
              rows={1}
            />
            <button
              onClick={handleMic}
              data-testid="btn-mic-director"
              disabled={loading}
              title={listening ? 'Detener grabación' : 'Hablar con el Director'}
              className={cn(
                'h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors border',
                listening
                  ? 'bg-red-500 text-white border-red-500 animate-pulse'
                  : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <Button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              data-testid="btn-send-director"
              className="h-10 w-10 p-0 bg-emerald-500 hover:bg-emerald-600 text-white flex-shrink-0"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            El Director usa tus datos reales de menú, clientes y pedidos — las respuestas son específicas a tu negocio.
          </p>
        </div>
      </div>
    </div>
  );
}
