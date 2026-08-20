const DEMO_CUSTOMERS = [
  { id: 1, name: 'María García', phone: '+57 300 123 4567', orders: 8, tag: 'VIP', lastOrder: 'Hace 2 días' },
  { id: 2, name: 'Carlos López', phone: '+57 310 234 5678', orders: 3, tag: 'Frecuente', lastOrder: 'Hace 1 semana' },
  { id: 3, name: 'Ana Martínez', phone: '+57 320 345 6789', orders: 15, tag: 'VIP', lastOrder: 'Hoy' },
  { id: 4, name: 'Pedro Sánchez', phone: '+57 311 456 7890', orders: 1, tag: 'Nuevo', lastOrder: 'Hace 3 días' },
];

const TAG_COLORS = {
  VIP: { bg: '#f3e8ff', color: '#7c3aed' },
  Frecuente: { bg: '#dbeafe', color: '#1d4ed8' },
  Nuevo: { bg: '#dcfce7', color: '#15803d' },
  Inactivo: { bg: '#f1f5f9', color: '#64748b' },
};

export default function CustomersPanel() {
  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Clientes</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>{DEMO_CUSTOMERS.length} clientes registrados</p>
      </div>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {DEMO_CUSTOMERS.map(c => {
          const tag = TAG_COLORS[c.tag] || TAG_COLORS['Nuevo'];
          return (
            <div key={c.id} style={{
              background: 'var(--surface)', borderRadius: 10,
              border: '1px solid var(--border)', padding: 16,
              boxShadow: 'var(--shadow)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: 'var(--primary)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14, flexShrink: 0,
                }}>
                  {c.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.phone}</div>
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                  background: tag.bg, color: tag.color, flexShrink: 0,
                }}>
                  {c.tag}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, color: 'var(--text-muted)' }}>
                <span>🛍️ {c.orders} pedidos</span>
                <span>🕐 {c.lastOrder}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
