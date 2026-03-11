import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { useCart } from '@/hooks/useCart';
import { buildWhatsAppMessage, getWhatsAppUrl } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Minus, Plus, ShoppingCart, MessageCircle, Loader2, ChefHat, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

type Business = Database['public']['Tables']['businesses']['Row'] & {
  primary_color?: string | null;
  logo_url?: string | null;
};
type Category = Database['public']['Tables']['categories']['Row'];
type Product = Database['public']['Tables']['products']['Row'];

export default function PublicMenu() {
  const { slug } = useParams<{ slug: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState(false);

  const { items, addItem, removeItem, updateQuantity, clearCart, total, count } = useCart(business?.id);

  const brandColor = business?.primary_color || '#f97316';

  useEffect(() => {
    const load = async () => {
      const { data: biz } = await supabase.from('businesses').select('*').eq('slug', slug!).eq('is_active', true).maybeSingle();
      if (!biz) { setNotFound(true); setLoading(false); return; }
      setBusiness(biz as Business);

      const [cats, prods] = await Promise.all([
        supabase.from('categories').select('*').eq('business_id', biz.id).eq('is_active', true).order('position'),
        supabase.from('products').select('*').eq('business_id', biz.id).eq('is_available', true).order('position'),
      ]);
      setCategories(cats.data || []);
      setProducts(prods.data || []);
      setLoading(false);
    };
    load();
  }, [slug]);

  const sendOrder = async () => {
    if (!business || items.length === 0) return;
    setOrdering(true);

    const { data: order } = await supabase.from('orders').insert({
      business_id: business.id,
      customer_name: customerName || null,
      total,
      notes: notes || null,
      status: 'pending',
    }).select().single();

    if (order) {
      await supabase.from('order_items').insert(
        items.map(i => ({
          order_id: order.id,
          product_id: i.product.id,
          product_name: i.product.name,
          product_price: i.product.price,
          quantity: i.quantity,
          subtotal: i.product.price * i.quantity,
        }))
      );

      const msg = buildWhatsAppMessage(business.name, items, total, business.currency, customerName, notes);
      const url = getWhatsAppUrl(business.whatsapp_number, msg);
      window.open(url, '_blank');
      clearCart();
      setOrdered(true);
      setCartOpen(false);
    }
    setOrdering(false);
  };

  const currency = business?.currency || 'USD';
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '$';

  const filteredProducts = activeCategory
    ? products.filter(p => p.category_id === activeCategory)
    : products;

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="w-12 h-12 bg-muted rounded-xl flex items-center justify-center mb-4">
        <ChefHat className="w-6 h-6 text-muted-foreground" />
      </div>
      <h1 className="text-xl font-semibold">Menú no encontrado</h1>
      <p className="text-muted-foreground text-sm mt-1">Este enlace no corresponde a ningún negocio activo.</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {business?.logo_url ? (
              <img
                src={business.logo_url}
                alt={business.name}
                className="w-10 h-10 rounded-xl object-contain flex-shrink-0 bg-muted/30 p-0.5"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-lg"
                style={{ backgroundColor: brandColor }}
              >
                {business?.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-semibold text-lg tracking-tight truncate">{business?.name}</h1>
              {business?.address && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 hover:text-primary transition-colors"
                >
                  <MapPin className="w-3 h-3 flex-shrink-0" /><span className="truncate underline underline-offset-2">{business.address}</span>
                </a>
              )}
            </div>
          </div>

          <Sheet open={cartOpen} onOpenChange={setCartOpen}>
            <SheetTrigger asChild>
              <Button
                size="sm"
                className="relative gap-2 flex-shrink-0 text-white"
                style={{ backgroundColor: brandColor, borderColor: brandColor }}
              >
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Mi pedido</span>
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center font-bold">
                    {count}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md flex flex-col">
              <SheetHeader>
                <SheetTitle>Tu pedido</SheetTitle>
              </SheetHeader>

              {ordered ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: brandColor + '20' }}>
                    <MessageCircle className="w-8 h-8" style={{ color: brandColor }} />
                  </div>
                  <h3 className="font-semibold text-lg mb-1">¡Pedido enviado!</h3>
                  <p className="text-muted-foreground text-sm">Se abrió WhatsApp para confirmar con el negocio.</p>
                  <Button className="mt-6 text-white" style={{ backgroundColor: brandColor }} onClick={() => setOrdered(false)}>
                    Hacer otro pedido
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <ShoppingCart className="w-12 h-12 text-muted-foreground/30 mb-3" />
                  <p className="text-muted-foreground">Tu pedido está vacío</p>
                  <p className="text-sm text-muted-foreground/70 mt-1">Agrega productos del menú</p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto space-y-3 py-4">
                    {items.map(item => (
                      <div key={item.product.id} className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{item.product.name}</p>
                          <p className="text-sm font-semibold" style={{ color: brandColor }}>
                            {currencySymbol}{(item.product.price * item.quantity).toFixed(2)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80">
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                            style={{ backgroundColor: brandColor }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="border-t border-border pt-3 space-y-3">
                      <Input placeholder="Tu nombre (opcional)" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                      <Input placeholder="Notas del pedido..." value={notes} onChange={e => setNotes(e.target.value)} />
                    </div>
                  </div>

                  <div className="border-t border-border pt-4 space-y-3">
                    <div className="flex justify-between font-semibold">
                      <span>Total</span>
                      <span style={{ color: brandColor }}>{currencySymbol}{total.toFixed(2)}</span>
                    </div>
                    <Button
                      className="w-full gap-2 text-white"
                      style={{ backgroundColor: '#16a34a' }}
                      onClick={sendOrder}
                      disabled={ordering}
                    >
                      {ordering ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                      Enviar por WhatsApp
                    </Button>
                  </div>
                </>
              )}
            </SheetContent>
          </Sheet>
        </div>

        {/* Category tabs */}
        {categories.length > 0 && (
          <div className="max-w-2xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => setActiveCategory(null)}
              className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 text-white"
              style={{
                backgroundColor: !activeCategory ? brandColor : 'transparent',
                color: !activeCategory ? 'white' : undefined,
                border: `1px solid ${!activeCategory ? brandColor : 'hsl(var(--border))'}`,
              }}
            >
              Todo
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id === activeCategory ? null : cat.id)}
                className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
                style={{
                  backgroundColor: activeCategory === cat.id ? brandColor : 'transparent',
                  color: activeCategory === cat.id ? 'white' : undefined,
                  border: `1px solid ${activeCategory === cat.id ? brandColor : 'hsl(var(--border))'}`,
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Products */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-8">
        {categories.length > 0 && !activeCategory ? (
          categories.map(cat => {
            const catProducts = products.filter(p => p.category_id === cat.id);
            if (catProducts.length === 0) return null;
            return (
              <section key={cat.id}>
                <h2 className="text-base font-semibold mb-3">{cat.name}</h2>
                <ProductGrid products={catProducts} currencySymbol={currencySymbol} brandColor={brandColor} items={items} addItem={addItem} removeItem={removeItem} updateQuantity={updateQuantity} />
              </section>
            );
          })
        ) : (
          <ProductGrid products={filteredProducts} currencySymbol={currencySymbol} brandColor={brandColor} items={items} addItem={addItem} removeItem={removeItem} updateQuantity={updateQuantity} />
        )}

        {/* Uncategorized */}
        {!activeCategory && (() => {
          const uncategorized = products.filter(p => !p.category_id);
          if (uncategorized.length === 0) return null;
          return (
            <section>
              <h2 className="text-base font-semibold mb-3">Otros</h2>
              <ProductGrid products={uncategorized} currencySymbol={currencySymbol} brandColor={brandColor} items={items} addItem={addItem} removeItem={removeItem} updateQuantity={updateQuantity} />
            </section>
          );
        })()}
      </div>
    </div>
  );
}

function ProductGrid({ products, currencySymbol, brandColor, items, addItem, removeItem, updateQuantity }: {
  products: Product[];
  currencySymbol: string;
  brandColor: string;
  items: ReturnType<typeof useCart>['items'];
  addItem: (p: Product) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {products.map(product => {
        const cartItem = items.find(i => i.product.id === product.id);
        return (
          <div key={product.id} className="card-elevated flex gap-3 p-3">
            {product.image_url && (
              <img src={product.image_url} alt={product.name} className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight">{product.name}</p>
              {product.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>}
              <div className="flex items-center justify-between mt-2">
                <span className="font-semibold text-sm" style={{ color: brandColor }}>{currencySymbol}{product.price.toFixed(2)}</span>
                {!cartItem ? (
                  <button
                    onClick={() => addItem(product)}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity text-white"
                    style={{ backgroundColor: brandColor }}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateQuantity(product.id, cartItem.quantity - 1)} className="w-6 h-6 rounded-md bg-muted flex items-center justify-center">
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-5 text-center text-xs font-semibold">{cartItem.quantity}</span>
                    <button
                      onClick={() => updateQuantity(product.id, cartItem.quantity + 1)}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white"
                      style={{ backgroundColor: brandColor }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
