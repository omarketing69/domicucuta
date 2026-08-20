import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Loader2, Clock, Users, FolderOpen, X, GripVertical } from 'lucide-react';
import { ImageUpload } from '@/components/ImageUpload';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type ServiceCategory = {
  id: string;
  business_id: string;
  name: string;
  position: number;
};

type Service = {
  id: string;
  business_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  max_persons: number;
  image_url: string | null;
  is_available: boolean;
  position: number;
};

const EMPTY_SERVICE = {
  name: '',
  description: '',
  price: '',
  duration_minutes: '60',
  max_persons: '1',
  image_url: '',
  is_available: true,
  category_id: '',
};

export default function Servicios() {
  const { business } = useBusiness();
  const { toast } = useToast();

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  // Service dialog
  const [serviceOpen, setServiceOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState<typeof EMPTY_SERVICE>(EMPTY_SERVICE);
  const [saving, setSaving] = useState(false);

  // Category dialog
  const [catOpen, setCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [editingCat, setEditingCat] = useState<ServiceCategory | null>(null);
  const [editCatName, setEditCatName] = useState('');

  const load = async () => {
    if (!business) return;
    const [catRes, svcRes] = await Promise.all([
      (supabase as any).from('service_categories').select('*').eq('business_id', business.id).order('position'),
      (supabase as any).from('services').select('*').eq('business_id', business.id).order('position'),
    ]);
    setCategories(catRes.data || []);
    setServices(svcRes.data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  /* ── Category actions ─────────────────────────────────────────────── */
  const addCategory = async () => {
    if (!business || !newCatName.trim()) return;
    setCatSaving(true);
    const { error } = await (supabase as any).from('service_categories').insert({
      business_id: business.id,
      name: newCatName.trim(),
      position: categories.length,
    });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      setNewCatName('');
      load();
    }
    setCatSaving(false);
  };

  const startEditCat = (cat: ServiceCategory) => {
    setEditingCat(cat);
    setEditCatName(cat.name);
  };

  const saveEditCat = async () => {
    if (!editingCat || !editCatName.trim()) return;
    setCatSaving(true);
    await (supabase as any).from('service_categories').update({ name: editCatName.trim() }).eq('id', editingCat.id);
    setEditingCat(null);
    load();
    setCatSaving(false);
  };

  const deleteCategory = async (id: string) => {
    const count = services.filter(s => s.category_id === id).length;
    const label = count > 0 ? `¿Eliminar esta categoría? Los ${count} servicios asociados quedarán sin categoría.` : '¿Eliminar esta categoría?';
    if (!confirm(label)) return;
    await (supabase as any).from('service_categories').delete().eq('id', id);
    load();
  };

  /* ── Service actions ─────────────────────────────────────────────── */
  const openCreate = () => {
    setEditingService(null);
    setServiceForm(EMPTY_SERVICE);
    setServiceOpen(true);
  };

  const openEdit = (s: Service) => {
    setEditingService(s);
    setServiceForm({
      name: s.name,
      description: s.description || '',
      price: String(s.price),
      duration_minutes: String(s.duration_minutes),
      max_persons: String(s.max_persons),
      image_url: s.image_url || '',
      is_available: s.is_available,
      category_id: s.category_id || '',
    });
    setServiceOpen(true);
  };

  const saveService = async () => {
    if (!business) return;
    setSaving(true);
    try {
      const payload = {
        name: serviceForm.name.trim(),
        description: serviceForm.description.trim() || null,
        price: parseFloat(serviceForm.price) || 0,
        duration_minutes: parseInt(serviceForm.duration_minutes) || 60,
        max_persons: parseInt(serviceForm.max_persons) || 1,
        image_url: serviceForm.image_url || null,
        is_available: serviceForm.is_available,
        category_id: serviceForm.category_id || null,
      };
      if (editingService) {
        const { error } = await (supabase as any).from('services').update(payload).eq('id', editingService.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('services').insert({ ...payload, business_id: business.id, position: services.length });
        if (error) throw error;
      }
      toast({ title: 'Servicio guardado' });
      setServiceOpen(false);
      load();
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const removeService = async (id: string) => {
    if (!confirm('¿Eliminar este servicio?')) return;
    await (supabase as any).from('services').delete().eq('id', id);
    load();
  };

  const toggleAvailable = async (service: Service) => {
    await (supabase as any).from('services').update({ is_available: !service.is_available }).eq('id', service.id);
    setServices(prev => prev.map(s => s.id === service.id ? { ...s, is_available: !s.is_available } : s));
  };

  /* ── Derived data ─────────────────────────────────────────────────── */
  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  // Group services: by category (ordered), then uncategorised
  const grouped: Array<{ cat: ServiceCategory | null; items: Service[] }> = [];
  for (const cat of categories) {
    const items = services.filter(s => s.category_id === cat.id);
    if (items.length > 0) grouped.push({ cat, items });
  }
  const uncategorised = services.filter(s => !s.category_id);
  if (uncategorised.length > 0) grouped.push({ cat: null, items: uncategorised });
  // If no categories exist, show all flat
  const showFlat = categories.length === 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Servicios</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {services.length} servicio{services.length !== 1 ? 's' : ''}
            {categories.length > 0 && ` · ${categories.length} categoría${categories.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCatOpen(true)}>
            <FolderOpen className="w-4 h-4 mr-1.5" /> Categorías
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1.5" /> Nuevo servicio
          </Button>
        </div>
      </div>

      {/* Services list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : services.length === 0 ? (
        <div className="card-elevated p-12 text-center space-y-3">
          <p className="text-muted-foreground">Aún no tienes servicios.</p>
          <div className="flex justify-center gap-2">
            {categories.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => setCatOpen(true)}>
                <FolderOpen className="w-4 h-4 mr-1.5" /> Crear categorías primero
              </Button>
            )}
            <Button size="sm" onClick={openCreate}>Agregar el primero</Button>
          </div>
        </div>
      ) : showFlat ? (
        <div className="space-y-2">
          {services.map(service => (
            <ServiceRow
              key={service.id}
              service={service}
              currencySymbol={currencySymbol}
              onEdit={openEdit}
              onDelete={removeService}
              onToggle={toggleAvailable}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(({ cat, items }) => (
            <div key={cat?.id ?? 'uncat'}>
              <div className="flex items-center gap-2 mb-2">
                <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {cat ? cat.name : 'Sin categoría'}
                </h3>
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map(service => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    currencySymbol={currencySymbol}
                    onEdit={openEdit}
                    onDelete={removeService}
                    onToggle={toggleAvailable}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Service dialog ─────────────────────────────────────────────── */}
      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingService ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">

            {/* Category selector */}
            {categories.length > 0 && (
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select
                  value={serviceForm.category_id || '__none__'}
                  onValueChange={v => setServiceForm(f => ({ ...f, category_id: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin categoría</SelectItem>
                    {categories.map(cat => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Nombre del servicio *</Label>
              <Input
                value={serviceForm.name}
                onChange={e => setServiceForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ej: Experiencia VR 20 min, Masaje relajante..."
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Descripción</Label>
              <Textarea
                value={serviceForm.description}
                onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
                placeholder="Describe qué incluye el servicio..."
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Precio</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={serviceForm.price}
                  onChange={e => setServiceForm(f => ({ ...f, price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Duración (min)</Label>
                <Input
                  type="number" min="5" step="5"
                  value={serviceForm.duration_minutes}
                  onChange={e => setServiceForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  placeholder="60"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. personas</Label>
                <Input
                  type="number" min="1"
                  value={serviceForm.max_persons}
                  onChange={e => setServiceForm(f => ({ ...f, max_persons: e.target.value }))}
                  placeholder="1"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Imagen del servicio</Label>
              <ImageUpload
                value={serviceForm.image_url}
                onChange={url => setServiceForm(f => ({ ...f, image_url: url }))}
                folder="products"
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={serviceForm.is_available}
                onCheckedChange={v => setServiceForm(f => ({ ...f, is_available: v }))}
              />
              <Label>Disponible para reservas</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceOpen(false)}>Cancelar</Button>
            <Button onClick={saveService} disabled={saving || !serviceForm.name.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {editingService ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Categories dialog ─────────────────────────────────────────── */}
      <Dialog open={catOpen} onOpenChange={v => { setCatOpen(v); if (!v) { setEditingCat(null); setNewCatName(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" /> Categorías de servicios
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Existing categories */}
            {categories.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-3">
                Aún no tienes categorías. Crea una abajo.
              </p>
            ) : (
              <div className="space-y-2">
                {categories.map(cat => (
                  <div key={cat.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-muted/30">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    {editingCat?.id === cat.id ? (
                      <Input
                        value={editCatName}
                        onChange={e => setEditCatName(e.target.value)}
                        className="h-7 text-sm flex-1"
                        autoFocus
                        onKeyDown={e => { if (e.key === 'Enter') saveEditCat(); if (e.key === 'Escape') setEditingCat(null); }}
                      />
                    ) : (
                      <span className="flex-1 text-sm font-medium">{cat.name}</span>
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {editingCat?.id === cat.id ? (
                        <>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-green-600" onClick={saveEditCat} disabled={catSaving}>
                            {catSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className="text-xs font-bold">✓</span>}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditingCat(null)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => startEditCat(cat)}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => deleteCategory(cat.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add new category */}
            <div className="space-y-1.5">
              <Label className="text-xs">Nueva categoría</Label>
              <div className="flex gap-2">
                <Input
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="Ej: Realidad Virtual, Spa, Masajes..."
                  className="h-9 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
                />
                <Button size="sm" onClick={addCategory} disabled={catSaving || !newCatName.trim()} className="flex-shrink-0">
                  {catSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Service row component ──────────────────────────────────────────── */
function ServiceRow({
  service, currencySymbol, onEdit, onDelete, onToggle,
}: {
  service: Service;
  currencySymbol: string;
  onEdit: (s: Service) => void;
  onDelete: (id: string) => void;
  onToggle: (s: Service) => void;
}) {
  return (
    <div className={cn(
      'card-elevated px-4 py-3 flex items-center gap-3 transition-opacity',
      !service.is_available && 'opacity-60'
    )}>
      {service.image_url ? (
        <img src={service.image_url} alt={service.name} className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Clock className="w-5 h-5 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">{service.name}</p>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-primary">{currencySymbol}{service.price.toFixed(2)}</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {service.duration_minutes} min</span>
          <span className="flex items-center gap-1"><Users className="w-3 h-3" /> máx. {service.max_persons}</span>
        </div>
        {service.description && (
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{service.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Switch checked={service.is_available} onCheckedChange={() => onToggle(service)} className="scale-75" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(service)}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDelete(service.id)}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
