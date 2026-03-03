import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2 } from 'lucide-react';

export default function Settings() {
  const { business, refetch } = useBusiness();
  const [form, setForm] = useState({ name: '', slug: '', description: '', whatsapp_number: '', address: '', currency: 'USD' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (business) {
      setForm({
        name: business.name,
        slug: business.slug,
        description: business.description || '',
        whatsapp_number: business.whatsapp_number,
        address: business.address || '',
        currency: business.currency,
      });
    }
  }, [business]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    setSaving(true);
    await supabase.from('businesses').update(form).eq('id', business.id);
    setSaving(false);
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Datos de tu negocio</p>
      </div>

      <form onSubmit={save} className="card-elevated p-6 space-y-4">
        <div className="space-y-1.5">
          <Label>Nombre del negocio *</Label>
          <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="space-y-1.5">
          <Label>Slug (URL)</Label>
          <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))} />
          <p className="text-xs text-muted-foreground">{window.location.origin}/b/{form.slug}</p>
        </div>
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
          <select
            className="w-full h-9 px-3 text-sm border border-input rounded-lg bg-background"
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

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4 mr-2" /> : null}
          {saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </form>
    </div>
  );
}
