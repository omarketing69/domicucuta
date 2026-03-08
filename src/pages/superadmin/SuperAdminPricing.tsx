import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Save, Sparkles, Zap, Crown } from 'lucide-react';

interface PlanPricing {
  id: string;
  label: string;
  price_monthly: number;
  description: string | null;
  is_active: boolean;
}

const PLAN_ICONS: Record<string, typeof Sparkles> = {
  free: Sparkles,
  starter: Zap,
  pro: Crown,
};

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-muted/50 border-border',
  starter: 'bg-primary/5 border-primary/20',
  pro: 'bg-amber-50 border-amber-200',
};

export default function SuperAdminPricing() {
  const [plans, setPlans] = useState<PlanPricing[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<PlanPricing>>>({});

  useEffect(() => {
    supabase
      .from('plan_pricing')
      .select('*')
      .order('price_monthly', { ascending: true })
      .then(({ data }) => {
        setPlans((data as PlanPricing[]) ?? []);
      });
  }, []);

  const handleChange = (id: string, field: keyof PlanPricing, value: string | number) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const getValue = (plan: PlanPricing, field: keyof PlanPricing) => {
    if (edits[plan.id] && field in edits[plan.id]) return edits[plan.id][field];
    return plan[field];
  };

  const save = async (plan: PlanPricing) => {
    const update = edits[plan.id];
    if (!update) return;
    setSaving(plan.id);
    const { error } = await supabase
      .from('plan_pricing')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', plan.id);

    if (error) {
      toast.error('Error al guardar');
    } else {
      setPlans(prev => prev.map(p => p.id === plan.id ? { ...p, ...update } : p));
      setEdits(prev => { const next = { ...prev }; delete next[plan.id]; return next; });
      toast.success(`Plan "${plan.label}" actualizado`);
    }
    setSaving(null);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Precios de planes</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Configura el precio mensual y descripción de cada plan. Los cambios se reflejan en la página de precios pública.
        </p>
      </div>

      <div className="space-y-4">
        {plans.map(plan => {
          const Icon = PLAN_ICONS[plan.id] ?? Sparkles;
          const hasChanges = !!edits[plan.id] && Object.keys(edits[plan.id]).length > 0;

          return (
            <div key={plan.id} className={`border rounded-xl p-5 space-y-4 ${PLAN_COLORS[plan.id] ?? 'bg-card border-border'}`}>
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-muted-foreground" />
                <h2 className="font-semibold text-base">{plan.label}</h2>
                <span className="text-xs text-muted-foreground ml-auto">ID: {plan.id}</span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Precio mensual (USD)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={getValue(plan, 'price_monthly') as number}
                      onChange={e => handleChange(plan.id, 'price_monthly', parseFloat(e.target.value) || 0)}
                      className="pl-7"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Descripción breve</label>
                  <Input
                    value={(getValue(plan, 'description') as string) ?? ''}
                    onChange={e => handleChange(plan.id, 'description', e.target.value)}
                    placeholder="Descripción del plan..."
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => save(plan)}
                  disabled={!hasChanges || saving === plan.id}
                  className="gap-2"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving === plan.id ? 'Guardando...' : 'Guardar cambios'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card-elevated p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground mb-1">💡 Renovación de pagos</p>
        <p>Cuando un cliente paga, ve a <strong>Negocios</strong> → menú de acciones → <strong>Renovar plan</strong> para extender su vencimiento. El sistema marcará automáticamente como "Vencido" los negocios cuya fecha de vencimiento haya pasado.</p>
      </div>
    </div>
  );
}
