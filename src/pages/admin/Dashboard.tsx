import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Package, FolderOpen, ShoppingBag, ExternalLink, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  const { business } = useBusiness();
  const [stats, setStats] = useState({ products: 0, categories: 0, orders: 0, todayOrders: 0 });

  useEffect(() => {
    if (!business) return;
    const load = async () => {
      const [p, c, o, t] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('categories').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
        supabase.from('orders').select('id', { count: 'exact', head: true })
          .eq('business_id', business.id)
          .gte('created_at', new Date().toISOString().slice(0, 10)),
      ]);
      setStats({
        products: p.count || 0,
        categories: c.count || 0,
        orders: o.count || 0,
        todayOrders: t.count || 0,
      });
    };
    load();
  }, [business]);

  const tiles = [
    { label: 'Productos', value: stats.products, icon: Package, href: '/admin/products', color: 'text-blue-600 bg-blue-50' },
    { label: 'Categorías', value: stats.categories, icon: FolderOpen, href: '/admin/categories', color: 'text-orange-600 bg-orange-50' },
    { label: 'Pedidos hoy', value: stats.todayOrders, icon: TrendingUp, href: '/admin/orders', color: 'text-primary bg-primary/10' },
    { label: 'Pedidos totales', value: stats.orders, icon: ShoppingBag, href: '/admin/orders', color: 'text-purple-600 bg-purple-50' },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{business?.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">Panel de administración</p>
        </div>
        {business && (
          <Link
            to={`/b/${business.slug}`}
            target="_blank"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            Ver menú público
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map(tile => (
          <Link key={tile.label} to={tile.href} className="card-elevated p-4 hover:shadow-md transition-shadow group">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${tile.color}`}>
              <tile.icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-semibold">{tile.value}</p>
            <p className="text-sm text-muted-foreground mt-0.5">{tile.label}</p>
          </Link>
        ))}
      </div>

      {business && (
        <div className="card-elevated p-5">
          <h2 className="font-medium mb-3 text-sm">Tu enlace de menú</h2>
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
            <code className="text-sm flex-1 truncate">
              {window.location.origin}/b/{business.slug}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(`${window.location.origin}/b/${business.slug}`)}
              className="text-xs text-primary hover:underline font-medium flex-shrink-0"
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
