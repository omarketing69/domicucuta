import { CartItem } from '@/hooks/useCart';

export function buildWhatsAppMessage(
  businessName: string,
  items: CartItem[],
  total: number,
  currency: string,
  customerName?: string,
  notes?: string
): string {
  const currencySymbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'MXN' ? '$' : currency;

  let message = `🛒 *Nuevo pedido - ${businessName}*\n\n`;

  if (customerName) message += `👤 *Cliente:* ${customerName}\n\n`;

  message += `*Productos:*\n`;
  items.forEach(item => {
    message += `• ${item.product.name} x${item.quantity} — ${currencySymbol}${(item.product.price * item.quantity).toFixed(2)}\n`;
  });

  message += `\n*Total: ${currencySymbol}${total.toFixed(2)}*`;

  if (notes) message += `\n\n📝 *Notas:* ${notes}`;

  return encodeURIComponent(message);
}

export function getWhatsAppUrl(phone: string, message: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${message}`;
}
