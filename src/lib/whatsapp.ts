import { CartItem } from '@/hooks/useCart';

const DELIVERY_LABELS: Record<string, string> = {
  local:    '🏠 En el local',
  pickup:   '🛍️ Para recoger',
  delivery: '🛵 Domicilio',
};

export function buildWhatsAppMessage(
  businessName: string,
  items: CartItem[],
  total: number,
  currency: string,
  customerName?: string,
  notes?: string,
  deliveryType?: string,
  deliveryAddress?: string,
): string {
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'MXN' ? '$' : currency;

  let message = `🛒 *Nuevo pedido - ${businessName}*\n\n`;

  if (customerName) message += `👤 *Cliente:* ${customerName}\n`;
  if (deliveryType) {
    message += `📦 *Entrega:* ${DELIVERY_LABELS[deliveryType] || deliveryType}\n`;
    if (deliveryType === 'delivery' && deliveryAddress) {
      message += `📍 *Dirección:* ${deliveryAddress}\n`;
    }
  }
  message += '\n';

  message += `*Productos:*\n`;
  items.forEach(item => {
    const flavorPrice = item.flavorHalf2
      ? Math.max(item.flavor?.price || 0, item.flavorHalf2.price)
      : (item.flavor?.price || 0);
    const toppingTotal = item.toppings.reduce((s, t) => s + t.price, 0);
    const linePrice = (item.product.price + flavorPrice + toppingTotal) * item.quantity;

    message += `• ${item.product.name} x${item.quantity} — ${currencySymbol}${linePrice.toFixed(2)}\n`;

    if (item.flavorHalf2) {
      message += `    🍕 Mitad y mitad:\n`;
      message += `        ½ ${item.flavor?.name || '-'}${item.flavor && item.flavor.price > 0 ? ` (+${currencySymbol}${item.flavor.price.toFixed(2)})` : ''}\n`;
      message += `        ½ ${item.flavorHalf2.name}${item.flavorHalf2.price > 0 ? ` (+${currencySymbol}${item.flavorHalf2.price.toFixed(2)})` : ''}\n`;
    } else if (item.flavor) {
      message += `    🔥 Sabor: ${item.flavor.name}${item.flavor.price > 0 ? ` (+${currencySymbol}${item.flavor.price.toFixed(2)})` : ''}\n`;
    }

    if (item.toppings.length > 0) {
      item.toppings.forEach(t => {
        message += `    ↳ ${t.name}${t.price > 0 ? ` (+${currencySymbol}${t.price.toFixed(2)})` : ''}\n`;
      });
    }
  });

  message += `\n*Total: ${currencySymbol}${total.toFixed(2)}*`;

  if (notes) message += `\n\n📝 *Notas:* ${notes}`;

  return encodeURIComponent(message);
}

export function getWhatsAppUrl(phone: string, message: string): string {
  let cleanPhone = phone.replace(/\D/g, '');

  // Auto-add Colombian country code (57) if number is 10 digits starting with 3
  // (Colombian mobile format: 3XX XXX XXXX)
  if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) {
    cleanPhone = `57${cleanPhone}`;
  }

  return `https://wa.me/${cleanPhone}?text=${message}`;
}
