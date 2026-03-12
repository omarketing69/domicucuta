import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useBusiness } from '@/hooks/useBusiness';
import { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronDown, MessageCircle, CheckCircle, XCircle } from 'lucide-react';
import { getWhatsAppUrl, buildWhatsAppMessage } from '@/lib/whatsapp';
import { cn } from '@/lib/utils';

type Order = Database['public']['Tables']['orders']['Row'] & {
  order_items: Database['public']['Tables']['order_items']['Row'][];
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  ready: 'Listo',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'badge-status-pending',
  confirmed: 'badge-status-confirmed',
  ready: 'badge-status-ready',
  completed: 'badge-status-completed',
  cancelled: 'badge-status-cancelled',
};

export default function Orders() {
  const { business } = useBusiness();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    if (!business) return;
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('business_id', business.id)
      .order('created_at', { ascending: false });
    setOrders((data as Order[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [business]);

  // Realtime subscription
  useEffect(() => {
    if (!business) return;
    const channel = supabase
      .channel('orders-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `business_id=eq.${business.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [business]);

  const updateStatus = async (orderId: string, status: string) => {
    await supabase.from('orders').update({ status: status as any }).eq('id', orderId);
    load();
  };

  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pedidos</h1>
        <p className="text-muted-foreground text-sm mt-1">{orders.length} pedidos en total</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <div className="card-elevated p-12 text-center">
          <p className="text-muted-foreground">Aún no has recibido pedidos.</p>
          <p className="text-xs text-muted-foreground mt-1">Comparte tu menú para empezar a recibirlos.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map(order => (
            <div key={order.id} className="card-elevated overflow-hidden">
              <button
                className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors text-left"
                onClick={() => setExpanded(expanded === order.id ? null : order.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{order.customer_name || 'Cliente anónimo'}</span>
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', STATUS_BADGE[order.status])}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm font-semibold text-primary">{currencySymbol}{order.total.toFixed(2)}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  </div>
                </div>
                <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform flex-shrink-0', expanded === order.id && 'rotate-180')} />
              </button>

              {expanded === order.id && (
                <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/10">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Productos</p>
                    <div className="space-y-1">
                      {order.order_items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span>{item.quantity}× {item.product_name}</span>
                          <span className="font-medium">{currencySymbol}{item.subtotal.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {order.notes && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notas</p>
                      <p className="text-sm">{order.notes}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {order.status === 'pending' && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(order.id, 'confirmed')}>
                          <CheckCircle className="w-3 h-3 mr-1" /> Confirmar
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => updateStatus(order.id, 'cancelled')}>
                          <XCircle className="w-3 h-3 mr-1" /> Cancelar
                        </Button>
                      </>
                    )}
                    {order.status === 'confirmed' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(order.id, 'ready')}>
                        Marcar como listo
                      </Button>
                    )}
                    {order.status === 'ready' && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(order.id, 'completed')}>
                        <CheckCircle className="w-3 h-3 mr-1" /> Completado
                      </Button>
                    )}
                    {business && order.customer_phone && (
                      <a
                        href={getWhatsAppUrl(business.whatsapp_number, buildWhatsAppMessage(business.name, order.order_items.map(i => ({ cartItemId: i.id, product: { name: i.product_name, price: i.product_price, id: i.product_id || '' } as any, quantity: i.quantity, toppings: [] })), order.total, currency))}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="sm" className="h-7 text-xs bg-[hsl(142,70%,40%)] hover:bg-[hsl(142,70%,35%)] text-white">
                          <MessageCircle className="w-3 h-3 mr-1" /> WhatsApp
                        </Button>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
