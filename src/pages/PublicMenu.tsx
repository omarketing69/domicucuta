import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Database } from '@/integrations/supabase/types';
import { useCart, SelectedTopping, SelectedFlavor } from '@/hooks/useCart';
import { isFlavor, isTopping, stripFlavorPrefix } from '@/lib/flavorUtils';
import { buildWhatsAppMessage, getWhatsAppUrl } from '@/lib/whatsapp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Minus, Plus, ShoppingCart, MessageCircle, Loader2, ChefHat, MapPin, Flame, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import MenuAIAssistant from '@/components/MenuAIAssistant';

type Business = Database['public']['Tables']['businesses']['Row'];
type Category = Database['public']['Tables']['categories']['Row'];
type Product = Database['public']['Tables']['products']['Row'];

type Topping = { id: string; name: string; price: number };
type Flavor = { id: string; name: string; price: number };
type ProductToppingsMap = Record<string, Topping[]>;
type ProductFlavorsMap = Record<string, Flavor[]>;

type Service = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  duration_minutes: number;
  max_persons: number;
  image_url: string | null;
  is_available: boolean;
};

export default function PublicMenu() {
  const { slug } = useParams<{ slug: string }>();
  const [business, setBusiness] = useState<Business | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productToppings, setProductToppings] = useState<ProductToppingsMap>({});
  const [productFlavors, setProductFlavors] = useState<ProductFlavorsMap>({});
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryType, setDeliveryType] = useState<'local' | 'pickup' | 'delivery'>('local');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState(false);
  const [waUrl, setWaUrl] = useState('');
  const [loadError, setLoadError] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Product detail modal
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [detailFlavor, setDetailFlavor] = useState<SelectedFlavor | null>(null);
  const [detailFlavor2, setDetailFlavor2] = useState<SelectedFlavor | null>(null);
  const [isHalfHalf, setIsHalfHalf] = useState(false);
  const [detailToppings, setDetailToppings] = useState<SelectedTopping[]>([]);
  const [detailQty, setDetailQty] = useState(1);

  const { items, addItem, removeItem, updateQuantity, clearCart, total, count, itemFlavorPrice, itemToppingTotal } = useCart(business?.id);

  const brandColor = business?.primary_color || '#f97316';

  const CACHE_KEY = `menu_cache_${slug}`;
  const CACHE_TTL = 60 * 60 * 1000; // 1 hour

  type PTRow = { product_id: string; topping_id: string; toppings: { id: string; name: string; price: number } | null };
  type ProductWithPT = Product & { product_toppings: PTRow[] };
  type BizWithAll = Business & { categories: Category[]; products: ProductWithPT[] };

  const applyCache = (cache: { business: Business; categories: Category[]; products: Product[]; toppings: ProductToppingsMap; flavors: ProductFlavorsMap }) => {
    setBusiness(cache.business);
    setCategories(cache.categories);
    setProducts(cache.products);
    setProductToppings(cache.toppings);
    setProductFlavors(cache.flavors);
  };

  const loadMenu = async (forceRefresh = false) => {
    setLoadError(false);
    setNotFound(false);

    // 1. Show localStorage cache instantly (persists across sessions = instant on repeat visit)
    let hasCache = false;
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cache = JSON.parse(raw);
          applyCache(cache);
          setLoading(false);
          hasCache = true;
          // Always refresh in background so settings like ai_enabled stay current
        }
      } catch { /* ignore corrupt cache */ }
    } else {
      try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
    }

    if (!hasCache) setLoading(true);

    try {
      // 2. ONE single query — business + categories + products + toppings (1 roundtrip)
      const { data: raw, error } = await supabase
        .from('businesses')
        .select('*, categories(*), products(*, product_toppings(product_id, topping_id, toppings(id, name, price)))')
        .eq('slug', slug!)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      if (!raw) { setNotFound(true); setLoading(false); return; }

      const bizRaw = raw as unknown as BizWithAll;

      // Filter + sort client-side (avoids extra roundtrips)
      const fetchedCategories = (bizRaw.categories || [])
        .filter(c => c.is_active)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const allProducts = (bizRaw.products || [])
        .filter(p => p.is_available)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      // Strip product_toppings field from product objects
      const fetchedProducts: Product[] = allProducts.map(({ product_toppings: _pt, ...p }) => p as Product);

      // Build topping/flavor maps
      const toppingMap: ProductToppingsMap = {};
      const flavorMap: ProductFlavorsMap = {};
      allProducts.forEach(prod => {
        (prod.product_toppings || []).forEach(row => {
          if (!row.toppings) return;
          const { id, name, price } = row.toppings;
          if (isFlavor(name)) {
            if (!flavorMap[prod.id]) flavorMap[prod.id] = [];
            flavorMap[prod.id].push({ id, name: stripFlavorPrefix(name), price });
          } else if (isTopping(name)) {
            if (!toppingMap[prod.id]) toppingMap[prod.id] = [];
            toppingMap[prod.id].push({ id, name, price });
          }
        });
      });

      // Strip nested relation fields from business object
      const { categories: _c, products: _p, ...bizOnly } = bizRaw;
      const business = bizOnly as Business;

      setBusiness(business);
      setCategories(fetchedCategories);
      setProducts(fetchedProducts);
      setProductToppings(toppingMap);
      setProductFlavors(flavorMap);

      // If reservations mode, load services
      if ((business as any).business_type === 'reservations') {
        const { data: svcData } = await (supabase as any)
          .from('services')
          .select('id, name, description, price, duration_minutes, max_persons, image_url, is_available')
          .eq('business_id', business.id)
          .eq('is_available', true)
          .order('position');
        setServices(svcData || []);
      }

      setLoading(false);

      // Save to localStorage for instant next visit
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          business,
          categories: fetchedCategories,
          products: fetchedProducts,
          toppings: toppingMap,
          flavors: flavorMap,
        }));
      } catch { /* ignore quota errors */ }

    } catch {
      if (!hasCache) {
        setLoading(false);
        setLoadError(true);
      }
    }
  };

  useEffect(() => {
    loadMenu();
  }, [slug]);

  const openDetail = (product: Product) => {
    setDetailProduct(product);
    setDetailFlavor(null);
    setDetailFlavor2(null);
    setIsHalfHalf(false);
    setDetailToppings([]);
    setDetailQty(1);
  };

  const toggleDetailTopping = (t: Topping) => {
    setDetailToppings(prev =>
      prev.find(x => x.id === t.id)
        ? prev.filter(x => x.id !== t.id)
        : [...prev, { id: t.id, name: t.name, price: t.price }]
    );
  };

  const confirmDetail = () => {
    if (!detailProduct) return;
    const flavors = productFlavors[detailProduct.id] || [];
    if (flavors.length > 0 && !detailFlavor) return;
    if (isHalfHalf && !detailFlavor2) return;
    for (let i = 0; i < detailQty; i++) {
      addItem(detailProduct, detailFlavor, detailToppings, isHalfHalf ? detailFlavor2 : null);
    }
    setDetailProduct(null);
  };

  const detailUnitPrice = () => {
    if (!detailProduct) return 0;
    const flavorPrice = isHalfHalf
      ? Math.max(detailFlavor?.price || 0, detailFlavor2?.price || 0)
      : (detailFlavor?.price || 0);
    return detailProduct.price + flavorPrice + detailToppings.reduce((s, t) => s + t.price, 0);
  };

  const sendOrder = async () => {
    if (!business || items.length === 0) return;
    if (!customerPhone.trim()) {
      setPhoneError(true);
      return;
    }
    setPhoneError(false);
    setOrdering(true);

    // Build the WhatsApp URL BEFORE any await so we have it ready
    const msg = buildWhatsAppMessage(
      business.name, items, total, business.currency,
      customerName, notes, deliveryType,
      deliveryType === 'delivery' ? deliveryAddress : undefined,
    );
    const url = getWhatsAppUrl(business.whatsapp_number, msg);

    try {
      // Generate order ID client-side so anon RLS (which blocks SELECT-back) doesn't prevent saving
      const orderId = crypto.randomUUID();
      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        business_id: business.id,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        delivery_type: deliveryType,
        delivery_address: deliveryType === 'delivery' ? (deliveryAddress || null) : null,
        total,
        notes: notes || null,
        status: 'pending',
      });

      if (orderError) {
        console.error('[sendOrder] orders INSERT error:', orderError);
        toast.error(`Error al guardar el pedido: ${orderError.message}`);
      } else {
        await supabase.from('order_items').insert(
          items.map(i => ({
            order_id: orderId,
            product_id: i.product.id,
            product_name: i.product.name,
            product_price: i.product.price,
            quantity: i.quantity,
            subtotal: (i.product.price + itemFlavorPrice(i) + itemToppingTotal(i)) * i.quantity,
          }))
        );
      }

      // Save cart order as a conversation record for the CRM
      const itemsSummary = items
        .map(i => `${i.quantity}x ${i.product.name}`)
        .join(', ');
      const entregaLabel: Record<string, string> = { local: 'En el local', pickup: 'Para recoger', delivery: 'A domicilio' };
      const assistantContent = [
        `✅ Pedido confirmado por carrito digital`,
        `🛍️ ${itemsSummary}`,
        `📦 Entrega: ${entregaLabel[deliveryType] ?? deliveryType}`,
        deliveryType === 'delivery' && deliveryAddress ? `📍 ${deliveryAddress}` : null,
        customerPhone ? `📱 WhatsApp: ${customerPhone}` : null,
        notes ? `📝 Notas: ${notes}` : null,
        `💰 Total: ${total.toFixed(2)}`,
      ].filter(Boolean).join('\n');

      await supabase.from('ai_conversations').insert({
        business_id: business.id,
        slug: slug ?? '',
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        had_order: true,
        source: 'cart',
        messages: [
          { role: 'user', content: 'Pedido realizado por el menú digital (carrito)' },
          { role: 'assistant', content: assistantContent },
        ] as unknown as import('@/integrations/supabase/types').Json,
        order_data: {
          cliente: customerName || '',
          telefono: customerPhone,
          items: itemsSummary,
          entrega: entregaLabel[deliveryType] ?? deliveryType,
          direccion: deliveryType === 'delivery' ? (deliveryAddress || '') : '',
          notas: notes || '',
          total,
        } as unknown as import('@/integrations/supabase/types').Json,
      });
    } catch (err) {
      console.error('[sendOrder] unexpected error (order may not have been saved):', err);
      toast.error('Ocurrió un error al registrar el pedido. El pedido se enviará por WhatsApp igualmente.');
    }

    // Show the WhatsApp confirmation screen inside the open cart sheet.
    // clearCart() is NOT called here — it fires when the user explicitly
    // clicks the WhatsApp link (or starts a new order).
    setWaUrl(url);
    setOrdered(true);
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

  if (loadError) return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold">No se pudo cargar el menú</h1>
      <p className="text-muted-foreground text-sm mt-1 max-w-xs">
        Verifica tu conexión a internet e inténtalo de nuevo.
      </p>
      <button
        onClick={() => loadMenu(true)}
        className="mt-6 px-5 py-2.5 rounded-xl text-white font-medium text-sm transition-opacity hover:opacity-90"
        style={{ backgroundColor: '#f97316' }}
      >
        Reintentar
      </button>
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

  // ── RESERVATIONS MODE ─────────────────────────────────────────────────────
  if ((business as any)?.business_type === 'reservations') {
    return (
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="bg-card border-b border-border sticky top-0 z-20">
          <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
            {business?.logo_url ? (
              <img src={business.logo_url} alt={business.name} className="w-10 h-10 rounded-xl object-contain flex-shrink-0 bg-muted/30 p-0.5" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-lg" style={{ backgroundColor: brandColor }}>
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
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate underline underline-offset-2">{business.address}</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Services list */}
        <div className="max-w-2xl mx-auto px-4 py-6">
          {business?.description && (
            <p className="text-muted-foreground text-sm mb-6 text-center">{business.description}</p>
          )}

          {services.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">Próximamente nuestros servicios disponibles.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {services.map(service => (
                <div key={service.id} className="bg-card border border-border rounded-2xl overflow-hidden flex gap-0">
                  {service.image_url && (
                    <div className="w-28 flex-shrink-0">
                      <img src={service.image_url} alt={service.name} className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 p-4">
                    <h3 className="font-semibold text-base">{service.name}</h3>
                    {service.description && (
                      <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{service.description}</p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {service.duration_minutes} min
                      </span>
                      {service.max_persons > 1 && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                          hasta {service.max_persons} personas
                        </span>
                      )}
                    </div>
                    <p className="text-base font-bold mt-2" style={{ color: brandColor }}>
                      {currencySymbol}{service.price.toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* CTA */}
          <div className="mt-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">¿Listo para reservar? Nuestro asistente IA te guía en segundos.</p>
            <a
              href={`https://wa.me/${business?.whatsapp_number?.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, quisiera hacer una reserva`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-white font-semibold text-sm shadow-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#25D366' }}
            >
              <MessageCircle className="w-5 h-5" fill="white" />
              Reservar por WhatsApp
            </a>
          </div>
        </div>

        {/* AI Assistant float button (if ai_enabled) */}
        {(business as any)?.ai_enabled && (
          <MenuAIAssistant
            slug={slug!}
            aiEnabled={!!(business as any)?.ai_enabled}
            brandColor={brandColor}
            voiceLang={(business as any)?.voice_lang || 'es-CO'}
            currency={currency}
            waNumber={business?.whatsapp_number}
            businessName={business?.name}
            businessId={business?.id}
          />
        )}
      </div>
    );
  }
  // ── END RESERVATIONS MODE ─────────────────────────────────────────────────

  const availFlavors = detailProduct ? (productFlavors[detailProduct.id] || []) : [];
  const availToppings = detailProduct ? (productToppings[detailProduct.id] || []) : [];
  const productHasFlavors = detailProduct ? (detailProduct.uses_flavors || availFlavors.length > 0) : false;
  const productAllowsHalfHalf = detailProduct ? !!detailProduct.allows_half_half : false;
  const canConfirm = detailProduct && (
    !productHasFlavors || availFlavors.length === 0 || (
      detailFlavor !== null && (!isHalfHalf || detailFlavor2 !== null)
    )
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-card border-b border-border sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {business?.logo_url ? (
              <img src={business.logo_url} alt={business.name} className="w-10 h-10 rounded-xl object-contain flex-shrink-0 bg-muted/30 p-0.5" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-lg" style={{ backgroundColor: brandColor }}>
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
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate underline underline-offset-2">{business.address}</span>
                </a>
              )}
            </div>
          </div>

          <Sheet open={cartOpen} onOpenChange={v => { setCartOpen(v); if (!v) setConfirmClear(false); }}>
            <SheetTrigger asChild>
              <Button size="sm" className="relative gap-2 flex-shrink-0 text-white" style={{ backgroundColor: brandColor, borderColor: brandColor }}>
                <ShoppingCart className="w-4 h-4" />
                <span className="hidden sm:inline">Mi pedido</span>
                {count > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center font-bold">
                    {count}
                  </span>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-md flex flex-col" onOpenAutoFocus={e => e.preventDefault()}>
              <SheetHeader className="flex flex-row items-center justify-between pr-8">
                <SheetTitle>Tu pedido</SheetTitle>
                {items.length > 0 && !ordered && (
                  confirmClear ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">¿Vaciar todo?</span>
                      <button
                        onClick={() => { clearCart(); setConfirmClear(false); setOrdered(false); }}
                        className="text-xs font-semibold text-destructive hover:underline"
                      >
                        Sí, vaciar
                      </button>
                      <button
                        onClick={() => setConfirmClear(false)}
                        className="text-xs text-muted-foreground hover:underline"
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmClear(true)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      title="Vaciar pedido"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Vaciar
                    </button>
                  )
                )}
              </SheetHeader>

              {ordered ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-green-100 dark:bg-green-900/30">
                    <MessageCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-lg mb-1">¡Tu pedido está listo!</h3>
                  <p className="text-muted-foreground text-sm mb-6">
                    Presiona el botón para enviarlo por WhatsApp al negocio.
                  </p>
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => {
                      if (business?.id) {
                        localStorage.removeItem(`cart_${business.id}`);
                      }
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-xl py-3.5 text-white font-semibold text-base transition-opacity hover:opacity-90 active:opacity-80"
                    style={{ backgroundColor: '#16a34a' }}
                    data-testid="link-send-whatsapp"
                  >
                    <MessageCircle className="w-5 h-5" />
                    Enviar pedido por WhatsApp
                  </a>
                  <button
                    className="mt-4 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                    onClick={() => { clearCart(); setOrdered(false); setWaUrl(''); setCustomerName(''); setCustomerPhone(''); setDeliveryType('local'); setDeliveryAddress(''); setNotes(''); }}
                  >
                    Hacer otro pedido
                  </button>
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
                      <div key={item.cartItemId} className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium" translate="no">{item.product.name}</p>
                          {item.flavorHalf2 ? (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              🍕 Mitad y mitad: <span className="font-medium">½ {item.flavor?.name}</span> &amp; <span className="font-medium">½ {item.flavorHalf2.name}</span>
                            </p>
                          ) : item.flavor ? (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Sabor: <span className="font-medium">{item.flavor.name}</span>
                              {item.flavor.price > 0 && ` +${currencySymbol}${item.flavor.price.toFixed(2)}`}
                            </p>
                          ) : null}
                          {item.toppings.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {item.toppings.map(t => (
                                <span key={t.id} className="text-xs bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">
                                  {t.name}{t.price > 0 ? ` +${currencySymbol}${t.price.toFixed(2)}` : ''}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="text-sm font-semibold mt-0.5" style={{ color: brandColor }}>
                            {currencySymbol}{((item.product.price + itemFlavorPrice(item) + itemToppingTotal(item)) * item.quantity).toFixed(2)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                          <button onClick={() => updateQuantity(item.cartItemId, item.quantity - 1)} className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80">
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.cartItemId, item.quantity + 1)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                            style={{ backgroundColor: brandColor }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}

                    <div className="border-t border-border pt-3 space-y-3">
                      {/* Delivery type selector */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">¿Cómo recibes tu pedido?</p>
                        <div className="grid grid-cols-3 gap-1.5">
                          {([
                            { value: 'local',    label: 'En el local',  icon: '🏠' },
                            { value: 'pickup',   label: 'Para recoger', icon: '🛍️' },
                            { value: 'delivery', label: 'Domicilio',    icon: '🛵' },
                          ] as const).map(opt => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() => setDeliveryType(opt.value)}
                              data-testid={`btn-delivery-${opt.value}`}
                              className="flex flex-col items-center gap-0.5 py-2 px-1 rounded-xl border text-xs font-medium transition-colors"
                              style={
                                deliveryType === opt.value
                                  ? { backgroundColor: brandColor, color: 'white', borderColor: brandColor }
                                  : undefined
                              }
                            >
                              <span className="text-base leading-none">{opt.icon}</span>
                              <span className="leading-tight text-center">{opt.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Address — only for delivery */}
                      {deliveryType === 'delivery' && (
                        <Input
                          placeholder="Dirección de entrega *"
                          value={deliveryAddress}
                          onChange={e => setDeliveryAddress(e.target.value)}
                          data-testid="input-delivery-address"
                          autoFocus
                        />
                      )}

                      <Input
                        placeholder="Tu nombre (opcional)"
                        value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        data-testid="input-customer-name"
                      />
                      <div className="space-y-1">
                        <Input
                          placeholder="Tu número de WhatsApp *"
                          value={customerPhone}
                          onChange={e => { setCustomerPhone(e.target.value); if (e.target.value.trim()) setPhoneError(false); }}
                          type="tel"
                          inputMode="tel"
                          data-testid="input-customer-phone"
                          className={phoneError ? 'border-red-400 focus-visible:ring-red-400' : ''}
                        />
                        {phoneError && (
                          <p className="text-xs text-red-500 pl-1">Ingresa tu número de WhatsApp para continuar</p>
                        )}
                      </div>
                      <Input
                        placeholder="Notas del pedido..."
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        data-testid="input-order-notes"
                      />
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
                      disabled={ordering || !customerPhone.trim()}
                      data-testid="button-send-order"
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
              className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0"
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
                <ProductGrid
                  products={catProducts}
                  currencySymbol={currencySymbol}
                  brandColor={brandColor}
                  items={items}
                  productToppings={productToppings}
                  productFlavors={productFlavors}
                  onAdd={openDetail}
                  removeItem={removeItem}
                  updateQuantity={updateQuantity}
                  itemToppingTotal={itemToppingTotal}
                />
              </section>
            );
          })
        ) : (
          <ProductGrid
            products={filteredProducts}
            currencySymbol={currencySymbol}
            brandColor={brandColor}
            items={items}
            productToppings={productToppings}
            productFlavors={productFlavors}
            onAdd={openDetail}
            removeItem={removeItem}
            updateQuantity={updateQuantity}
            itemToppingTotal={itemToppingTotal}
          />
        )}

        {!activeCategory && (() => {
          const uncategorized = products.filter(p => !p.category_id);
          if (uncategorized.length === 0) return null;
          return (
            <section>
              <h2 className="text-base font-semibold mb-3">Otros</h2>
              <ProductGrid
                products={uncategorized}
                currencySymbol={currencySymbol}
                brandColor={brandColor}
                items={items}
                productToppings={productToppings}
                productFlavors={productFlavors}
                onAdd={openDetail}
                removeItem={removeItem}
                updateQuantity={updateQuantity}
                itemToppingTotal={itemToppingTotal}
              />
            </section>
          );
        })()}
      </div>

      {/* Product detail modal */}
      <Dialog open={!!detailProduct} onOpenChange={open => { if (!open) setDetailProduct(null); }}>
        <DialogContent className="max-w-sm max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
          {detailProduct && (
            <>
              {/* Product image */}
              {detailProduct.image_url && (
                <div className="w-full h-44 flex-shrink-0 bg-muted overflow-hidden rounded-t-lg">
                  <img src={detailProduct.image_url} alt={detailProduct.name} className="w-full h-full object-cover" />
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {/* Name + price */}
                <div className="px-5 pt-4 pb-3">
                  <DialogHeader>
                    <DialogTitle className="text-left text-lg leading-tight">{detailProduct.name}</DialogTitle>
                  </DialogHeader>
                  {detailProduct.description && (
                    <p className="text-sm text-muted-foreground mt-1">{detailProduct.description}</p>
                  )}
                  <p className="text-base font-bold mt-2" style={{ color: brandColor }}>
                    {currencySymbol}{detailProduct.price.toFixed(2)}
                  </p>
                </div>


                {/* Flavors */}
                {availFlavors.length > 0 && (
                  <div className="px-5 pb-4 space-y-3">
                    {/* Half-half toggle */}
                    {productAllowsHalfHalf && (
                      <div className="flex rounded-lg overflow-hidden border border-border text-sm font-medium">
                        <button
                          onClick={() => { setIsHalfHalf(false); setDetailFlavor2(null); }}
                          className="flex-1 py-2 transition-colors"
                          style={!isHalfHalf ? { backgroundColor: brandColor, color: 'white' } : { color: 'inherit' }}
                        >
                          🍕 Entera
                        </button>
                        <button
                          onClick={() => setIsHalfHalf(true)}
                          className="flex-1 py-2 transition-colors border-l border-border"
                          style={isHalfHalf ? { backgroundColor: brandColor, color: 'white' } : { color: 'inherit' }}
                        >
                          🍕🍕 Mitad y mitad
                        </button>
                      </div>
                    )}

                    {!isHalfHalf ? (
                      /* Single flavor picker */
                      <>
                        <div className="flex items-center gap-1.5">
                          <Flame className="w-4 h-4" style={{ color: brandColor }} />
                          <p className="text-sm font-semibold">Elige tu sabor <span className="text-destructive">*</span></p>
                        </div>
                        <div className="space-y-2">
                          {availFlavors.map(f => {
                            const isSelected = detailFlavor?.id === f.id;
                            return (
                              <label
                                key={f.id}
                                className={cn(
                                  'flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all',
                                  isSelected ? 'border-2 bg-primary/5' : 'border-border hover:bg-muted/50'
                                )}
                                style={isSelected ? { borderColor: brandColor } : {}}
                              >
                                <input type="radio" name="detail-flavor" checked={isSelected} onChange={() => setDetailFlavor(f)} className="flex-shrink-0" style={{ accentColor: brandColor }} />
                                <span className="flex-1 text-sm font-medium">{f.name}</span>
                                {f.price > 0 ? (
                                  <span className="text-sm font-semibold flex-shrink-0" style={{ color: brandColor }}>+{currencySymbol}{f.price.toFixed(2)}</span>
                                ) : (
                                  <span className="text-xs text-muted-foreground flex-shrink-0">Incluido</span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      /* Half-half: two flavor pickers side by side */
                      <div className="space-y-3">
                        {/* Half 1 */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-foreground/60" /> Primera mitad <span className="text-destructive">*</span>
                          </p>
                          <div className="space-y-1.5">
                            {availFlavors.map(f => {
                              const isSelected = detailFlavor?.id === f.id;
                              return (
                                <label
                                  key={f.id}
                                  className={cn(
                                    'flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all text-sm',
                                    isSelected ? 'border-2 bg-primary/5' : 'border-border hover:bg-muted/50'
                                  )}
                                  style={isSelected ? { borderColor: brandColor } : {}}
                                >
                                  <input type="radio" name="half1-flavor" checked={isSelected} onChange={() => setDetailFlavor(f)} className="flex-shrink-0" style={{ accentColor: brandColor }} />
                                  <span className="flex-1 font-medium truncate">{f.name}</span>
                                  {f.price > 0 && <span className="text-xs flex-shrink-0" style={{ color: brandColor }}>+{currencySymbol}{f.price.toFixed(2)}</span>}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        {/* Half 2 */}
                        <div>
                          <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full border-2 border-foreground/60" /> Segunda mitad <span className="text-destructive">*</span>
                          </p>
                          <div className="space-y-1.5">
                            {availFlavors.map(f => {
                              const isSelected = detailFlavor2?.id === f.id;
                              return (
                                <label
                                  key={f.id}
                                  className={cn(
                                    'flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all text-sm',
                                    isSelected ? 'border-2 bg-primary/5' : 'border-border hover:bg-muted/50'
                                  )}
                                  style={isSelected ? { borderColor: brandColor } : {}}
                                >
                                  <input type="radio" name="half2-flavor" checked={isSelected} onChange={() => setDetailFlavor2(f)} className="flex-shrink-0" style={{ accentColor: brandColor }} />
                                  <span className="flex-1 font-medium truncate">{f.name}</span>
                                  {f.price > 0 && <span className="text-xs flex-shrink-0" style={{ color: brandColor }}>+{currencySymbol}{f.price.toFixed(2)}</span>}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground text-center">Se cobra el precio del sabor más alto</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Toppings */}
                {availToppings.length > 0 && (
                  <div className="px-5 pb-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ChefHat className="w-4 h-4" style={{ color: brandColor }} />
                      <p className="text-sm font-semibold">Ingredientes extras <span className="text-xs text-muted-foreground font-normal">(opcional)</span></p>
                    </div>
                    <div className="space-y-2">
                      {availToppings.map(t => {
                        const isSelected = detailToppings.some(x => x.id === t.id);
                        return (
                          <label
                            key={t.id}
                            className={cn(
                              'flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all',
                              isSelected ? 'border-2 bg-primary/5' : 'border-border hover:bg-muted/50'
                            )}
                            style={isSelected ? { borderColor: brandColor } : {}}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleDetailTopping(t)}
                              style={isSelected ? { accentColor: brandColor } : {}}
                            />
                            <span className="flex-1 text-sm font-medium">{t.name}</span>
                            {t.price > 0 ? (
                              <span className="text-sm font-semibold flex-shrink-0" style={{ color: brandColor }}>
                                +{currencySymbol}{t.price.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground flex-shrink-0">Gratis</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer: qty + add button */}
              <div className="px-5 py-4 border-t border-border bg-card flex-shrink-0 space-y-3">
                {/* Quantity selector */}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cantidad</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setDetailQty(q => Math.max(1, q - 1))}
                      className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="w-6 text-center font-semibold">{detailQty}</span>
                    <button
                      onClick={() => setDetailQty(q => q + 1)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white transition-opacity hover:opacity-90"
                      style={{ backgroundColor: brandColor }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Add to cart button */}
                <Button
                  className="w-full text-white font-semibold h-11"
                  style={{ backgroundColor: canConfirm ? brandColor : undefined }}
                  onClick={confirmDetail}
                  disabled={!canConfirm}
                >
                  Agregar al pedido
                  {canConfirm && (
                    <span className="ml-auto font-bold">
                      {currencySymbol}{(detailUnitPrice() * detailQty).toFixed(2)}
                    </span>
                  )}
                </Button>
                {availFlavors.length > 0 && !canConfirm && (
                  <p className="text-xs text-center text-muted-foreground">
                    {isHalfHalf
                      ? !detailFlavor
                        ? 'Elige el sabor de la primera mitad'
                        : 'Elige el sabor de la segunda mitad'
                      : 'Debes elegir un sabor para continuar'}
                  </p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <MenuAIAssistant
        slug={slug!}
        aiEnabled={!!business?.ai_enabled}
        brandColor={brandColor}
        voiceLang={(business as Record<string, unknown>)?.ai_voice_lang as string | undefined ?? 'es-CO'}
        currency={business?.currency ?? 'COP'}
        waNumber={business?.whatsapp_number}
        businessName={business?.name}
        businessId={business?.id}
        menuData={{
          products: products
            .filter(p => p.is_available)
            .map(p => ({
              name: p.name,
              price: p.price ?? 0,
              description: p.description,
              categoryName: categories.find(c => c.id === p.category_id)?.name ?? 'Sin categoría',
            })),
        }}
      />
    </div>
  );
}

function ProductGrid({
  products, currencySymbol, brandColor, items, productToppings, productFlavors, onAdd, removeItem, updateQuantity, itemToppingTotal,
}: {
  products: Product[];
  currencySymbol: string;
  brandColor: string;
  items: ReturnType<typeof useCart>['items'];
  productToppings: ProductToppingsMap;
  productFlavors: ProductFlavorsMap;
  onAdd: (p: Product) => void;
  removeItem: (cartItemId: string) => void;
  updateQuantity: (cartItemId: string, qty: number) => void;
  itemToppingTotal: (item: ReturnType<typeof useCart>['items'][0]) => number;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {products.map(product => {
        const hasToppings = product.uses_toppings || (productToppings[product.id] || []).length > 0;
        const hasFlavors = product.uses_flavors || (productFlavors[product.id] || []).length > 0;
        const hasOptions = hasToppings || hasFlavors;
        const productCartItems = items.filter(i => i.product.id === product.id);
        const totalQty = productCartItems.reduce((s, i) => s + i.quantity, 0);

        return (
          <div
            key={product.id}
            data-testid={`card-product-${product.id}`}
            className="card-elevated flex gap-3 p-3 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onAdd(product)}
          >
            {product.image_url && (
              <img src={product.image_url} alt={product.name} className="w-20 h-20 rounded-lg object-cover flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-1">
                <p className="font-medium text-sm leading-tight" translate="no">{product.name}</p>
                <div className="flex gap-1 flex-shrink-0">
                  {hasFlavors && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                      <Flame className="w-3 h-3" /> sabores
                    </span>
                  )}
                  {hasToppings && (
                    <span className="flex items-center gap-0.5 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                      <ChefHat className="w-3 h-3" /> extras
                    </span>
                  )}
                </div>
              </div>
              {product.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.description}</p>}
              <div className="flex items-center justify-between mt-2">
                <span className="font-semibold text-sm" style={{ color: brandColor }}>
                  {currencySymbol}{product.price.toFixed(2)}
                </span>
                {totalQty === 0 ? (
                  <button
                    data-testid={`button-add-${product.id}`}
                    onClick={e => { e.stopPropagation(); onAdd(product); }}
                    className="w-7 h-7 rounded-lg flex items-center justify-center hover:opacity-90 transition-opacity text-white flex-shrink-0"
                    style={{ backgroundColor: brandColor }}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                ) : hasOptions ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-muted">{totalQty} en pedido</span>
                    <button
                      onClick={e => { e.stopPropagation(); onAdd(product); }}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-white"
                      style={{ backgroundColor: brandColor }}
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => updateQuantity(productCartItems[0].cartItemId, productCartItems[0].quantity - 1)}
                      className="w-6 h-6 rounded-md bg-muted flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-5 text-center text-xs font-semibold">{productCartItems[0].quantity}</span>
                    <button
                      onClick={() => updateQuantity(productCartItems[0].cartItemId, productCartItems[0].quantity + 1)}
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
