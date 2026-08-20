import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Mic, MicOff, Volume2, VolumeX, Loader2, Bot, RotateCcw, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

interface OrderData { cliente: string; telefono?: string; items: string; entrega: string; direccion: string; notas: string }
interface BookingData { servicio: string; servicio_id?: string; fecha: string; hora: string; personas: number; cliente: string; telefono?: string; notas: string; precio?: number }
interface Message { role: 'user' | 'assistant'; content: string; orderData?: OrderData; bookingData?: BookingData }
interface OrderState { cliente?: string; telefono?: string; items?: string; entrega?: string; direccion?: string; paso?: string }

interface MenuProduct { name: string; price: number; description?: string | null; categoryName: string }
interface MenuData { products: MenuProduct[] }

interface Props {
  slug: string;
  aiEnabled: boolean;
  brandColor?: string;
  menuData?: MenuData;
  voiceLang?: string;
  currency?: string;
  waNumber?: string;
  businessName?: string;
  businessId?: string;
}

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

function SparklesColored({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Main large star — yellow */}
      <path
        d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
        stroke="#FBBF24"
        fill="#FBBF2440"
      />
      {/* Top-right small cross — pink */}
      <path d="M20 3v4" stroke="#F472B6" strokeWidth="2.2" />
      <path d="M22 5h-4"  stroke="#F472B6" strokeWidth="2.2" />
      {/* Bottom-left small cross — cyan */}
      <path d="M4 17v2"  stroke="#38BDF8" strokeWidth="2.2" />
      <path d="M5 18H3"  stroke="#38BDF8" strokeWidth="2.2" />
    </svg>
  );
}

