import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ChefHat, CheckCircle2, Sparkles, ShoppingBag, CalendarDays } from 'lucide-react';
import { TRIAL_DAYS } from '@/lib/planUtils';
import { cn } from '@/lib/utils';

type BusinessType = 'products' | 'reservations';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('products');
  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    whatsapp_number: '',
    address: '',
    currency: 'USD',
  });

  const handleSlug = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const trialExpires = new Date();
    trialExpires.setDate(trialExpires.getDate() + TRIAL_DAYS);

    const { error } = await supabase.from('businesses').insert({
      owner_id: user!.id,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      whatsapp_number: form.whatsapp_number,
      address: form.address || null,
      currency: form.currency,
      plan: 'pro',
      plan_expires_at: trialExpires.toISOString(),
      plan_started_at: new Date().toISOString(),
      business_type: businessType,
    } as any);

    if (error) {
      setError(error.code === '23505' ? 'El slug ya está en uso, elige otro.' : error.message);
      setLoading(false);
      return;
    }
    setStep(3);
    setTimeout(() => navigate('/admin/dashboard'), 2000);
  };

  // Step 3: success
  if (step === 3) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-violet-600" />
          </div>
          <h1 className="text-xl font-semibold mb-2">¡Tu negocio está listo!</h1>
          <div className="flex items-center justify-center gap-1.5 text-sm text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-4 py-2 mb-3">
            <Sparkles className="w-4 h-4 flex-shrink-0" />
            <span><strong>{TRIAL_DAYS} días de prueba gratis</strong> — acceso completo a todas las funciones</span>
          </div>
          <p className="text-sm text-muted-foreground">Redirigiendo al panel...</p>
        </div>
      </div>
    );
  }

  const LOGO = (
    <div className="flex items-center gap-2 justify-center mb-8">
      <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
        <ChefHat className="w-5 h-5 text-primary-foreground" />
      </div>
      <span className="text-xl font-semibold tracking-tight">WhatOrden</span>
    </div>
  );

  // Step 1: business type selection
  if (step === 1) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          {LOGO}
          <div className="card-elevated p-6">
            <h1 className="text-lg font-semibold mb-1">¿Qué tipo de negocio tienes?</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Esto determina cómo funciona tu página y el agente de WhatsApp.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              {/* Products card */}
              <button
                type="button"
                onClick={() => setBusinessType('products')}
                className={cn(
                  'flex flex-col items-center gap-3 p-5 rounded-xl border-2 text-left transition-all',
                  businessType === 'products'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50'
                )}
              >
                <div className={cn(
                  'w-14 h-14 rounded-xl flex items-center justify-center',
                  businessType === 'products' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                )}>
                  <ShoppingBag className="w-7 h-7" />
                </div>
                <div>
                  <p className="font-semibold text-base">🛍️ Venta de productos</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Restaurantes, cafeterías, tiendas. El cliente ve el catálogo y hace pedidos por WhatsApp.
                  </p>
                </div>
                {businessType === 'products' && (
                  <CheckCircle2 className="w-5 h-5 text-primary self-end" />
                )}
              </button>

              {/* Reservations card */}
              <button
                type="button"
                onClick={() => setBusinessType('reservations')}
                className={cn(
                  'flex flex-col items-center gap-3 p-5 rounded-xl border-2 text-left transition-all',
                  businessType === 'reservations'
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/20'
                    : 'border-border hover:border-violet-400/40 hover:bg-muted/50'
                )}
              >
                <div className={cn(
                  'w-14 h-14 rounded-xl flex items-center justify-center',
                  businessType === 'reservations' ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground'
                )}>
                  <CalendarDays className="w-7 h-7" />
                </div>
                <div>
                  <p className="font-semibold text-base">📅 Reservas y citas</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Salones de belleza, estéticas, spas, realidad virtual. El cliente reserva servicio, fecha y hora por WhatsApp.
                  </p>
                </div>
                {businessType === 'reservations' && (
                  <CheckCircle2 className="w-5 h-5 text-violet-500 self-end" />
                )}
              </button>
            </div>

            <Button className="w-full" onClick={() => setStep(2)}>
              Continuar
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: business details form
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {LOGO}

        <div className="card-elevated p-6">
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              ← Cambiar tipo
            </button>
            <span className="text-xs text-muted-foreground">|</span>
            <span className="text-xs text-muted-foreground">
              {businessType === 'products' ? '🛍️ Venta de productos' : '📅 Reservas y citas'}
            </span>
          </div>
          <h1 className="text-lg font-semibold mb-1">Configura tu negocio</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {businessType === 'products'
              ? 'Completa los datos para crear tu menú digital'
              : 'Completa los datos para crear tu página de reservas'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre del negocio *</Label>
              <Input
                placeholder={businessType === 'products' ? 'Ej: Pizza Casa Roma' : 'Ej: Salón Glamour, Spa Zen...'}
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: handleSlug(e.target.value) }))}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>{businessType === 'products' ? 'URL del menú *' : 'URL de tu página *'}</Label>
              <div className="flex items-center gap-0">
                <span className="px-3 py-2 text-sm bg-muted border border-border rounded-l-lg text-muted-foreground border-r-0">
                  whatorden.com/b/
                </span>
                <Input
                  className="rounded-l-none"
                  placeholder={businessType === 'products' ? 'pizza-casa-roma' : 'salon-glamour'}
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: handleSlug(e.target.value) }))}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">Solo letras, números y guiones</p>
            </div>

            <div className="space-y-1.5">
              <Label>WhatsApp {businessType === 'products' ? 'de pedidos' : 'de reservas'} *</Label>
              <Input
                placeholder="+52 55 1234 5678"
                value={form.whatsapp_number}
                onChange={e => setForm(f => ({ ...f, whatsapp_number: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea
                placeholder={
                  businessType === 'products'
                    ? 'Una breve descripción de tu negocio...'
                    : 'Describe los servicios que ofreces...'
                }
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <select
                className="w-full h-9 px-3 py-1 text-sm border border-input rounded-lg bg-background"
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
              >
                <option value="USD">USD — Dólar</option>
                <option value="MXN">MXN — Peso mexicano</option>
                <option value="EUR">EUR — Euro</option>
                <option value="COP">COP — Peso colombiano</option>
                <option value="ARS">ARS — Peso argentino</option>
              </select>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {businessType === 'products' ? 'Crear mi menú' : 'Crear mi página de reservas'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
