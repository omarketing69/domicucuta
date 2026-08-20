import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { FLAVOR_PREFIX, stripFlavorPrefix, addFlavorPrefix } from '@/lib/flavorUtils';

type Flavor = {
  id: string;
  business_id: string;
  name: string;       // stored with __SABOR__ prefix
  displayName: string; // shown to admin (prefix stripped)
  price: number;
  is_active: boolean;
  position: number;
};

const EMPTY = { name: '', price: '0', is_active: true };

export default function Flavors() {
  const { business } = useBusiness();
  const { toast } = useToast();
  const [flavors, setFlavors] = useState<Flavor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Flavor | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!business) return;
    setLoading(true);
    const { data } = await supabase
      .from('toppings')
      .select('*')
      .eq('business_id', business.id)
      .like('name', `${FLAVOR_PREFIX}%`)
      .order('position');

    setFlavors(
      ((data as any[]) || []).map(row => ({
        ...row,
        displayName: stripFlavorPrefix(row.name),
      }))
    );
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (f: Flavor) => {
    setEditing(f);
    setForm({ name: f.displayName, price: String(f.price), is_active: f.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!business) return;
    setSaving(true);
    const payload = {
      name: addFlavorPrefix(form.name),
      price: parseFloat(form.price) || 0,
      is_active: form.is_active,
    };
    let error: any = null;
    if (editing) {
      const res = await supabase.from('toppings').update(payload).eq('id', editing.id);
      error = res.error;
    } else {
      const res = await (supabase.from('toppings') as any).insert({
        ...payload,
        business_id: business.id,
        position: flavors.length,
      });
      error = res.error;
    }
    setSaving(false);
    if (error) {
      toast({ title: 'Error al guardar', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: editing ? 'Sabor actualizado' : 'Sabor creado', description: `"${form.name}" guardado correctamente.` });
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este sabor? Se eliminará de todos los productos que lo usen.')) return;
    const { error } = await supabase.from('toppings').delete().eq('id', id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const toggleActive = async (f: Flavor) => {
    await supabase.from('toppings').update({ is_active: !f.is_active }).eq('id', f.id);
    setFlavors(prev => prev.map(x => x.id === f.id ? { ...x, is_active: !x.is_active } : x));
  };

  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sabores</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea la lista de sabores disponibles y luego asígnalos a cada producto.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Nuevo sabor
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : flavors.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground">Aún no tienes sabores.</p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            Agrega opciones de sabores como "Chocolate", "Vainilla", "Fresa", etc.
          </p>
          <Button onClick={openCreate} size="sm" className="mt-3">Agregar el primero</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {flavors.map(f => (
            <div key={f.id} className="card-elevated px-4 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{f.displayName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {f.price > 0 ? `+${currencySymbol}${f.price.toFixed(2)}` : 'Sin costo adicional'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={f.is_active}
                  onCheckedChange={() => toggleActive(f)}
                  className="scale-75"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => remove(f.id)}
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
            <DialogTitle>{editing ? 'Editar sabor' : 'Nuevo sabor'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Chocolate, Vainilla, Fresa..."
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