function cleanForSpeech(text: string, currency = 'COP'): string {
  const currencyWord = currency === 'USD' ? 'dólares' : currency === 'EUR' ? 'euros' : 'pesos';
  return text
    // Remove emojis (Extended Pictographic + common symbol blocks)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{20D0}-\u{20FF}]/gu, '')
    // Remove markdown bold/italic (**text** or *text*)
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    // Remove markdown headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bullet/dash at line start
    .replace(/^[-•]\s+/gm, '')
    // Convert $2.300.000 or $22.000 → "2300000 pesos" (strip dots so TTS reads naturally)
    .replace(/\$(\d[\d.]*)/g, (_, num) => `${num.replace(/\./g, '')} ${currencyWord}`)
    // Also handle bare $ sign left over
    .replace(/\$/g, '')
    // Collapse newlines into natural pauses
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseOrderTag(raw: string): { clean: string; orderData?: OrderData } {
  const match = raw.match(/\[ORDER:\s*(\{[\s\S]*?\})\s*\]/i);
  if (!match) return { clean: raw };
  try {
    const orderData = JSON.parse(match[1]) as OrderData;
    const clean = raw.replace(match[0], '').trim();
    return { clean, orderData };
  } catch {
    const clean = raw.replace(match[0], '').trim();
    return { clean };
  }
}

function parseBookingTag(raw: string): { clean: string; bookingData?: BookingData } {
  const match = raw.match(/\[BOOKING:\s*(\{[\s\S]*?\})\s*\]/i);
  if (!match) return { clean: raw };
  try {
    const bookingData = JSON.parse(match[1]) as BookingData;
    const clean = raw.replace(match[0], '').trim();
    return { clean, bookingData };
  } catch {
    const clean = raw.replace(match[0], '').trim();
    return { clean };
  }
}

function buildWaBookingMessage(businessName: string, bd: BookingData): string {
  let msg = `📅 *Reserva — ${businessName}*\n\n`;
  if (bd.cliente) msg += `👤 *Cliente:* ${bd.cliente}\n`;
  if (bd.telefono) msg += `📱 *WhatsApp:* ${bd.telefono}\n`;
  msg += `💆 *Servicio:* ${bd.servicio}\n`;
  if (bd.fecha) msg += `📆 *Fecha:* ${bd.fecha}\n`;
  if (bd.hora) msg += `🕐 *Hora:* ${bd.hora}\n`;
  if (bd.personas > 1) msg += `👥 *Personas:* ${bd.personas}\n`;
  if (bd.notas) msg += `📝 *Notas:* ${bd.notas}\n`;
  msg += `\n_Reserva realizada por el asistente IA_`;
  return encodeURIComponent(msg);
}

function parseStateTag(raw: string): { clean: string; state?: OrderState } {
  const match = raw.match(/\[STATE:\s*(\{[\s\S]*?\})\s*\]/i);
  if (!match) return { clean: raw };
  try {
    const state = JSON.parse(match[1]) as OrderState;
    const clean = raw.replace(match[0], '').trim();
    return { clean, state };
  } catch {
    const clean = raw.replace(match[0], '').trim();
    return { clean };
  }
}

function mergeOrderState(prev: OrderState, next?: OrderState): OrderState {
  if (!next) return prev;
  const merged: OrderState = { ...prev };
  for (const key of Object.keys(next) as (keyof OrderState)[]) {
    const value = next[key];
    if (value && String(value).trim()) merged[key] = value;
  }
  return merged;
}

function buildWaOrderMessage(businessName: string, od: OrderData): string {
  let msg = `🛒 *Pedido — ${businessName}*\n\n`;
  if (od.cliente) msg += `👤 *Cliente:* ${od.cliente}\n`;
  if (od.telefono) msg += `📱 *WhatsApp:* ${od.telefono}\n`;
  if (od.entrega) msg += `📦 *Entrega:* ${od.entrega}\n`;
  if (od.direccion) msg += `📍 *Dirección:* ${od.direccion}\n`;
  msg += `\n*Productos:*\n${od.items}\n`;
  if (od.notas) msg += `\n📝 *Notas:* ${od.notas}`;
  msg += `\n\n_Pedido recibido por el asistente IA del menú_`;
  return encodeURIComponent(msg);
}

function getWaUrl(phone: string, encodedMsg: string): string {
  let clean = phone.replace(/\D/g, '');
  if (clean.length === 10 && clean.startsWith('3')) clean = `57${clean}`;
  return `https://wa.me/${clean}?text=${encodedMsg}`;
}

export default function MenuAIAssistant({ slug, aiEnabled, brandColor = '#f97316', menuData, voiceLang = 'es-CO', currency = 'COP', waNumber, businessName = '', businessId }: Props) {
  const [open, setOpen]           = useState(false);
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState('');
  const [loading, setLoading]     = useState(false);
  const [muted, setMuted]         = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking]   = useState(false);
  const [micError, setMicError]   = useState('');
  const bottomRef     = useRef<HTMLDivElement>(null);
  const inputRef      = useRef<HTMLTextAreaElement>(null);
  const recognRef     = useRef<SpeechRecognition | null>(null);
  const savedRef      = useRef(false);
  const orderStateRef = useRef<OrderState>({});
  // Keep a ref so sendAIOrder / saveConversation always read the latest businessId
  // regardless of stale closures in sendQuestion.
  const businessIdRef = useRef(businessId);
  useEffect(() => { businessIdRef.current = businessId; }, [businessId]);

  const hasVoiceInput  = typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const hasSpeechSynth = typeof window !== 'undefined' && !!window.speechSynthesis;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  useEffect(() => {
    return () => {
      if (hasSpeechSynth) window.speechSynthesis.cancel();
      recognRef.current?.abort();
    };
  }, []);

  const speak = useCallback((text: string) => {
    if (!hasSpeechSynth || muted) return;
    window.speechSynthesis.cancel();
    const clean = cleanForSpeech(text, currency);
    if (!clean) return;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang  = voiceLang;
    utter.rate  = 0.95;
    utter.pitch = 1.05;

    // Prefer a natural-sounding voice matching the configured language
    const voices = window.speechSynthesis.getVoices();
    const langPrefix = voiceLang.split('-')[0]; // e.g. 'es' or 'en'
    const preferred =
      voices.find(v => v.lang === voiceLang && (v.name.includes('Google') || v.name.includes('Microsoft'))) ??
      voices.find(v => v.lang === voiceLang) ??
      voices.find(v => v.lang.startsWith(langPrefix) && (v.name.includes('Google') || v.name.includes('Microsoft'))) ??
      voices.find(v => v.lang.startsWith(langPrefix));
    if (preferred) utter.voice = preferred;

    utter.onstart = () => setSpeaking(true);
    utter.onend   = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }, [hasSpeechSynth, muted, voiceLang, currency]);

  const stopSpeaking = () => {
    if (hasSpeechSynth) window.speechSynthesis.cancel();
    setSpeaking(false);
  };

  const toggleMute = () => {
    if (!muted) stopSpeaking();
    setMuted(m => !m);
  };

  const sendQuestion = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setInput('');

    // Detect "humano" keyword → show human handoff message instantly
    if (/\bhumano\b/i.test(q)) {
      setMessages(prev => [
        ...prev,
        { role: 'user', content: q },
        {
          role: 'assistant',
          content: waNumber
            ? `Para hablar con una persona de nuestro equipo, escríbenos directamente por WhatsApp. ¡Con gusto te atendemos! 😊`
            : `Para hablar con una persona de nuestro equipo, usa el botón de WhatsApp del negocio.`,
          orderData: waNumber ? {
            cliente: '',
            telefono: waNumber,
            items: 'Atención humana solicitada',
            entrega: '',
            direccion: '',
            notas: 'El cliente solicitó hablar con una persona',
          } as OrderData : undefined,
        },
      ]);
      return;
    }

    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const history = messages.slice(-16).map(m => ({ role: m.role, content: m.content }));
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res  = await fetch(`${SUPABASE_URL}/functions/v1/menu-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug, question: q, history,
          orderState: orderStateRef.current,
          ...(menuData ? { menuData } : {}),
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json() as { answer?: string; error?: string };

      if (!res.ok || !data.answer) {
        // Server-side failure — restore the question so the user can retry with one tap
        setInput(q);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '😅 Tuve un pequeño problema al responder. Tu pregunta ya está lista en el campo de texto — presiona enviar para intentarlo de nuevo.',
        }]);
        return;
      }

      const { clean: afterOrder, orderData } = parseOrderTag(data.answer);
      const { clean: afterBooking, bookingData } = parseBookingTag(afterOrder);
      const { clean, state } = parseStateTag(afterBooking);
      orderStateRef.current = mergeOrderState(orderStateRef.current, state);
      if (orderData) {
        orderStateRef.current = mergeOrderState(orderStateRef.current, orderData as OrderState);
      }
      // For bookings, attempt RPC first; only attach bookingData to message if save succeeded
      let savedBookingData: BookingData | undefined;
      if (bookingData) {
        const saved = await sendAIBooking(bookingData);
        if (saved) {
          savedBookingData = bookingData;
        } else {
          // Booking failed to save — append a warning to the message
          const dateOk = !!bookingData.fecha?.match(/^\d{4}-\d{2}-\d{2}$/);
          const timeOk = !!bookingData.hora?.match(/^\d{2}:\d{2}/);
          const warning = (!dateOk || !timeOk)
            ? '\n\n⚠️ No pude guardar la reserva automáticamente — por favor confirma directamente por WhatsApp con el negocio.'
            : '\n\n⚠️ Hubo un problema al guardar tu reserva. Por favor contacta al negocio directamente por WhatsApp.';
          setMessages(prev => [...prev, { role: 'assistant', content: clean + warning, orderData, bookingData: undefined }]);
          speak(clean);
          if (orderData) sendAIOrder(orderData);
          return;
        }
      }
      setMessages(prev => [...prev, { role: 'assistant', content: clean, orderData, bookingData: savedBookingData }]);
      speak(clean);
      if (orderData) sendAIOrder(orderData);
    } catch (err) {
      // Network error or client-side timeout — restore question for easy retry
      setInput(q);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: isTimeout
          ? '⏱️ La red tardó demasiado. Tu pregunta ya está lista — toca enviar para reintentar.'
          : '📡 Sin conexión por un momento. Tu pregunta ya está lista — toca enviar para reintentar.',
      }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, slug, speak, waNumber]);

  const stopListening = useCallback(() => {
    recognRef.current?.stop();
    recognRef.current = null;
    setListening(false);
  }, []);

  const resetChat = useCallback(() => {
    stopSpeaking();
    stopListening();
    setMessages([]);
    setInput('');
    savedRef.current = false;
    orderStateRef.current = {};
  }, [stopSpeaking, stopListening]);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    // Clean up any previous session
    if (recognRef.current) {
      recognRef.current.abort();
      recognRef.current = null;
    }

    setMicError('');
    const recog = new SR();
    recog.lang            = 'es-CO';
    recog.continuous      = true;   // Stay open until we get a result
    recog.interimResults  = false;
    recognRef.current     = recog;

    let gotResult = false;

    recog.onresult = (e) => {
      if (gotResult) return;
      const transcript = Array.from(e.results)
        .map(r => r[0].transcript)
        .join(' ')
        .trim();
      if (transcript) {
        gotResult = true;
        recog.stop();
        sendQuestion(transcript);
      }
    };

    recog.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'permission-denied') {
        setMicError('Permite el acceso al micrófono en tu navegador.');
      } else if (e.error === 'no-speech') {
        setMicError('No se detectó voz. Intenta de nuevo.');
      }
      setListening(false);
      recognRef.current = null;
    };

    recog.onend = () => {
      setListening(false);
      recognRef.current = null;
    };

    try {
      recog.start();
      setListening(true);
    } catch {
      setMicError('No se pudo iniciar el micrófono.');
    }
  }, [sendQuestion]);

  const handleMicClick = () => {
    if (listening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuestion(input);
    }
  };

  const sendAIOrder = useCallback(async (orderData: OrderData) => {
    const bId = businessIdRef.current;
    if (!bId) {
      console.warn('[AI order] businessId not available yet — order NOT saved');
      return;
    }
    const phone = orderData.telefono ? orderData.telefono.replace(/\D/g, '') || null : null;
    const entrega = (orderData.entrega ?? '').toLowerCase();
    const delivery_type = entrega.includes('domicilio') ? 'delivery'
      : entrega.includes('recoger') ? 'pickup'
      : 'local';
    const notes = [orderData.items, orderData.notas].filter(Boolean).join(' | ') || null;
    const orderId = crypto.randomUUID();
    const { error } = await supabase.from('orders').insert({
      id:               orderId,
      business_id:      bId,
      customer_name:    orderData.cliente || 'Cliente',
      customer_phone:   phone,
      delivery_type,
      delivery_address: orderData.direccion || null,
      total:            0,
      notes,
      status:           'pending',
    });
    if (error) {
      console.error('[AI order] insert failed:', error);
    } else {
      console.info('[AI order] saved → orders.id:', orderId, '| business:', bId);
    }
  }, []);

  // Normalize a date string from AI (e.g. "2026-08-15", "15/08/2026", "mañana") → ISO YYYY-MM-DD or null
  const normalizeDate = useCallback((raw: string | undefined | null): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Already ISO YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    // DD/MM/YYYY
    const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
    // MM/DD/YYYY
    const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) return null; // ambiguous — skip
    // Not parseable as a strict date
    return null;
  }, []);

  // Normalize a time string from AI (e.g. "14:30", "2:30 PM", "2pm") → HH:MM or null
  const normalizeTime = useCallback((raw: string | undefined | null): string | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Already HH:MM or HH:MM:SS
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) {
      const [h, m] = trimmed.split(':');
      return `${h.padStart(2, '0')}:${m}`;
    }
    // 12-hour with AM/PM: "2:30 PM", "2pm", "14h"
    const ampm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = ampm[2] ? parseInt(ampm[2], 10) : 0;
      const period = ampm[3].toLowerCase();
      if (period === 'pm' && h !== 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  }, []);

  const sendAIBooking = useCallback(async (bd: BookingData): Promise<boolean> => {
    const bId = businessIdRef.current;
    if (!bId) {
      console.warn('[AI booking] businessId not available yet — booking NOT saved');
      return false;
    }
    const bookingDate = normalizeDate(bd.fecha);
    const bookingTime = normalizeTime(bd.hora);

    if (!bookingDate || !bookingTime) {
      console.warn('[AI booking] Could not parse date/time from AI output:', bd.fecha, bd.hora);
      return false;
    }

    const { data, error } = await supabase.rpc('create_booking' as any, {
      p_business_id:   bId,
      p_service_id:    bd.servicio_id || null,
      p_service_name:  bd.servicio || 'Servicio',
      p_customer_name: bd.cliente || null,
      p_customer_phone: bd.telefono || null,
      p_booking_date:  bookingDate,
      p_booking_time:  bookingTime,
      p_num_persons:   bd.personas || 1,
      p_notes:         bd.notas || null,
    });

    if (error) {
      console.error('[AI booking] RPC failed:', error);
      return false;
    }
    console.info('[AI booking] saved via RPC → id:', data, '| business:', bId);
    return true;
  }, [normalizeDate, normalizeTime]);

  const saveConversation = useCallback(async (msgs: Message[]) => {
    const bId = businessIdRef.current;
    if (!bId || msgs.length < 2 || savedRef.current) return;
    savedRef.current = true;
    const orderMsg   = msgs.find(m => m.orderData);
    const orderData  = orderMsg?.orderData;
    const phone      = orderData?.telefono ? orderData.telefono.replace(/\D/g, '') || null : null;
    await supabase.from('ai_conversations').insert({
      business_id:    bId,
      slug,
      customer_name:  orderData?.cliente ?? null,
      customer_phone: phone,
      messages:       msgs.map(m => ({ role: m.role, content: m.content })) as unknown as import('@/integrations/supabase/types').Json,
      had_order:      !!orderData,
      order_data:     orderData ? (orderData as unknown as import('@/integrations/supabase/types').Json) : null,
    });
  }, [slug]);

  const closePanel = () => {
    setOpen(false);
    stopSpeaking();
    stopListening();
    saveConversation(messages);
  };

  if (!aiEnabled) return null;

  return (
    <>
      {/* Chat panel — sits above the floating button */}
      {open && (
        <div
          className="fixed bottom-24 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{ maxHeight: '68vh' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ backgroundColor: brandColor }}
          >
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-white" />
              <span className="text-sm font-semibold text-white">Asistente IA</span>
              {speaking && (
                <span className="flex gap-0.5 items-end h-3">
                  {[0, 1, 2].map(i => (
                    <span
                      key={i}
                      className="w-0.5 bg-white/80 rounded-full animate-pulse"
                      style={{ height: `${8 + i * 3}px`, animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {hasSpeechSynth && (
                <button
                  onClick={toggleMute}
                  className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  title={muted ? 'Activar voz' : 'Silenciar'}
                >
                  {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                </button>
              )}
              {messages.length > 0 && (
                <button
                  onClick={resetChat}
                  className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                  title="Reiniciar conversación"
                  data-testid="button-ai-reset"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={closePanel}
                className="p-1 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-center py-6">
                <div className="w-10 h-10 mx-auto mb-3 flex items-center justify-center">
                  <SparklesColored size={32} />
                </div>
                <p className="text-sm text-muted-foreground">
                  ¡Hola! Pregúntame sobre el menú, precios o ingredientes.
                </p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={cn('flex flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed',
                    msg.role === 'user'
                      ? 'text-white rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm',
                  )}
                  style={msg.role === 'user' ? { backgroundColor: brandColor } : undefined}
                >
                  {msg.content}
                </div>
                {msg.orderData && waNumber && (
                  <a
                    href={getWaUrl(waNumber, buildWaOrderMessage(businessName, msg.orderData))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 active:scale-95"
                    style={{ backgroundColor: '#25D366' }}
                    data-testid="button-ai-send-whatsapp"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    Enviar pedido por WhatsApp
                  </a>
                )}
                {msg.bookingData && waNumber && (
                  <a
                    href={getWaUrl(waNumber, buildWaBookingMessage(businessName, msg.bookingData))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 active:scale-95"
                    style={{ backgroundColor: '#25D366' }}
                    data-testid="button-ai-send-booking-whatsapp"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                    </svg>
                    Confirmar reserva por WhatsApp
                  </a>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Pensando…</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Mic error hint */}
          {micError && (
            <div className="px-3 pb-1 flex-shrink-0">
              <p className="text-xs text-destructive text-center">{micError}</p>
            </div>
          )}

          {/* Input */}
          <div className="flex items-end gap-2 px-3 py-2.5 border-t border-border flex-shrink-0">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={listening ? '🎙️ Escuchando…' : 'Escribe tu pregunta…'}
              disabled={loading}
              className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring max-h-20 disabled:opacity-50"
              style={{ minHeight: '36px' }}
              data-testid="input-menu-ai"
            />
            {hasVoiceInput && (
              <button
                onClick={handleMicClick}
                disabled={loading}
                className={cn(
                  'flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all disabled:opacity-50',
                  listening
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
                title={listening ? 'Detener escucha' : 'Hablar'}
                data-testid="button-menu-ai-mic"
              >
                {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={() => sendQuestion(input)}
              disabled={loading || !input.trim()}
              className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: brandColor }}
              data-testid="button-menu-ai-send"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Floating button — WhatsApp-style green */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'fixed bottom-8 right-4 z-[60] w-14 h-14 rounded-full flex items-center justify-center transition-all duration-200',
          open ? 'scale-90' : 'scale-100 hover:scale-105',
        )}
        style={{
          backgroundColor: '#25D366',
          boxShadow: '0 4px 16px 0 rgba(37,211,102,0.45)',
        }}
        aria-label="Abrir asistente IA"
        data-testid="button-menu-ai-toggle"
      >
        {open
          ? <X className="w-6 h-6 text-white" />
          : <MessageCircle className="w-7 h-7 text-white" fill="white" />}
      </button>
    </>
  );
}
