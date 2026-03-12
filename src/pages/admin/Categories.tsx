import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, GripVertical } from 'lucide-react';
import { ImageUpload } from '@/components/ImageUpload';

type Category = Database['public']['Tables']['categories']['Row'];

const EMPTY: Omit<Database['public']['Tables']['categories']['Insert'], 'business_id'> = {
  name: '', description: '', image_url: '', position: 0, is_active: true,
};

export default function Categories() {
  const { business } = useBusiness();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!business) return;
    const { data } = await supabase.from('categories').select('*')
      .eq('business_id', business.id).order('position');
    setCategories(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({ name: c.name, description: c.description || '', image_url: c.image_url || '', position: c.position, is_active: c.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!business) return;
    setSaving(true);
    if (editing) {
      await supabase.from('categories').update({ ...form }).eq('id', editing.id);
    } else {
      await supabase.from('categories').insert({ ...form, business_id: business.id, position: categories.length });
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar esta categoría?')) return;
    await supabase.from('categories').delete().eq('id', id);
    load();
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categorías</h1>
          <p className="text-muted-foreground text-sm mt-1">{categories.length} categorías</p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Nueva categoría
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : categories.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground">Aún no tienes categorías.</p>
          <Button onClick={openCreate} size="sm" className="mt-3">Crear la primera</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map(cat => (
            <div key={cat.id} className="card-elevated px-4 py-3 flex items-center gap-3">
              <GripVertical className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />
              {cat.image_url ? (
                <img src={cat.image_url} alt={cat.name} className="w-8 h-8 rounded-md object-cover flex-shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-md bg-muted flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{cat.name}</p>
                {cat.description && <p className="text-xs text-muted-foreground truncate">{cat.description}</p>}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(cat)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(cat.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar categoría' : 'Nueva categoría'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Bebidas" />
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Imagen de categoría</Label>
              <ImageUpload
                value={form.image_url || ''}
                onChange={url => setForm(f => ({ ...f, image_url: url }))}
                folder="categories"
              />
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
