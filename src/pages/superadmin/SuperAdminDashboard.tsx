import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Building2, ShoppingBag, Users, TrendingUp } from 'lucide-react';

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState({
    totalBusinesses: 0,
    activeBusinesses: 0,
    totalOrders: 0,
    planCounts: { free: 0, starter: 0, pro: 0 },
  });

  useEffect(() => {
    const load = async () => {
      const [biz, orders] = await Promise.all([
        supabase.from('businesses').select('plan, is_active'),
        supabase.from('orders').select('id', { count: 'exact', head: true }),
      ]);

      const businesses = biz.data ?? [];
      const planCounts = { free: 0, starter: 0, pro: 0 };
      businesses.forEach(b => {
        const p = b.plan as keyof typeof planCounts;
        if (p in planCounts) planCounts[p]++;
      });

      setStats({
        totalBusinesses: businesses.length,
        activeBusinesses: businesses.filter(b => b.is_active).length,
        totalOrders: orders.count ?? 0,
        planCounts,
      });
    };
    load();
  }, []);

  const tiles = [
    { label: 'Negocios totales', value: stats.totalBusinesses, icon: Building2, color: 'text-blue-600 bg-blue-50' },
    { label: 'Negocios activos', value: stats.activeBusinesses, icon: Users, color: 'text-green-600 bg-green-50' },
    { label: 'Pedidos totales', value: stats.totalOrders, icon: ShoppingBag, color: 'text-purple-600 bg-purple-50' },
    { label: 'Planes Pro', value: stats.planCounts.pro, icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Panel Super Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">Vista global de todos los negocios en la plataforma</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(tile => (
          <div key={tile.label} className="card-elevated p-4">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${tile.color}`}>
              <tile.icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-semibold">{tile.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{tile.label}</p>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      <div className="card-elevated p-6">
        <h2 className="font-semibold mb-4">Distribución de planes</h2>
        <div className="grid grid-cols-3 gap-4">
          {[
            { plan: 'Gratis', count: stats.planCounts.free, color: 'bg-muted text-muted-foreground' },
            { plan: 'Starter $10', count: stats.planCounts.starter, color: 'bg-primary/10 text-primary' },
            { plan: 'Pro $30', count: stats.planCounts.pro, color: 'bg-amber-50 text-amber-700' },
          ].map(p => (
            <div key={p.plan} className={`rounded-xl p-4 text-center ${p.color}`}>
              <p className="text-3xl font-bold">{p.count}</p>
              <p className="text-sm font-medium mt-1">{p.plan}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
