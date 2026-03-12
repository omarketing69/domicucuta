import { useState, useEffect } from 'react';
import { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];

export interface SelectedTopping {
  id: string;
  name: string;
  price: number;
}

export interface CartItem {
  cartItemId: string; // unique per product+toppings combo
  product: Product;
  quantity: number;
  toppings: SelectedTopping[];
}

export function useCart(businessId?: string) {
  const storageKey = `cart_${businessId}`;
  const [items, setItems] = useState<CartItem[]>(() => {
    if (!businessId) return [];
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch { return []; }
  });

  useEffect(() => {
    if (businessId) localStorage.setItem(storageKey, JSON.stringify(items));
  }, [items, storageKey, businessId]);

  const buildCartItemId = (productId: string, toppingIds: string[]) =>
    `${productId}__${[...toppingIds].sort().join('_')}`;

  const addItem = (product: Product, toppings: SelectedTopping[] = []) => {
    const cartItemId = buildCartItemId(product.id, toppings.map(t => t.id));
    setItems(prev => {
      const existing = prev.find(i => i.cartItemId === cartItemId);
      if (existing) {
        return prev.map(i => i.cartItemId === cartItemId ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { cartItemId, product, quantity: 1, toppings }];
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

  const itemToppingTotal = (item: CartItem) =>
    item.toppings.reduce((s, t) => s + t.price, 0);

  const total = items.reduce(
    (sum, i) => sum + (i.product.price + itemToppingTotal(i)) * i.quantity,
    0
  );
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, addItem, removeItem, updateQuantity, clearCart, total, count, itemToppingTotal };
}
