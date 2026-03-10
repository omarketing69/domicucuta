import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ExternalLink, Zap, Crown, Sparkles, Plus, RefreshCw, MoreHorizontal, KeyRound, UserPlus } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';
import CreateBusinessDialog from './CreateBusinessDialog';
import EditCredentialsDialog from './EditCredentialsDialog';
import AssignOwnerDialog from './AssignOwnerDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

type Business = Database['public']['Tables']['businesses']['Row'];

const PLAN_BADGE: Record<string, { label: string; icon: typeof Sparkles; className: string }> = {
  free:    { label: 'Gratis',     icon: Sparkles, className: 'bg-muted text-muted-foreground' },
  starter: { label: 'Starter',   icon: Zap,      className: 'bg-primary/10 text-primary' },
  pro:     { label: 'Pro',       icon: Crown,    className: 'bg-amber-50 text-amber-700' },
};

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function SuperAdminBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editCreds, setEditCreds] = useState<{ biz: Business } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false });
    setBusinesses(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('businesses').update({ is_active: !current }).eq('id', id);
    setBusinesses(prev => prev.map(b => b.id === id ? { ...b, is_active: !current } : b));
    toast.success(!current ? 'Negocio activado' : 'Negocio desactivado');
  };

  const renewPlan = async (biz: Business, months: number) => {
    const base = biz.plan_expires_at && new Date(biz.plan_expires_at) > new Date()
      ? new Date(biz.plan_expires_at)
      : new Date();
    base.setMonth(base.getMonth() + months);
    await supabase.from('businesses').update({
      plan_expires_at: base.toISOString(),
      is_active: true,
      plan_started_at: new Date().toISOString(),
    }).eq('id', biz.id);
    await load();
    toast.success(`Plan renovado por ${months} mes${months > 1 ? 'es' : ''}`);
  };

  const changePlan = async (id: string, plan: string) => {
    await supabase.from('businesses').update({ plan }).eq('id', id);
    setBusinesses(prev => prev.map(b => b.id === id ? { ...b, plan } : b));
    toast.success(`Plan cambiado a ${plan}`);
  };

  if (loading) return <div className="text-muted-foreground text-sm">Cargando negocios...</div>;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Negocios registrados</h1>
          <p className="text-muted-foreground text-sm mt-1">{businesses.length} negocios en la plataforma</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          Nuevo cliente
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Negocio</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Vence</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">WhatsApp</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estado</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Registro</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {businesses.map((biz, i) => {
              const planMeta = PLAN_BADGE[biz.plan] ?? PLAN_BADGE.free;
              const PlanIcon = planMeta.icon;
              const expired = isExpired(biz.plan_expires_at);
              const effectivelyActive = biz.is_active && !expired;

              return (
                <tr key={biz.id} className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {biz.logo_url ? (
                        <img src={biz.logo_url} alt={biz.name} className="w-7 h-7 rounded object-cover" />
                      ) : (
                        <div
                          className="w-7 h-7 rounded flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: biz.primary_color ?? '#f97316' }}
                        >
                          {biz.name[0].toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium">{biz.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{biz.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${planMeta.className}`}>
                      <PlanIcon className="w-3 h-3" />
                      {planMeta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {biz.plan_expires_at ? (
                      <span className={`text-xs ${expired ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                        {expired ? '⚠ ' : ''}
                        {new Date(biz.plan_expires_at).toLocaleDateString('es-CO')}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{biz.whatsapp_number}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      effectivelyActive
                        ? 'bg-green-50 text-green-700'
                        : expired
                        ? 'bg-orange-50 text-orange-700'
                        : 'bg-red-50 text-red-700'
                    }`}>
                      {effectivelyActive ? 'Activo' : expired ? 'Vencido' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(biz.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <a
                        href={`/b/${biz.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary/70 transition-colors p-1"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                        </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => setEditCreds({ biz })}>
                            <KeyRound className="w-3.5 h-3.5 mr-2" /> Editar credenciales
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => toggleActive(biz.id, biz.is_active)}>
                            {biz.is_active ? 'Desactivar negocio' : 'Activar negocio'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="flex items-center gap-2" onClick={() => renewPlan(biz, 1)}>
                            <RefreshCw className="w-3.5 h-3.5" /> Renovar 1 mes
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => renewPlan(biz, 3)}>
                            Renovar 3 meses
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => renewPlan(biz, 12)}>
                            Renovar 12 meses
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => changePlan(biz.id, 'free')}>
                            Cambiar a Gratis
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => changePlan(biz.id, 'starter')}>
                            Cambiar a Starter
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => changePlan(biz.id, 'pro')}>
                            Cambiar a Pro
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {businesses.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">No hay negocios registrados aún.</div>
        )}
      </div>

      <CreateBusinessDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={load}
      />

      {editCreds && (
        <EditCredentialsDialog
          open={!!editCreds}
          onOpenChange={(v) => { if (!v) setEditCreds(null); }}
          businessName={editCreds.biz.name}
          ownerId={editCreds.biz.owner_id}
        />
      )}
    </div>
  );
}
