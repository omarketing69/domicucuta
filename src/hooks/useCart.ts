import { useState, useEffect } from 'react';
import { Database } from '@/integrations/supabase/types';

type Product = Database['public']['Tables']['products']['Row'];

export interface CartItem {
  product: Product;
  quantity: number;
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

  const addItem = (product: Product) => {
    setItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeItem = (productId: string) => {
    setItems(prev => prev.filter(i => i.product.id !== productId));
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) { removeItem(productId); return; }
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity } : i));
  };

  const clearCart = () => setItems([]);

  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0);
  const count = items.reduce((sum, i) => sum + i.quantity, 0);

  return { items, addItem, removeItem, updateQuantity, clearCart, total, count };
}
