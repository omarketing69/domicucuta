import { useState, useEffect, useRef } from 'react';
import { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];

export interface SelectedTopping {
  id: string;
  name: string;
  price: number;
}

export interface SelectedFlavor {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  cartItemId: string;
  product: Product;
  quantity: number;
  flavor: SelectedFlavor | null;
  flavorHalf2: SelectedFlavor | null;
  toppings: SelectedTopping[];
}

export function useCart(businessId?: string) {
  const [items, setItems] = useState<CartItem[]>([]);
  const initialized = useRef(false);

  // Load from localStorage when businessId first becomes available
  useEffect(() => {
    if (!businessId) return;
    if (!initialized.current) {
      initialized.current = true;
      try {
        const saved = localStorage.getItem(`cart_${businessId}`);
        if (saved) setItems(JSON.parse(saved));
      } catch { /* ignore */ }
    }
  }, [businessId]);

  // Persist to localStorage whenever items change (only after businessId is ready)
  useEffect(() => {
    if (!businessId || !initialized.current) return;
    localStorage.setItem(`cart_${businessId}`, JSON.stringify(items));
  }, [items, businessId]);

  const buildCartItemId = (
    productId: string,
    flavorId: string | null,
    flavorHalf2Id: string | null,
    toppingIds: string[]
  ) => `${productId}__${flavorId || ''}__${flavorHalf2Id || ''}__${[...toppingIds].sort().join('_')}`;

  const addItem = (
    product: Product,
    flavor: SelectedFlavor | null = null,
    toppings: SelectedTopping[] = [],
    flavorHalf2: SelectedFlavor | null = null
  ) => {
    const cartItemId = buildCartItemId(product.id, flavor?.id || null, flavorHalf2?.id || null, toppings.map(t => t.id));
    setItems(prev => {
      const existing = prev.find(i => i.cartItemId === cartItemId);
      if (existing) {
        return prev.map(i => i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { cartItemId, product, quantity: 1, flavor: flavor || null, flavorHalf2: flavorHalf2 || null, toppings }];
    });
  };

  const removeItem = (cartItemId: string) => {
    setItems(prev => prev.filter(i => i.cartItemId !== cartItemId));
  };

  const updateQuantity = (cartItemId: string, quantity: number) => {
    if (quantity <= 0) { removeItem(cartItemId); return; }
    setItems(prev => prev.map(i => i.cartItemId === cartItemId ? { ...i, quantity } : i));
  };

  const clearCart = () => setItems([]);

  const itemFlavorPrice = (item: CartItem) => {
    const p1 = item.flavor?.price || 0;
    const p2 = item.flavorHalf2?.price || 0;
    return Math.max(p1, p2);
  };

  const itemToppingTotal = (item: CartItem) =>
    item.toppings.reduce((s, t) => s + t.price, 0);

  const total = items.reduce(
    (sum, i) => sum + (i.product.price + itemFlavorPrice(i) + itemToppingTotal(i)) * i.quantity,
    0
  );
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, addItem, removeItem, updateQuantity, clearCart, total, count, itemFlavorPrice, itemToppingTotal };
}
