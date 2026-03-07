import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, CheckCircle2, Upload, X, Palette } from 'lucide-react';

const PRESET_COLORS = [
  '#f97316', '#ef4444', '#ec4899', '#a855f7',
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f59e0b', '#78716c',
];

export default function Settings() {
  const { business, refetch } = useBusiness();
  const { user } = useAuth();
  const [form, setForm] = useState({
    name: '', slug: '', description: '', whatsapp_number: '',
    address: '', currency: 'USD', primary_color: '#f97316', logo_url: '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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
      });
    }
  }, [business]);

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
    setSaving(false);
    setSaved(true);
    refetch();
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Datos y apariencia de tu negocio</p>
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
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                {uploading ? 'Subiendo...' : 'Subir imagen'}
              </Button>
              {form.logo_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={() => setForm(f => ({ ...f, logo_url: '' }))}
                >
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
            <div
              className="w-10 h-10 rounded-lg border border-border flex-shrink-0 cursor-pointer relative overflow-hidden"
              style={{ backgroundColor: form.primary_color }}
              onClick={() => document.getElementById('colorpicker')?.click()}
            >
              <input
                id="colorpicker"
                type="color"
                value={form.primary_color}
                onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
              />
            </div>
            <Input
              value={form.primary_color}
              onChange={e => setForm(f => ({ ...f, primary_color: e.target.value }))}
              placeholder="#f97316"
              className="font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-6 gap-2">
            {PRESET_COLORS.map(color => (
              <button
                key={color}
                type="button"
                title={color}
                className="w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110 focus:outline-none"
                style={{
                  backgroundColor: color,
                  borderColor: form.primary_color === color ? 'hsl(var(--foreground))' : 'transparent',
                }}
                onClick={() => setForm(f => ({ ...f, primary_color: color }))}
              />
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
        </div>

        <Button type="submit" disabled={saving} className="w-full">
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4 mr-2" /> : null}
          {saved ? 'Guardado' : 'Guardar cambios'}
        </Button>
      </form>
    </div>
  );
}
