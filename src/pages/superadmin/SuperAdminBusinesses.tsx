import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ExternalLink, Zap, Crown, Sparkles } from 'lucide-react';
import { Database } from '@/integrations/supabase/types';

type Business = Database['public']['Tables']['businesses']['Row'];

const PLAN_BADGE: Record<string, { label: string; icon: typeof Sparkles; className: string }> = {
  free:    { label: 'Gratis',       icon: Sparkles, className: 'bg-muted text-muted-foreground' },
  starter: { label: 'Starter $10',  icon: Zap,      className: 'bg-primary/10 text-primary' },
  pro:     { label: 'Pro $30',      icon: Crown,    className: 'bg-amber-50 text-amber-700' },
};

export default function SuperAdminBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setBusinesses(data ?? []);
        setLoading(false);
      });
  }, []);

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('businesses').update({ is_active: !current }).eq('id', id);
    setBusinesses(prev => prev.map(b => b.id === id ? { ...b, is_active: !current } : b));
  };

  if (loading) return <div className="text-muted-foreground text-sm">Cargando negocios...</div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Negocios registrados</h1>
        <p className="text-muted-foreground text-sm mt-1">{businesses.length} negocios en la plataforma</p>
      </div>

      <div className="card-elevated overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Negocio</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Slug</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Plan</th>
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
                      <span className="font-medium">{biz.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{biz.slug}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${planMeta.className}`}>
                      <PlanIcon className="w-3 h-3" />
                      {planMeta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{biz.whatsapp_number}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive(biz.id, biz.is_active)}
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                        biz.is_active
                          ? 'bg-green-50 text-green-700 hover:bg-red-50 hover:text-red-700'
                          : 'bg-red-50 text-red-700 hover:bg-green-50 hover:text-green-700'
                      }`}
                    >
                      {biz.is_active ? 'Activo' : 'Inactivo'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {new Date(biz.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/b/${biz.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/70 transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
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
    </div>
  );
}
