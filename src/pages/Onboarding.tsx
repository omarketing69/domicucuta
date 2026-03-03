import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ChefHat, CheckCircle2 } from 'lucide-react';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

    const { error } = await supabase.from('businesses').insert({
      owner_id: user!.id,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      whatsapp_number: form.whatsapp_number,
      address: form.address || null,
      currency: form.currency,
    });

    if (error) {
      setError(error.code === '23505' ? 'El slug ya está en uso, elige otro.' : error.message);
      setLoading(false);
      return;
    }
    setStep(2);
    setTimeout(() => navigate('/admin/dashboard'), 2000);
  };

  if (step === 2) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-xl font-semibold mb-2">¡Tu negocio está listo!</h1>
          <p className="text-muted-foreground">Redirigiendo al panel...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-8">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
            <ChefHat className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold tracking-tight">MenuApp</span>
        </div>

        <div className="card-elevated p-6">
          <h1 className="text-lg font-semibold mb-1">Configura tu negocio</h1>
          <p className="text-sm text-muted-foreground mb-6">Completa los datos para crear tu menú digital</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nombre del negocio *</Label>
              <Input
                placeholder="Ej: Pizza Casa Roma"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value, slug: handleSlug(e.target.value) }))}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label>URL del menú *</Label>
              <div className="flex items-center gap-0">
                <span className="px-3 py-2 text-sm bg-muted border border-border rounded-l-lg text-muted-foreground border-r-0">
                  menuapp.com/b/
                </span>
                <Input
                  className="rounded-l-none"
                  placeholder="pizza-casa-roma"
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: handleSlug(e.target.value) }))}
                  required
                />
              </div>
              <p className="text-xs text-muted-foreground">Solo letras, números y guiones</p>
            </div>

            <div className="space-y-1.5">
              <Label>WhatsApp de pedidos *</Label>
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
                placeholder="Una breve descripción de tu negocio..."
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
              Crear mi menú
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
