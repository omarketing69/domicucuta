import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Pencil, Trash2, Loader2, ChefHat, Flame } from 'lucide-react';
import { ImageUpload } from '@/components/ImageUpload';
import { FLAVOR_PREFIX, stripFlavorPrefix, isFlavor, isTopping } from '@/lib/flavorUtils';
import { useToast } from '@/hooks/use-toast';

type Product = Database['public']['Tables']['products']['Row'];
type Category = Database['public']['Tables']['categories']['Row'];

type Topping = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
};

type Flavor = {
  id: string;
  name: string;
  price: number;
  is_active: boolean;
};

const EMPTY = {
  name: '', description: '', price: '', category_id: '', image_url: '', is_available: true,
  uses_toppings: false, selected_topping_ids: [] as string[],
  uses_flavors: false, selected_flavor_ids: [] as string[],
  allows_half_half: false,
};

export default function Products() {
  const { business } = useBusiness();
  const { toast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [toppings, setToppings] = useState<Topping[]>([]);
  const [flavors, setFlavors] = useState<Flavor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!business) return;
    const [p, c, allToppings] = await Promise.all([
      supabase.from('products').select('*').eq('business_id', business.id).order('position'),
      supabase.from('categories').select('*').eq('business_id', business.id).order('position'),
      (supabase.from('toppings') as any).select('*').eq('business_id', business.id).order('position'),
    ]);
    setProducts(p.data || []);
    setCategories(c.data || []);
    const all: Topping[] = allToppings.data || [];
    setToppings(all.filter(t => isTopping(t.name)));
    setFlavors(all.filter(t => isFlavor(t.name)).map(t => ({ ...t, name: stripFlavorPrefix(t.name) })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };

  const openEdit = async (p: Product) => {
    setEditing(p);
    // Load product_toppings links split by flavor prefix
    const ptRes = await (supabase.from('product_toppings') as any)
      .select('topping_id, toppings(id, name)')
      .eq('product_id', p.id);

    const toppingIds: string[] = [];
    const flavorIds: string[] = [];
    (ptRes.data || []).forEach((row: any) => {
      if (!row.toppings) return;
      if (isFlavor(row.toppings.name)) flavorIds.push(row.topping_id);
      else toppingIds.push(row.topping_id);
    });

    setForm({
      name: p.name,
      description: p.description || '',
      price: String(p.price),
      category_id: p.category_id || '',
      image_url: p.image_url || '',
      is_available: p.is_available,
      // Read flags directly from the product row (not derived from product_toppings count)
      uses_toppings: (p as any).uses_toppings ?? toppingIds.length > 0,
      selected_topping_ids: toppingIds,
      uses_flavors: (p as any).uses_flavors ?? flavorIds.length > 0,
      selected_flavor_ids: flavorIds,
      allows_half_half: (p as any).allows_half_half ?? false,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!business) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description || null,
        price: parseFloat(form.price),
        category_id: form.category_id || null,
        image_url: form.image_url || null,
        is_available: form.is_available,
        uses_toppings: form.uses_toppings,
        uses_flavors: form.uses_flavors,
        allows_half_half: form.allows_half_half,
      };

      let productId = editing?.id;

      if (editing) {
        const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('products')
          .insert({ ...payload, business_id: business.id, position: products.length })
          .select()
          .single();
        if (error) throw error;
        productId = data?.id;
      }

      if (productId) {
        const { error: delError } = await (supabase.from('product_toppings') as any).delete().eq('product_id', productId);
        if (delError) throw delError;

        const allLinks: { product_id: string; topping_id: string }[] = [];
        if (form.uses_toppings && form.selected_topping_ids.length > 0) {
          form.selected_topping_ids.forEach(tid => allLinks.push({ product_id: productId!, topping_id: tid }));
        }
        if (form.uses_flavors && form.selected_flavor_ids.length > 0) {
          form.selected_flavor_ids.forEach(fid => allLinks.push({ product_id: productId!, topping_id: fid }));
        }
        if (allLinks.length > 0) {
          const { error: insError } = await (supabase.from('product_toppings') as any).insert(allLinks);
          if (insError) throw insError;
        }
      }

      toast({ title: 'Producto guardado', description: 'Los cambios se guardaron correctamente.' });
      setOpen(false);
      load();
    } catch (err: any) {
      console.error('Error saving product:', err);
      toast({
        title: 'Error al guardar',
        description: err?.message || 'No se pudo guardar el producto. Intenta de nuevo.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('¿Eliminar este producto?')) return;
    await supabase.from('products').delete().eq('id', id);
    load();
  };

  const toggleAvailable = async (product: Product) => {
    await supabase.from('products').update({ is_available: !product.is_available }).eq('id', product.id);
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, is_available: !p.is_available } : p));
  };

  const toggleToppingId = (id: string) => {
    setForm(f => ({
      ...f,
      selected_topping_ids: f.selected_topping_ids.includes(id)
        ? f.selected_topping_ids.filter(x => x !== id)
        : [...f.selected_topping_ids, id],
    }));
  };

  const toggleFlavorId = (id: string) => {
    setForm(f => ({
      ...f,
      selected_flavor_ids: f.selected_flavor_ids.includes(id)
        ? f.selected_flavor_ids.filter(x => x !== id)
        : [...f.selected_flavor_ids, id],
    }));
  };

  const getCategoryName = (id: string | null) => categories.find(c => c.id === id)?.name;
  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'MXN' ? '$' : currency;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
          <p className="text-muted-foreground text-sm mt-1">{products.length} productos</p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="w-4 h-4 mr-1.5" /> Nuevo producto
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : products.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground">Aún no tienes productos.</p>
          <Button onClick={openCreate} size="sm" className="mt-3">Agregar el primero</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {products.map(product => (
            <div key={product.id} className="card-elevated px-4 py-3 flex items-center gap-3">
              {product.image_url ? (
                <img src={product.image_url} alt={product.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-muted flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <p className="font-medium text-sm" translate="no">{product.name}</p>
                  {product.category_id && (
                    <span className="text-xs text-muted-foreground">{getCategoryName(product.category_id)}</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-primary">{currencySymbol}{product.price.toFixed(2)}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Switch
                  checked={product.is_available}
                  onCheckedChange={() => toggleAvailable(product)}
                  className="scale-75"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(product)}>
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(product.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar producto' : 'Nuevo producto'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Ej: Pizza Margherita" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Precio *</Label>
                <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <select
                  className="w-full h-9 px-3 text-sm border border-input rounded-lg bg-background"
                  value={form.category_id}
                  onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                >
                  <option value="">Sin categoría</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} placeholder="Ingredientes, alérgenos..." />
            </div>
            <div className="space-y-1.5">
              <Label>Imagen del producto</Label>
              <ImageUpload
                value={form.image_url}
                onChange={url => setForm(f => ({ ...f, image_url: url }))}
                folder="products"
              />
            </div>

            {/* Flavors section */}
            <div className="border border-border rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.uses_flavors}
                  onCheckedChange={v => setForm(f => ({ ...f, uses_flavors: v, selected_flavor_ids: v ? f.selected_flavor_ids : [] }))}
                />
                <div>
                  <Label className="flex items-center gap-1.5 cursor-pointer">
                    <Flame className="w-3.5 h-3.5" />
                    Este producto tiene sabores
                  </Label>
                  <p className="text-xs text-muted-foreground">El cliente debe elegir un sabor antes de agregar al carrito</p>
                </div>
              </div>

              {form.uses_flavors && (
                <div className="space-y-3 pt-1">
                  {flavors.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No hay sabores creados. Ve a <strong>Sabores</strong> en el menú para agregarlos.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground font-medium">Selecciona los sabores disponibles para este producto:</p>
                      <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                        {flavors.map(fl => (
                          <label key={fl.id} className="flex items-center gap-2 cursor-pointer text-sm p-1.5 rounded hover:bg-muted/50">
                            <Checkbox
                              checked={form.selected_flavor_ids.includes(fl.id)}
                              onCheckedChange={() => toggleFlavorId(fl.id)}
                            />
                            <span className="flex-1 min-w-0 truncate">{fl.name}</span>
                            {fl.price > 0 && (
                              <span className="text-xs text-muted-foreground flex-shrink-0">+{currencySymbol}{fl.price.toFixed(2)}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                  {/* Mitad y mitad option */}
                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <Switch
                      checked={form.allows_half_half}
                      onCheckedChange={v => setForm(f => ({ ...f, allows_half_half: v }))}
                    />
                    <div>
                      <Label className="text-sm cursor-pointer">Permitir mitad y mitad</Label>
                      <p className="text-xs text-muted-foreground">El cliente podrá elegir un sabor diferente para cada mitad</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Toppings section */}
            <div className="border border-border rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.uses_toppings}
                  onCheckedChange={v => setForm(f => ({ ...f, uses_toppings: v, selected_topping_ids: v ? f.selected_topping_ids : [] }))}
                />
                <div>
                  <Label className="flex items-center gap-1.5 cursor-pointer">
                    <ChefHat className="w-3.5 h-3.5" />
                    Este producto permite toppings
                  </Label>
                  <p className="text-xs text-muted-foreground">El cliente podrá elegir ingredientes extras</p>
                </div>
              </div>

              {form.uses_toppings && (
                <div className="space-y-2 pt-1">
                  {toppings.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No hay toppings creados. Ve a <strong>Toppings</strong> en el menú para agregarlos.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-muted-foreground font-medium">Selecciona los toppings disponibles para este producto:</p>
                      <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                        {toppings.map(t => (
                          <label key={t.id} className="flex items-center gap-2 cursor-pointer text-sm p-1.5 rounded hover:bg-muted/50">
                            <Checkbox
                              checked={form.selected_topping_ids.includes(t.id)}
                              onCheckedChange={() => toggleToppingId(t.id)}
                            />
                            <span className="flex-1 min-w-0 truncate">{t.name}</span>
                            {t.price > 0 && (
                              <span className="text-xs text-muted-foreground flex-shrink-0">+{currencySymbol}{t.price.toFixed(2)}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_available} onCheckedChange={v => setForm(f => ({ ...f, is_available: v }))} />
              <Label>Disponible</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} disabled={saving || !form.name || !form.price}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editing ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
