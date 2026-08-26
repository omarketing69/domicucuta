import { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import QRCodeStyling from 'qr-code-styling';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Loader2, CheckCircle2, Upload, X, Palette, QrCode, Download, Zap, Eye, EyeOff, ExternalLink, Camera, MessageCircle, Phone, PhoneCall, Mail, Send, Copy, Link, Webhook, Info, Clock, CalendarDays, ShoppingBag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getEffectivePlan } from '@/lib/planUtils';
import { sendTwilioNotification, TwilioChannel, CHANNEL_META } from '@/lib/twilioNotify';
import { useToast } from '@/hooks/use-toast';

const PRESET_COLORS = [
  '#f97316', '#ef4444', '#ec4899', '#a855f7',
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f59e0b', '#78716c',
];

export default function Settings() {
  const { business, refetch } = useBusiness();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: '', slug: '', description: '', whatsapp_number: '',
    address: '', currency: 'USD', primary_color: '#f97316', logo_url: '',
    ai_enabled: false,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  // WA API section state
  const [waForm, setWaForm] = useState({ wa_phone_number_id: '', wa_access_token: '' });
  const [waSaving, setWaSaving] = useState(false);
  const [waSaved, setWaSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Instagram DM section state
  const [igForm, setIgForm] = useState({ ig_page_id: '', ig_access_token: '' });
  const [igSaving, setIgSaving] = useState(false);
  const [igSaved, setIgSaved] = useState(false);
  const [showIgToken, setShowIgToken] = useState(false);

  // Facebook Messenger section state
  const [fbForm, setFbForm] = useState({ fb_page_id: '', fb_page_token: '' });
  const [fbSaving, setFbSaving] = useState(false);
  const [fbSaved, setFbSaved] = useState(false);
  const [showFbToken, setShowFbToken] = useState(false);

  // One-click Meta OAuth connect state
  const [metaConnecting, setMetaConnecting] = useState(false);

  // Twilio section state
  const [twilioForm, setTwilioForm] = useState({
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_whatsapp_number: '',
    twilio_sms_number: '',
    twilio_voice_number: '',
    sendgrid_api_key: '',
    sendgrid_from_email: '',
  });
  const [enabledChannels, setEnabledChannels] = useState<string[]>([]);
  const [twilioSaving, setTwilioSaving] = useState(false);
  const [twilioSaved, setTwilioSaved] = useState(false);
  const [showTwilioToken, setShowTwilioToken] = useState(false);
  const [showSgKey, setShowSgKey] = useState(false);
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  // Business type switcher
  const [businessType, setBusinessType] = useState<'products' | 'reservations'>('products');
  const [bizTypeSaving, setBizTypeSaving] = useState(false);
  const [bizTypeSaved, setBizTypeSaved] = useState(false);

  // Production times
  const [productionTimes, setProductionTimes] = useState({ reception: 2, preparation: 18, packaging: 5, handoff: 3, delivery: 20 });
  const [ptSaving, setPtSaving] = useState(false);
  const [ptSaved, setPtSaved] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name,
        slug: business.slug,
        description: business.description || '',
        whatsapp_number: business.whatsapp_number,
        address: business.address || '',
        currency: business.currency,
        primary_color: (business as any).primary_color || '#f97316',
        logo_url: (business as any).logo_url || '',
        ai_enabled: !!(business as any).ai_enabled,
      });
      setWaForm({
        wa_phone_number_id: business.wa_phone_number_id || '',
        wa_access_token: business.wa_access_token || '',
      });
      setIgForm({
        ig_page_id: (business as any).ig_page_id || '',
        ig_access_token: (business as any).ig_access_token || '',
      });
      setFbForm({
        fb_page_id: (business as any).fb_page_id || '',
        fb_page_token: (business as any).fb_page_token || '',
      });
      setTwilioForm({
        twilio_account_sid: (business as any).twilio_account_sid || '',
        twilio_auth_token: (business as any).twilio_auth_token || '',
        twilio_whatsapp_number: (business as any).twilio_whatsapp_number || '',
        twilio_sms_number: (business as any).twilio_sms_number || '',
        twilio_voice_number: (business as any).twilio_voice_number || '',
        sendgrid_api_key: (business as any).sendgrid_api_key || '',
        sendgrid_from_email: (business as any).sendgrid_from_email || '',
      });
      setEnabledChannels((business as any).enabled_channels || []);
      setBusinessType(((business as any).business_type as 'products' | 'reservations') || 'products');
      const pt = (business as any).production_times;
      if (pt) setProductionTimes(prev => ({ ...prev, ...pt }));
    }
  }, [business]);

  // Handle the redirect back from meta-oauth-callback (?meta_connected=1 / ?meta_error=<reason>)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('meta_connected');
    const errorReason = params.get('meta_error');
    if (!connected && !errorReason) return;

    if (connected) {
      toast({
        title: 'Instagram y Facebook conectados',
        description: 'El Director de Ventas ya puede ver tus publicaciones para darte recomendaciones.',
      });
      refetch();
    } else if (errorReason) {
      const messages: Record<string, string> = {
        denied: 'Cancelaste la conexión con Meta.',
        missing_params: 'Faltaron datos en la respuesta de Meta. Intenta de nuevo.',
        invalid_state: 'La sesión de conexión expiró. Intenta de nuevo.',
        not_configured: 'La conexión con Meta no está configurada todavía.',
        token_exchange_failed: 'No se pudo validar el acceso con Meta. Intenta de nuevo.',
        pages_fetch_failed: 'No se pudieron obtener tus Páginas de Facebook.',
        no_pages_found: 'No encontramos ninguna Página de Facebook en tu cuenta.',
        save_failed: 'No se pudieron guardar las credenciales. Intenta de nuevo.',
        internal_error: 'Ocurrió un error inesperado. Intenta de nuevo.',
      };
      toast({
        title: 'No se pudo conectar',
        description: messages[errorReason] || 'Ocurrió un error al conectar con Meta.',
        variant: 'destructive',
      });
    }
    window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectMeta = async () => {
    setMetaConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ oauth_url: string }>('meta-oauth-start');
      if (error || !data?.oauth_url) throw error || new Error('No se recibió la URL de conexión');
      window.location.href = data.oauth_url;
    } catch (err) {
      console.error('[connectMeta]', err);
      toast({
        title: 'Error al conectar',
        description: 'No se pudo iniciar la conexión con Meta. Intenta de nuevo.',
        variant: 'destructive',
      });
      setMetaConnecting(false);
    }
  };

  // Generate QR code when slug changes
  useEffect(() => {
    if (!form.slug || !qrRef.current) return;
    const qrCode = new QRCodeStyling({
      width: 250, height: 250,
      data: `${window.location.origin}/b/${form.slug}`,
      dotsOptions: { color: '#000000', type: 'rounded' },
      backgroundOptions: { color: '#FFFFFF' },
      margin: 10,
    });
    qrRef.current.innerHTML = '';
    qrCode.append(qrRef.current);
    (qrRef.current as any)._qrCode = qrCode;
  }, [form.slug]);

  const downloadQR = () => {
    if (!qrRef.current || !(qrRef.current as any)._qrCode) return;
    (qrRef.current as any)._qrCode.download({ name: `qr-menu-${form.slug}`, extension: 'png' });
  };

  const uploadLogo = async (file: File) => {
    if (!user) return;
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${user.id}/logo.${ext}`;
    const { error } = await supabase.storage.from('logos').upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supabase.storage.from('logos').getPublicUrl(path);
      setForm(f => ({ ...f, logo_url: data.publicUrl + '?t=' + Date.now() }));
    }
    setUploading(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    await supabase.from('businesses').update(form as any).eq('id', business.id);
    setSaving(false); setSaved(true);
    refetch();
    qc.invalidateQueries({ queryKey: ['business_ai_config', business.id] });
    setTimeout(() => setSaved(false), 2500);
  };

  const saveWa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setWaSaving(true);
    await supabase.from('businesses').update({
      wa_phone_number_id: waForm.wa_phone_number_id.trim() || null,
      wa_access_token: waForm.wa_access_token.trim() || null,
    }).eq('id', business.id);
    setWaSaving(false); setWaSaved(true); refetch();
    setTimeout(() => setWaSaved(false), 2500);
  };

  const saveIg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setIgSaving(true);
    await supabase.from('businesses').update({
      ig_page_id: igForm.ig_page_id.trim() || null,
      ig_access_token: igForm.ig_access_token.trim() || null,
    } as any).eq('id', business.id);
    setIgSaving(false); setIgSaved(true); refetch();
    setTimeout(() => setIgSaved(false), 2500);
  };

  const saveFb = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setFbSaving(true);
    await supabase.from('businesses').update({
      fb_page_id: fbForm.fb_page_id.trim() || null,
      fb_page_token: fbForm.fb_page_token.trim() || null,
    } as any).eq('id', business.id);
    setFbSaving(false); setFbSaved(true); refetch();
    setTimeout(() => setFbSaved(false), 2500);
  };

  const saveTwilio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setTwilioSaving(true);
    await supabase.from('businesses').update({
      twilio_account_sid: twilioForm.twilio_account_sid.trim() || null,
      twilio_auth_token: twilioForm.twilio_auth_token.trim() || null,
      twilio_whatsapp_number: twilioForm.twilio_whatsapp_number.trim() || null,
      twilio_sms_number: twilioForm.twilio_sms_number.trim() || null,
      twilio_voice_number: twilioForm.twilio_voice_number.trim() || null,
      sendgrid_api_key: twilioForm.sendgrid_api_key.trim() || null,
      sendgrid_from_email: twilioForm.sendgrid_from_email.trim() || null,
    } as any).eq('id', business.id);
    setTwilioSaving(false); setTwilioSaved(true); refetch();
    setTimeout(() => setTwilioSaved(false), 2500);
  };

  const saveBusinessType = async (newType: 'products' | 'reservations') => {
    if (!business || newType === businessType) return;
    setBizTypeSaving(true);
    setBusinessType(newType);
    await supabase.from('businesses').update({ business_type: newType } as any).eq('id', business.id);
    setBizTypeSaving(false); setBizTypeSaved(true); refetch();
    setTimeout(() => setBizTypeSaved(false), 2500);
  };

  const savePt = async () => {
    if (!business) return;
    setPtSaving(true);
    await supabase.from('businesses').update({ production_times: productionTimes } as any).eq('id', business.id);
    setPtSaving(false); setPtSaved(true); refetch();
    setTimeout(() => setPtSaved(false), 2500);
  };

  const toggleChannel = async (channel: string) => {
    if (!business) return;
    const newChannels = enabledChannels.includes(channel)
      ? enabledChannels.filter(c => c !== channel)
      : [...enabledChannels, channel];
    setEnabledChannels(newChannels);
    await supabase.from('businesses').update({ enabled_channels: newChannels } as any).eq('id', business.id);
    refetch();
  };

  const testTwilioChannel = async (channel: TwilioChannel) => {
    if (!business) return;
    setTestingChannel(channel);
    const testTo = channel === 'email' ? twilioForm.sendgrid_from_email : business.whatsapp_number;
    if (!testTo) {
      toast({ title: 'Falta el número de prueba', description: 'Configura el número/email del negocio primero', variant: 'destructive' });
      setTestingChannel(null);
      return;
    }
    const { success, error } = await sendTwilioNotification({
      businessId: business.id,
      to: testTo,
      channel,
      message: `🧪 Prueba de canal ${CHANNEL_META[channel].label} desde WhatOrden`,
    });
    setTestingChannel(null);
    if (success) {
      toast({ title: '¡Prueba enviada!', description: `Revisa el ${channel === 'email' ? 'correo' : channel === 'voice' ? 'teléfono' : 'mensaje'}.` });
    } else {
      toast({ title: 'Error en prueba', description: error ?? 'Error desconocido', variant: 'destructive' });
    }
  };

  const isPro = getEffectivePlan(business ?? undefined) === 'pro';

  const hasTwilioBase = !!twilioForm.twilio_account_sid && !!twilioForm.twilio_auth_token;

  const channelReady: Record<TwilioChannel, boolean> = {
    whatsapp_twilio: hasTwilioBase && !!twilioForm.twilio_whatsapp_number,
    sms: hasTwilioBase && !!twilioForm.twilio_sms_number,
    voice: hasTwilioBase && !!twilioForm.twilio_voice_number,
    email: !!twilioForm.sendgrid_api_key && !!twilioForm.sendgrid_from_email,
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Datos y apariencia de tu negocio</p>
      </div>

      {/* ── Modo del negocio ─────────────────────────────────────────────── */}
      <div className="card-elevated p-6 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-sm">Modo del negocio</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cambia entre venta de productos o reservas y citas. El menú lateral se actualiza automáticamente.
            </p>
          </div>
          {bizTypeSaved && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 flex-shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> Guardado
            </span>
          )}
          {bizTypeSaving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Products card */}
          <button
            type="button"
            onClick={() => saveBusinessType('products')}
            disabled={bizTypeSaving}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
              businessType === 'products'
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/40 hover:bg-muted/60'
            )}
          >
            <span className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              businessType === 'products' ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
            )}>
              <ShoppingBag className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">Productos</p>
              <p className="text-xs leading-tight mt-0.5 opacity-80">Catálogo y pedidos</p>
            </div>
            {businessType === 'products' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Activo</span>
            )}
          </button>

          {/* Reservations card */}
          <button
            type="button"
            onClick={() => saveBusinessType('reservations')}
            disabled={bizTypeSaving}
            className={cn(
              'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center',
              businessType === 'reservations'
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                : 'border-border bg-muted/30 text-muted-foreground hover:border-violet-300 hover:bg-muted/60'
            )}
          >
            <span className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center',
              businessType === 'reservations' ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground'
            )}>
              <CalendarDays className="w-5 h-5" />
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">Reservas</p>
              <p className="text-xs leading-tight mt-0.5 opacity-80">Servicios y citas</p>
            </div>
            {businessType === 'reservations' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">Activo</span>
            )}
          </button>
        </div>

        {businessType === 'reservations' && (
          <div className="flex items-start gap-2 text-xs text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>En modo Reservas: el menú lateral muestra <strong>Servicios</strong> y <strong>Reservas</strong>. Los productos existentes se conservan pero no se muestran.</span>
          </div>
        )}
        {businessType === 'products' && (business as any)?.business_type === 'reservations' && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>Al cambiar a Productos: los servicios y reservas se conservan pero no se muestran. El catálogo de productos vuelve a estar activo.</span>
          </div>
        )}
      </div>

      <form onSubmit={save} className="space-y-4">
        {/* Logo */}
        <div className="card-elevated p-6 space-y-4">
          <h2 className="font-medium flex items-center gap-2"><Upload className="w-4 h-4" /> Logo del negocio</h2>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl border-2 border-dashed border-border flex items-center justify-center overflow-hidden bg-muted/30 flex-shrink-0">
              {form.logo_url ? (
                <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
              ) : (
                <Upload className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2 flex-1">
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
              <Button type="button" variant="outline" size="sm" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? 'Subiendo...' : 'Subir imagen'}
              </Button>
              {form.logo_url && (
                <Button type="button" variant="ghost" size="sm" className="w-full text-destructive hover:text-destructive"
                  onClick={() => setForm(f => ({ ...f, logo_url: '' }))}>
                  <X className="w-4 h-4 mr-2" /> Quitar logo
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG o SVG. Recomendado: fondo transparente.</p>
            </div>
          </div>
        </div>

        {/* Brand Color */}
        <div className="card-elevated p-6 space-y-4">
          <h2 className="font-medium flex items-center gap-2"><Palette className="w-4 h-4" /> Color principal del menú</h2>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-border flex-shrink-0 cursor-pointer relative overflow-hidden"
              style={{ backgroundColor: form.primary_color }} onClick={() => document.getElementById('colorpicker')?.click()}>
              <input id="colorpicker" type="color" value={form.primary_color}
                onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
            </div>
            <Input value={form.primary_color} onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
              placeholder="#f97316" className="font-mono text-sm" />
          </div>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_COLORS.map(color => (
              <button key={color} type="button" title={color}
                className="w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 focus:outline-none"
                style={{ backgroundColor: color, borderColor: form.primary_color === color ? 'hsl(var(--foreground))' : 'transparent' }}
                onClick={() => setForm(f => ({ ...f, primary_color: color }))} />
            ))}
          </div>
          <div className="rounded-lg p-3 text-sm" style={{ backgroundColor: form.primary_color + '18', borderLeft: `3px solid ${form.primary_color}` }}>
            <span className="font-medium" style={{ color: form.primary_color }}>Vista previa:</span>
            <span className="text-muted-foreground ml-2">Así se verá el color en tu menú público</span>
          </div>
        </div>

        {/* Business Info */}
        <div className="card-elevated p-6 space-y-4">
          <h2 className="font-medium">Información del negocio</h2>
          <div className="space-y-1.5">
            <Label>Nombre del negocio *</Label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
          </div>
          <div className="space-y-1.5">
            <Label>Slug (URL)</Label>
            <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} />
            <p className="text-xs text-muted-foreground">{window.location.origin}/b/{form.slug}</p>
          </div>
          {form.slug && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-2"><QrCode className="w-4 h-4" /><Label>Código QR para tu menú</Label></div>
              <p className="text-xs text-muted-foreground">Descarga e imprime este código QR para que tus clientes accedan al menú digital.</p>
              <div className="flex flex-col items-center gap-4 p-4 rounded-lg bg-muted/50">
                <div ref={qrRef} className="border-2 border-border rounded-lg p-2 bg-white" />
                <Button type="button" variant="outline" size="sm" onClick={downloadQR} className="gap-2">
                  <Download className="w-4 h-4" /> Descargar QR (PNG)
                </Button>
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>WhatsApp *</Label>
            <Input value={form.whatsapp_number} onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))} placeholder="+52 55 1234 5678" required />
          </div>
          <div className="space-y-1.5">
            <Label>Descripción</Label>
            <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Dirección</Label>
            <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Moneda</Label>
            <select className="w-full h-9 px-3 text-sm border border-input rounded-lg bg-background"
              value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
              <option value="USD">USD — Dólar</option>
              <option value="MXN">MXN — Peso mexicano</option>
              <option value="EUR">EUR — Euro</option>
              <option value="COP">COP — Peso colombiano</option>
              <option value="ARS">ARS — Peso argentino</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Asistente IA en el menú público</p>
              <p className="text-xs text-muted-foreground mt-0.5">Muestra el botón flotante de chat IA en tu menú digital</p>
            </div>
            <Switch
              data-testid="switch-ai-enabled-settings"
              checked={form.ai_enabled}
              onCheckedChange={v => setForm(f => ({ ...f, ai_enabled: v }))}
            />
          </div>
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4 mr-2" /> : null}
          {saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </form>

      {/* ── Meta Webhook — URL y Token de verificación ── */}
      {isPro && (
        <div className="card-elevated p-6 space-y-4">
          <div>
            <h2 className="font-medium flex items-center gap-2"><Webhook className="w-4 h-4 text-indigo-500" />Webhook de Meta (WA / Instagram / Messenger)</h2>
            <p className="text-xs text-muted-foreground mt-1">Registra esta URL en Meta for Developers para recibir mensajes de los 3 canales.</p>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">URL del Webhook</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value="https://khhxcruhhhzuuykfeivd.supabase.co/functions/v1/whatsapp-webhook"
                className="font-mono text-xs bg-muted/40"
                data-testid="input-webhook-url"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="flex-shrink-0 gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText('https://khhxcruhhhzuuykfeivd.supabase.co/functions/v1/whatsapp-webhook');
                  toast({ title: 'URL copiada', description: 'Pégala en Meta for Developers.' });
                }}
                data-testid="button-copy-webhook-url"
              >
                <Copy className="w-3.5 h-3.5" /> Copiar
              </Button>
            </div>
          </div>

          {/* Verify Token — platform-level, not shown here */}
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-4 py-3">
            <Info className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              El <strong>Verify Token</strong> para el campo de verificación de Meta lo provee tu administrador de WhatOrden. No es por negocio — es único para toda la plataforma.
            </p>
          </div>

          {/* Channel readiness checklist */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Estado de credenciales por canal</p>
            <div className="grid grid-cols-1 gap-1.5">
              {[
                {
                  label: 'WhatsApp Business API',
                  ready: !!(waForm.wa_phone_number_id && waForm.wa_access_token),
                  hint: 'Configura Phone Number ID + Access Token en la sección de abajo',
                },
                {
                  label: 'Instagram DM',
                  ready: !!(igForm.ig_page_id && igForm.ig_access_token),
                  hint: 'Configura Page ID + Access Token en la sección de abajo',
                },
                {
                  label: 'Facebook Messenger',
                  ready: !!(fbForm.fb_page_id && fbForm.fb_page_token),
                  hint: 'Configura Page ID + Page Token en la sección de abajo',
                },
              ].map(({ label, ready, hint }) => (
                <div key={label} className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${ready ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300' : 'bg-muted/40 border-border text-muted-foreground'}`}>
                  <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${ready ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground/40'}`} />
                  <span className="font-medium">{label}</span>
                  {!ready && <span className="ml-auto text-[11px]">{hint}</span>}
                  {ready && <span className="ml-auto text-[11px]">Listo</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Setup steps */}
          <div className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">Pasos para activar en Meta for Developers</p>
            <ol className="space-y-1.5 text-xs text-indigo-800 dark:text-indigo-300">
              <li className="flex gap-2">
                <span className="font-bold">1.</span>
                Abre tu app en <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 inline-flex items-center gap-0.5">developers.facebook.com <ExternalLink className="w-2.5 h-2.5" /></a> → <em>Webhooks</em>.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">2.</span>
                Pega la URL del webhook de arriba. El <strong>Verify Token</strong> te lo entrega tu administrador de WhatOrden. Haz clic en <em>Verificar y guardar</em>.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">3.</span>
                <strong>WhatsApp:</strong> suscríbete al campo <code className="bg-indigo-100 dark:bg-indigo-900/50 px-1 rounded">messages</code>.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">4.</span>
                <strong>Instagram:</strong> suscríbete al campo <code className="bg-indigo-100 dark:bg-indigo-900/50 px-1 rounded">messages</code> de tu app de Instagram.
              </li>
              <li className="flex gap-2">
                <span className="font-bold">5.</span>
                <strong>Messenger:</strong> suscríbete a <code className="bg-indigo-100 dark:bg-indigo-900/50 px-1 rounded">messages</code> + <code className="bg-indigo-100 dark:bg-indigo-900/50 px-1 rounded">messaging_postbacks</code> en tu Página.
              </li>
            </ol>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 border border-border rounded-lg px-3 py-2">
            <Link className="w-3.5 h-3.5 flex-shrink-0" />
            Un solo webhook maneja WhatsApp, Instagram DM y Facebook Messenger automáticamente.
          </div>
        </div>
      )}

      {/* ── WhatsApp Business API ── */}
      <form onSubmit={saveWa} className="space-y-4">
        <div className={cn('card-elevated p-6 space-y-4', !isPro && 'opacity-70')}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium flex items-center gap-2"><Zap className="w-4 h-4 text-violet-500" />WhatsApp Business API</h2>
              <p className="text-xs text-muted-foreground mt-1">Envía difusiones automáticamente sin abrir WhatsApp manualmente.</p>
            </div>
            {!isPro ? (
              <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 border border-violet-200 dark:border-violet-800">Solo Plan Pro</span>
            ) : (
              <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700">Plan Pro ✓</span>
            )}
          </div>
          {!isPro ? (
            <div className="rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 px-4 py-3 text-sm text-violet-800 dark:text-violet-300">
              Actualiza al Plan Pro para activar el envío automático de difusiones via WhatsApp Business API.
            </div>
          ) : (
            <>
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-2">
                <p className="text-xs font-semibold text-foreground">¿Cómo obtener las credenciales?</p>
                <ol className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex gap-2"><span className="font-bold text-foreground">1.</span>Entra a <a href="https://business.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">business.facebook.com <ExternalLink className="w-2.5 h-2.5" /></a> y abre la app de WhatsApp Business.</li>
                  <li className="flex gap-2"><span className="font-bold text-foreground">2.</span>En <em>Configuración → Números de teléfono</em>, copia el <strong className="text-foreground">Phone Number ID</strong>.</li>
                  <li className="flex gap-2"><span className="font-bold text-foreground">3.</span>En <em>Herramientas de desarrollador</em>, genera un <strong className="text-foreground">Access Token</strong> permanente.</li>
                  <li className="flex gap-2"><span className="font-bold text-foreground">4.</span>Pega ambos valores abajo y guarda.</li>
                </ol>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone-id">Phone Number ID</Label>
                <Input id="wa-phone-id" value={waForm.wa_phone_number_id}
                  onChange={e => setWaForm(f => ({ ...f, wa_phone_number_id: e.target.value }))}
                  placeholder="123456789012345" className="font-mono text-sm" data-testid="input-wa-phone-number-id" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-token">Access Token</Label>
                <div className="relative">
                  <Input id="wa-token" type={showToken ? 'text' : 'password'} value={waForm.wa_access_token}
                    onChange={e => setWaForm(f => ({ ...f, wa_access_token: e.target.value }))}
                    placeholder="EAAxxxxx..." className="font-mono text-sm pr-10" data-testid="input-wa-access-token" />
                  <button type="button" onClick={() => setShowToken(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {waForm.wa_phone_number_id && waForm.wa_access_token && (
                <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2">
                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Credenciales configuradas — el modo automático estará disponible en Difusiones.
                </div>
              )}
              <Button type="submit" disabled={waSaving} variant="outline" className="w-full gap-2">
                {waSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : waSaved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Zap className="w-4 h-4" />}
                {waSaved ? 'Credenciales guardadas' : 'Guardar credenciales WA'}
              </Button>
            </>
          )}
        </div>
      </form>

      {/* ── Conectar Instagram y Facebook (un clic, todos los planes) ── */}
      <div className="card-elevated p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium flex items-center gap-2">
              <Link className="w-4 h-4 text-violet-500" />
              Conectar Instagram y Facebook
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Conecta tu Página de Facebook e Instagram con un clic para que el Director de Ventas pueda ver tus publicaciones y darte recomendaciones. Disponible en todos los planes.
            </p>
          </div>
          {(igForm.ig_page_id || fbForm.fb_page_id) && (
            <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-700">Conectado ✓</span>
          )}
        </div>
        <Button type="button" onClick={connectMeta} disabled={metaConnecting} className="w-full gap-2">
          {metaConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
          {(igForm.ig_page_id || fbForm.fb_page_id) ? 'Reconectar Instagram/Facebook' : 'Conectar Instagram y Facebook'}
        </Button>
        {!isPro && (
          <p className="text-xs text-muted-foreground">
            Esto solo permite leer tus publicaciones. Para responder mensajes directos automáticamente necesitas el Plan Pro (secciones abajo).
          </p>
        )}
      </div>

      {/* ── Instagram DM ── */}
      {isPro && (
        <form onSubmit={saveIg} className="space-y-4">
          <div className="card-elevated p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium flex items-center gap-2"><Camera className="w-4 h-4 text-pink-500" />Instagram DM</h2>
                <p className="text-xs text-muted-foreground mt-1">Recibe y responde mensajes directos de Instagram desde el CRM.</p>
              </div>
              {igForm.ig_page_id && igForm.ig_access_token && (
                <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400 border border-pink-200 dark:border-pink-800">Conectado ✓</span>
              )}
            </div>
            <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">¿Cómo conectar Instagram?</p>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2"><span className="font-bold text-foreground">1.</span>Tu cuenta debe ser Profesional y estar vinculada a una Página de Facebook.</li>
                <li className="flex gap-2"><span className="font-bold text-foreground">2.</span>En <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">Meta for Developers <ExternalLink className="w-2.5 h-2.5" /></a>, activa <strong className="text-foreground">Instagram Messaging</strong>.</li>
                <li className="flex gap-2"><span className="font-bold text-foreground">3.</span>Copia el <strong className="text-foreground">Instagram Page ID</strong> y genera un <strong className="text-foreground">Page Access Token</strong>.</li>
              </ol>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ig-page-id">Instagram Page ID</Label>
              <Input id="ig-page-id" value={igForm.ig_page_id}
                onChange={e => setIgForm(f => ({ ...f, ig_page_id: e.target.value }))}
                placeholder="123456789012345" className="font-mono text-sm" data-testid="input-ig-page-id" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ig-token">Page Access Token</Label>
              <div className="relative">
                <Input id="ig-token" type={showIgToken ? 'text' : 'password'} value={igForm.ig_access_token}
                  onChange={e => setIgForm(f => ({ ...f, ig_access_token: e.target.value }))}
                  placeholder="EAAxxxxx..." className="font-mono text-sm pr-10" data-testid="input-ig-access-token" />
                <button type="button" onClick={() => setShowIgToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showIgToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {igForm.ig_page_id && igForm.ig_access_token && (
              <div className="flex items-center gap-2 text-xs text-pink-700 dark:text-pink-400 bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Instagram DM configurado — los mensajes directos aparecerán en el CRM.
              </div>
            )}
            <Button type="submit" disabled={igSaving} variant="outline" className="w-full gap-2">
              {igSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : igSaved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Camera className="w-4 h-4" />}
              {igSaved ? 'Guardado' : 'Guardar credenciales Instagram'}
            </Button>
          </div>
        </form>
      )}

      {/* ── Facebook Messenger ── */}
      {isPro && (
        <form onSubmit={saveFb} className="space-y-4">
          <div className="card-elevated p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium flex items-center gap-2"><MessageCircle className="w-4 h-4 text-blue-500" />Facebook Messenger</h2>
                <p className="text-xs text-muted-foreground mt-1">Recibe y responde mensajes de Messenger de tu Página de Facebook.</p>
              </div>
              {fbForm.fb_page_id && fbForm.fb_page_token && (
                <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200 dark:border-blue-800">Conectado ✓</span>
              )}
            </div>
            <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 space-y-2">
              <p className="text-xs font-semibold text-foreground">¿Cómo conectar Messenger?</p>
              <ol className="space-y-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2"><span className="font-bold text-foreground">1.</span>En <a href="https://developers.facebook.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">Meta for Developers <ExternalLink className="w-2.5 h-2.5" /></a>, activa el producto <strong className="text-foreground">Messenger</strong>.</li>
                <li className="flex gap-2"><span className="font-bold text-foreground">2.</span>Copia el <strong className="text-foreground">Facebook Page ID</strong> y genera un <strong className="text-foreground">Page Access Token</strong> con permiso <code className="bg-muted px-0.5 rounded">pages_messaging</code>.</li>
              </ol>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-page-id">Facebook Page ID</Label>
              <Input id="fb-page-id" value={fbForm.fb_page_id}
                onChange={e => setFbForm(f => ({ ...f, fb_page_id: e.target.value }))}
                placeholder="123456789012345" className="font-mono text-sm" data-testid="input-fb-page-id" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fb-token">Page Access Token</Label>
              <div className="relative">
                <Input id="fb-token" type={showFbToken ? 'text' : 'password'} value={fbForm.fb_page_token}
                  onChange={e => setFbForm(f => ({ ...f, fb_page_token: e.target.value }))}
                  placeholder="EAAxxxxx..." className="font-mono text-sm pr-10" data-testid="input-fb-page-token" />
                <button type="button" onClick={() => setShowFbToken(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showFbToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {fbForm.fb_page_id && fbForm.fb_page_token && (
              <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Messenger configurado — los mensajes de tu Página aparecerán en el CRM.
              </div>
            )}
            <Button type="submit" disabled={fbSaving} variant="outline" className="w-full gap-2">
              {fbSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : fbSaved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <MessageCircle className="w-4 h-4" />}
              {fbSaved ? 'Guardado' : 'Guardar credenciales Messenger'}
            </Button>
          </div>
        </form>
      )}

      {/* ── Twilio — Canales de Comunicación ── */}
      <form onSubmit={saveTwilio} className="space-y-4">
        <div className="card-elevated p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-medium flex items-center gap-2">
                <Send className="w-4 h-4 text-red-500" />
                Comunicaciones Twilio
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                SMS, WhatsApp, llamadas de voz y email — activa solo los canales que necesitas.
              </p>
            </div>
            {enabledChannels.length > 0 && (
              <span className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-800">
                {enabledChannels.length} activo{enabledChannels.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Base credentials */}
          <div className="space-y-3 rounded-lg bg-muted/40 border border-border p-4">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              Credenciales Twilio
              <span className="text-muted-foreground font-normal">(compartidas por WhatsApp, SMS y Voz)</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Encuéntralas en <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">console.twilio.com <ExternalLink className="w-2.5 h-2.5" /></a> → Dashboard principal.
            </p>
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="twilio-sid" className="text-xs">Account SID</Label>
                <Input id="twilio-sid" value={twilioForm.twilio_account_sid}
                  onChange={e => setTwilioForm(f => ({ ...f, twilio_account_sid: e.target.value }))}
                  placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="font-mono text-xs h-8"
                  data-testid="input-twilio-account-sid" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="twilio-token" className="text-xs">Auth Token</Label>
                <div className="relative">
                  <Input id="twilio-token" type={showTwilioToken ? 'text' : 'password'}
                    value={twilioForm.twilio_auth_token}
                    onChange={e => setTwilioForm(f => ({ ...f, twilio_auth_token: e.target.value }))}
                    placeholder="••••••••••••••••••••••••••••••••" className="font-mono text-xs h-8 pr-8"
                    data-testid="input-twilio-auth-token" />
                  <button type="button" onClick={() => setShowTwilioToken(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showTwilioToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 4 Channel cards */}
          <div className="space-y-3">
            {/* WhatsApp via Twilio */}
            <div className={cn('rounded-xl border p-4 space-y-3 transition-colors',
              enabledChannels.includes('whatsapp_twilio') ? 'border-emerald-300 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/20' : 'border-border bg-muted/20')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">💬</span>
                  <div>
                    <p className="text-sm font-medium">WhatsApp (vía Twilio)</p>
                    <p className="text-xs text-muted-foreground">Sin configurar Meta Cloud API directa · ~$0.005/msg</p>
                  </div>
                </div>
                <Switch
                  checked={enabledChannels.includes('whatsapp_twilio')}
                  onCheckedChange={() => toggleChannel('whatsapp_twilio')}
                  data-testid="switch-channel-whatsapp_twilio"
                />
              </div>
              {enabledChannels.includes('whatsapp_twilio') && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Número Twilio WhatsApp (E.164)</Label>
                    <Input value={twilioForm.twilio_whatsapp_number}
                      onChange={e => setTwilioForm(f => ({ ...f, twilio_whatsapp_number: e.target.value }))}
                      placeholder="+14155238886" className="font-mono text-xs h-8"
                      data-testid="input-twilio-whatsapp-number" />
                  </div>
                  {channelReady.whatsapp_twilio && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={testingChannel === 'whatsapp_twilio'}
                      onClick={() => testTwilioChannel('whatsapp_twilio')}>
                      {testingChannel === 'whatsapp_twilio' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Probar
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* SMS */}
            <div className={cn('rounded-xl border p-4 space-y-3 transition-colors',
              enabledChannels.includes('sms') ? 'border-blue-300 bg-blue-50/30 dark:border-blue-800 dark:bg-blue-950/20' : 'border-border bg-muted/20')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📱</span>
                  <div>
                    <p className="text-sm font-medium">SMS</p>
                    <p className="text-xs text-muted-foreground">Notificaciones de pedidos a cualquier celular · ~$0.008/msg</p>
                  </div>
                </div>
                <Switch
                  checked={enabledChannels.includes('sms')}
                  onCheckedChange={() => toggleChannel('sms')}
                  data-testid="switch-channel-sms"
                />
              </div>
              {enabledChannels.includes('sms') && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Número Twilio SMS (E.164)</Label>
                    <Input value={twilioForm.twilio_sms_number}
                      onChange={e => setTwilioForm(f => ({ ...f, twilio_sms_number: e.target.value }))}
                      placeholder="+15551234567" className="font-mono text-xs h-8"
                      data-testid="input-twilio-sms-number" />
                  </div>
                  {channelReady.sms && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={testingChannel === 'sms'}
                      onClick={() => testTwilioChannel('sms')}>
                      {testingChannel === 'sms' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Phone className="w-3 h-3" />}
                      Probar SMS
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Voice */}
            <div className={cn('rounded-xl border p-4 space-y-3 transition-colors',
              enabledChannels.includes('voice') ? 'border-amber-300 bg-amber-50/30 dark:border-amber-800 dark:bg-amber-950/20' : 'border-border bg-muted/20')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">📞</span>
                  <div>
                    <p className="text-sm font-medium">Llamadas de voz</p>
                    <p className="text-xs text-muted-foreground">Llama al cliente con mensaje automático · ~$0.014/min</p>
                  </div>
                </div>
                <Switch
                  checked={enabledChannels.includes('voice')}
                  onCheckedChange={() => toggleChannel('voice')}
                  data-testid="switch-channel-voice"
                />
              </div>
              {enabledChannels.includes('voice') && (
                <div className="space-y-2 pt-1">
                  <div className="space-y-1">
                    <Label className="text-xs">Número Twilio Voz (E.164)</Label>
                    <Input value={twilioForm.twilio_voice_number}
                      onChange={e => setTwilioForm(f => ({ ...f, twilio_voice_number: e.target.value }))}
                      placeholder="+15551234567" className="font-mono text-xs h-8"
                      data-testid="input-twilio-voice-number" />
                    <p className="text-xs text-muted-foreground">Puede ser el mismo número SMS si tiene voz habilitada.</p>
                  </div>
                  {channelReady.voice && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={testingChannel === 'voice'}
                      onClick={() => testTwilioChannel('voice')}>
                      {testingChannel === 'voice' ? <Loader2 className="w-3 h-3 animate-spin" /> : <PhoneCall className="w-3 h-3" />}
                      Probar llamada
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Email via SendGrid */}
            <div className={cn('rounded-xl border p-4 space-y-3 transition-colors',
              enabledChannels.includes('email') ? 'border-violet-300 bg-violet-50/30 dark:border-violet-800 dark:bg-violet-950/20' : 'border-border bg-muted/20')}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">✉️</span>
                  <div>
                    <p className="text-sm font-medium">Email (SendGrid)</p>
                    <p className="text-xs text-muted-foreground">Confirmaciones por correo · Gratis hasta 100/día</p>
                  </div>
                </div>
                <Switch
                  checked={enabledChannels.includes('email')}
                  onCheckedChange={() => toggleChannel('email')}
                  data-testid="switch-channel-email"
                />
              </div>
              {enabledChannels.includes('email') && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    Obtén tu API key en <a href="https://app.sendgrid.com/settings/api_keys" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline underline-offset-2 inline-flex items-center gap-0.5">SendGrid <ExternalLink className="w-2.5 h-2.5" /></a>.
                    El email remitente debe estar verificado en SendGrid.
                  </p>
                  <div className="space-y-1">
                    <Label className="text-xs">SendGrid API Key</Label>
                    <div className="relative">
                      <Input type={showSgKey ? 'text' : 'password'} value={twilioForm.sendgrid_api_key}
                        onChange={e => setTwilioForm(f => ({ ...f, sendgrid_api_key: e.target.value }))}
                        placeholder="SG.xxxx..." className="font-mono text-xs h-8 pr-8"
                        data-testid="input-sendgrid-api-key" />
                      <button type="button" onClick={() => setShowSgKey(v => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showSgKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Email remitente verificado</Label>
                    <Input type="email" value={twilioForm.sendgrid_from_email}
                      onChange={e => setTwilioForm(f => ({ ...f, sendgrid_from_email: e.target.value }))}
                      placeholder="notificaciones@tudominio.com" className="text-xs h-8"
                      data-testid="input-sendgrid-from-email" />
                  </div>
                  {channelReady.email && (
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs gap-1"
                      disabled={testingChannel === 'email'}
                      onClick={() => testTwilioChannel('email')}>
                      {testingChannel === 'email' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                      Probar email
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          <Button type="submit" disabled={twilioSaving} variant="outline" className="w-full gap-2">
            {twilioSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : twilioSaved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Send className="w-4 h-4" />}
            {twilioSaved ? 'Configuración guardada' : 'Guardar configuración Twilio'}
          </Button>
        </div>
      </form>

      {/* ── Tiempos de producción ─────────────────────────────────────────── */}
      <div className="border border-border rounded-xl p-4 space-y-4">
        <div>
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Tiempos de producción
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configura cuántos minutos debe durar cada etapa. El sistema avanzará automáticamente el pedido cuando se cumpla el tiempo.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { key: 'reception',   label: '🛒 Recepción',          desc: 'Desde que llega hasta que empieza preparación' },
            { key: 'preparation', label: '👨‍🍳 Preparación',         desc: 'Tiempo de cocción / elaboración del pedido' },
            { key: 'packaging',   label: '📦 Empaque',             desc: 'Empacar y alistar el pedido' },
            { key: 'handoff',     label: '🏠 Entrega en local',    desc: 'Para pedidos en local o para recoger' },
            { key: 'delivery',    label: '🛵 Domicilio',           desc: 'Tiempo de entrega a domicilio' },
          ] as const).map(({ key, label, desc }) => (
            <div key={key} className="space-y-1">
              <label className="text-xs font-medium">{label}</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={productionTimes[key]}
                  onChange={e => setProductionTimes(prev => ({ ...prev, [key]: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="w-20 border border-border rounded-lg px-3 py-1.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                  data-testid={`input-pt-${key}`}
                />
                <span className="text-xs text-muted-foreground">min</span>
              </div>
              <p className="text-[11px] text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
        <div className="bg-muted/40 rounded-lg px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-4">
          <span>⏱ Domicilio estimado: <strong>{productionTimes.reception + productionTimes.preparation + productionTimes.packaging + productionTimes.delivery} min</strong></span>
          <span>🏠 En local estimado: <strong>{productionTimes.reception + productionTimes.preparation + productionTimes.packaging + productionTimes.handoff} min</strong></span>
        </div>
        <Button onClick={savePt} disabled={ptSaving} variant="outline" className="w-full gap-2">
          {ptSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : ptSaved ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Zap className="w-4 h-4" />}
          {ptSaved ? 'Tiempos guardados' : 'Guardar tiempos de producción'}
        </Button>
      </div>
    </div>
  );
}
