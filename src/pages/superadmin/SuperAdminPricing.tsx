import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Save, Sparkles, Zap, Crown, Eye, Check, ArrowRight,
  Plus, Trash2, ChevronUp, ChevronDown, Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlanData {
  id: string;
  label: string;
  price_monthly: number;
  description: string | null;
  is_active: boolean;
  features: string[];
  badge_text: string | null;
  period_text: string | null;
  cta_text: string | null;
  highlight: boolean;
  max_products: number | null;
  max_orders_monthly: number | null;
}

const PLAN_ICONS: Record<string, typeof Sparkles> = {
  free: Sparkles,
  starter: Zap,
  pro: Crown,
};

const PLAN_TAB_COLORS: Record<string, string> = {
  free: 'data-[active=true]:border-gray-400 data-[active=true]:text-gray-700',
  starter: 'data-[active=true]:border-primary data-[active=true]:text-primary',
  pro: 'data-[active=true]:border-amber-500 data-[active=true]:text-amber-600',
};

// ── PricingCardPreview ────────────────────────────────────────────────────────
function PricingCardPreview({ plan }: { plan: PlanData }) {
  const Icon = PLAN_ICONS[plan.id] ?? Sparkles;
  const price = plan.price_monthly;
  const highlight = plan.highlight;

  return (
    <div className="relative">
      <div
        className={cn(
          'relative rounded-2xl border p-6 flex flex-col gap-5 transition-shadow',
          highlight
            ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/30'
            : 'border-border bg-card shadow-sm'
        )}
      >
        {plan.badge_text && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full shadow">
              {plan.badge_text}
            </span>
          </div>
        )}

        {/* Header */}
        <div>
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center mb-4',
            highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
          )}>
            <Icon className="w-5 h-5" />
          </div>
          <h2 className="text-xl font-semibold">{plan.label || '—'}</h2>
          <p className="text-sm text-muted-foreground mt-1">{plan.description || 'Sin descripción'}</p>
        </div>

        {/* Price */}
        <div>
          <div className="flex items-baseline gap-1">
            {price === 0 ? (
              <span className="text-4xl font-bold">$0 usd</span>
            ) : (
              <>
                <span className="text-2xl font-semibold text-muted-foreground">$</span>
                <span className="text-4xl font-bold">{price} usd</span>
              </>
            )}
            <span className="text-muted-foreground text-sm">/ {plan.period_text || 'mes'}</span>
          </div>
          {price === 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">Sin tarjeta de crédito</p>
          )}
        </div>

        {/* CTA */}
        <Button
          variant={highlight ? 'default' : 'outline'}
          className="w-full pointer-events-none"
          tabIndex={-1}
        >
          <span className="flex items-center gap-2">
            {plan.cta_text || 'Elegir plan'}
            <ArrowRight className="w-4 h-4" />
          </span>
        </Button>

        {/* Features */}
        <ul className="space-y-2.5">
          {(plan.features ?? []).map((feature, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm">
              <Check className={cn('w-4 h-4 mt-0.5 flex-shrink-0', highlight ? 'text-primary' : 'text-muted-foreground')} />
              <span className={highlight ? 'text-foreground' : 'text-muted-foreground'}>{feature}</span>
            </li>
          ))}
          {(plan.features ?? []).length === 0 && (
            <li className="text-xs text-muted-foreground italic">Sin beneficios aún</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// ── FeaturesEditor ────────────────────────────────────────────────────────────
function FeaturesEditor({
  features,
  onChange,
}: {
  features: string[];
  onChange: (f: string[]) => void;
}) {
  const update = (i: number, val: string) => {
    const next = [...features];
    next[i] = val;
    onChange(next);
  };
  const remove = (i: number) => onChange(features.filter((_, idx) => idx !== i));
  const add = () => onChange([...features, '']);
  const move = (i: number, dir: -1 | 1) => {
    const next = [...features];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-2">
      {features.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
            >
              <ChevronUp className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === features.length - 1}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-20"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
          <Input
            value={f}
            onChange={e => update(i, e.target.value)}
            placeholder={`Beneficio ${i + 1}`}
            className="flex-1 h-8 text-sm"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1.5 w-full h-8 text-xs" onClick={add}>
        <Plus className="w-3 h-3" /> Añadir beneficio
      </Button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SuperAdminPricing() {
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [edits, setEdits] = useState<Record<string, PlanData>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('free');
  const [showPreview, setShowPreview] = useState(true);

  useEffect(() => {
    supabase
      .from('plan_pricing')
      .select('*')
      .order('price_monthly', { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as PlanData[];
        setPlans(rows);
        const initEdits: Record<string, PlanData> = {};
        rows.forEach(p => { initEdits[p.id] = { ...p, features: p.features ?? [] }; });
        setEdits(initEdits);
        if (rows.length > 0) setActiveTab(rows[0].id);
      });
  }, []);

  const setField = useCallback(<K extends keyof PlanData>(id: string, field: K, value: PlanData[K]) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }, []);

  const isDirty = (id: string) => {
    const original = plans.find(p => p.id === id);
    const edited = edits[id];
    if (!original || !edited) return false;
    return JSON.stringify(original) !== JSON.stringify(edited);
  };

  const save = async (id: string) => {
    const edited = edits[id];
    if (!edited) return;
    setSaving(id);

    const payload = {
      label: edited.label,
      price_monthly: edited.price_monthly,
      description: edited.description,
      features: edited.features,
      badge_text: edited.badge_text || null,
      period_text: edited.period_text || 'mes',
      cta_text: edited.cta_text || null,
      highlight: edited.highlight,
      max_products: edited.max_products,
      max_orders_monthly: edited.max_orders_monthly,
      is_active: edited.is_active,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('plan_pricing')
      .update(payload)
      .eq('id', id);

    if (error) {
      toast.error('Error al publicar cambios');
    } else {
      setPlans(prev => prev.map(p => p.id === id ? { ...p, ...payload } : p));
      toast.success(`Plan "${edited.label}" publicado en la página de precios`);
    }
    setSaving(null);
  };

  const activePlan = edits[activeTab];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Precios de planes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Edita el contenido de cada plan y publica los cambios. La página pública se actualiza en tiempo real.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 flex-shrink-0"
          onClick={() => setShowPreview(v => !v)}
        >
          <Eye className="w-3.5 h-3.5" />
          {showPreview ? 'Ocultar vista previa' : 'Mostrar vista previa'}
        </Button>
      </div>

      {/* Plan tabs */}
      <div className="flex gap-0 border-b border-border">
        {plans.map(plan => {
          const Icon = PLAN_ICONS[plan.id] ?? Sparkles;
          const dirty = isDirty(plan.id);
          return (
            <button
              key={plan.id}
              data-active={activeTab === plan.id}
              onClick={() => setActiveTab(plan.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5',
                activeTab === plan.id
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {plan.label}
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Cambios sin publicar" />}
            </button>
          );
        })}
      </div>

      {/* Editor + Preview */}
      {activePlan && (
        <div className={cn('gap-6', showPreview ? 'grid lg:grid-cols-2' : 'grid grid-cols-1 max-w-2xl')}>
          {/* ── FORM ── */}
          <div className="space-y-5">
            <div className="card-elevated rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Información básica</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Nombre del plan</label>
                  <Input
                    value={activePlan.label}
                    onChange={e => setField(activeTab, 'label', e.target.value)}
                    placeholder="Ej: Starter"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Precio mensual (USD)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={activePlan.price_monthly}
                      onChange={e => setField(activeTab, 'price_monthly', parseFloat(e.target.value) || 0)}
                      className="pl-7"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Descripción breve</label>
                <Textarea
                  value={activePlan.description ?? ''}
                  onChange={e => setField(activeTab, 'description', e.target.value)}
                  placeholder="Frase corta que aparece debajo del nombre del plan..."
                  rows={2}
                  className="resize-none text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Periodo</label>
                  <Input
                    value={activePlan.period_text ?? ''}
                    onChange={e => setField(activeTab, 'period_text', e.target.value)}
                    placeholder="mes / 30 días / año..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Texto del botón (CTA)</label>
                  <Input
                    value={activePlan.cta_text ?? ''}
                    onChange={e => setField(activeTab, 'cta_text', e.target.value)}
                    placeholder="Ej: Elegir Starter"
                  />
                </div>
              </div>
            </div>

            <div className="card-elevated rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Destacado y etiqueta</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Etiqueta (badge)</label>
                  <Input
                    value={activePlan.badge_text ?? ''}
                    onChange={e => setField(activeTab, 'badge_text', e.target.value || null as any)}
                    placeholder="Ej: Más popular"
                  />
                </div>
                <div className="flex flex-col justify-end gap-1.5">
                  <label className="text-sm font-medium">Plan destacado</label>
                  <button
                    type="button"
                    onClick={() => setField(activeTab, 'highlight', !activePlan.highlight)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
                      activePlan.highlight
                        ? 'bg-primary/10 border-primary/40 text-primary font-medium'
                        : 'bg-muted/40 border-border text-muted-foreground hover:border-foreground/30'
                    )}
                  >
                    <Star className={cn('w-4 h-4', activePlan.highlight ? 'fill-primary text-primary' : '')} />
                    {activePlan.highlight ? 'Destacado activo' : 'Sin destacar'}
                  </button>
                </div>
              </div>
            </div>

            <div className="card-elevated rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Límites técnicos</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Máx. productos</label>
                  <Input
                    type="number"
                    min={0}
                    value={activePlan.max_products ?? ''}
                    onChange={e => setField(activeTab, 'max_products', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="Sin límite"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Máx. pedidos/mes</label>
                  <Input
                    type="number"
                    min={0}
                    value={activePlan.max_orders_monthly ?? ''}
                    onChange={e => setField(activeTab, 'max_orders_monthly', e.target.value ? parseInt(e.target.value) : null)}
                    placeholder="Sin límite"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Estos límites se usan internamente para validar acceso — no aparecen en la página pública.</p>
            </div>

            <div className="card-elevated rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Beneficios <span className="normal-case font-normal text-muted-foreground">({activePlan.features?.length ?? 0} items)</span>
              </h2>
              <FeaturesEditor
                features={activePlan.features ?? []}
                onChange={f => setField(activeTab, 'features', f)}
              />
            </div>

            {/* Publish button */}
            <div className="flex items-center justify-between gap-4 pt-1">
              {isDirty(activeTab) && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                  Cambios sin publicar
                </p>
              )}
              <div className="ml-auto">
                <Button
                  onClick={() => save(activeTab)}
                  disabled={!isDirty(activeTab) || saving === activeTab}
                  className="gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving === activeTab ? 'Publicando...' : 'Publicar cambios'}
                </Button>
              </div>
            </div>
          </div>

          {/* ── PREVIEW ── */}
          {showPreview && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Vista previa — así se verá en la página pública</span>
              </div>
              <PricingCardPreview plan={activePlan} />
              <p className="text-xs text-muted-foreground text-center">
                La vista previa se actualiza en tiempo real mientras editas
              </p>
            </div>
          )}
        </div>
      )}

      <div className="card-elevated p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">💡 Renovación de pagos</p>
        <p>Cuando un cliente paga, ve a <strong>Negocios</strong> → menú de acciones → <strong>Renovar plan</strong> para extender su vencimiento.</p>
      </div>
    </div>
  );
}
