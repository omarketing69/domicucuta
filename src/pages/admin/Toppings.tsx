import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';

type Topping = {
  id: string;
  business_id: string;
  name: string;
  price: number;
  is_active: boolean;
  position: number;
  created_at: string;
};

const EMPTY = { name: '', price: '0', is_active: true };

export default function Toppings() {
  const { business } = useBusiness();
  const [toppings, setToppings] = useState<Topping[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Topping | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!business) return;
    const { data } = await supabase
      .from('toppings')
      .select('*')
      .eq('business_id', business.id)
      .order('position');
    setToppings((data as Topping[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (t: Topping) => {
    setEditing(t);
    setForm({ name: t.name, price: String(t.price), is_active: t.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!business) return;
    setSaving(true);
    const payload = {
      name: form.name,
      price: parseFloat(form.price) || 0,
      is_active: form.is_active,
    };
    if (editing) {
      await supabase.from('toppings').update(payload).eq('id', editing.id);
    } else {
      await (supabase.from('toppings') as any).insert({
        ...payload,
        business_id: business.id,
        position: toppings.length,
      });
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este topping? Se eliminará de todos los productos que lo usen.')) return;
    await supabase.from('toppings').delete().eq('id', id);
    load();
  };

  const toggleActive = async (t: Topping) => {
    await supabase.from('toppings').update({ is_active: !t.is_active }).eq('id', t.id);
    setToppings(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !x.is_active } : x));
  };

  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Toppings / Ingredientes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea la lista de toppings y luego asígnalos a cada producto.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Nuevo topping
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : toppings.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground">Aún no tienes toppings.</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Agrega ingredientes extra como "Queso adicional", "Jalapeños", etc.
          </p>
          <Button onClick={openCreate} size="sm" className="mt-3">Agregar el primero</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {toppings.map(t => (
            <div key={t.id} className="card-elevated px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t.price > 0 ? `+${currencySymbol}${t.price.toFixed(2)}` : 'Sin costo adicional'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={t.is_active}
                  onCheckedChange={() => toggleActive(t)}
                  className="scale-75"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => remove(t.id)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar topping' : 'Nuevo topping'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Queso extra, Jalapeños..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Precio adicional ({currencySymbol})</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
              />
              <p className="text-xs text-muted-foreground">Deja en 0 si no tiene costo adicional.</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_active}
                onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))}
              />
              <Label>Activo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.name}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
