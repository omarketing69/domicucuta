const CHANNELS = [
  { id: 'all', label: 'Todas' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
];

const DEMO_CONVERSATIONS = [
  { id: 1, name: 'María García', channel: 'whatsapp', lastMsg: 'Quiero hacer un pedido de pizza', time: 'hace 5 min', unread: 2, avatar: 'MG' },
  { id: 2, name: 'Carlos López', channel: 'instagram', lastMsg: '¿Tienen domicilio para la zona norte?', time: 'hace 12 min', unread: 0, avatar: 'CL' },
  { id: 3, name: 'Ana Martínez', channel: 'whatsapp', lastMsg: 'Gracias! Todo perfecto 🙏', time: 'hace 1h', unread: 0, avatar: 'AM' },
  { id: 4, name: 'Pedro Sánchez', channel: 'facebook', lastMsg: '¿Cuál es el horario de atención?', time: 'hace 2h', unread: 1, avatar: 'PS' },
  { id: 5, name: 'Laura Rodríguez', channel: 'whatsapp', lastMsg: 'Voy a pedir de nuevo mañana', time: 'ayer', unread: 0, avatar: 'LR' },
];

const CHANNEL_COLORS = {
  whatsapp: '#25d366',
  instagram: '#e1306c',
  facebook: '#1877f2',
};

export default function ConversationsPanel({ session }) {
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <ConversationList session={session} />
      <EmptyChat />
    </div>
  );
}

function ConversationList({ session }) {
  return (
    <div style={{
      width: 320, borderRight: '1px solid var(--border)', height: '100%',
      display: 'flex', flexDirection: 'column', background: 'var(--surface)',
    }}>
      <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Conversaciones</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CHANNELS.map(ch => (
            <button key={ch.id} style={{
              padding: '4px 10px', borderRadius: 20, fontSize: 12, border: '1px solid var(--border)',
              background: ch.id === 'all' ? 'var(--primary)' : 'transparent',
              color: ch.id === 'all' ? '#fff' : 'var(--text-muted)',
              fontWeight: ch.id === 'all' ? 600 : 400, cursor: 'pointer',
            }}>
              {ch.label}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {DEMO_CONVERSATIONS.map(conv => (
          <div key={conv.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderBottom: '1px solid var(--border)', cursor: 'pointer',
            transition: 'background 0.1s',
          }}
            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: '#e2e8f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, color: 'var(--text-muted)',
              flexShrink: 0, position: 'relative',
            }}>
              {conv.avatar}
              <div style={{
                position: 'absolute', bottom: 0, right: 0, width: 12, height: 12,
                borderRadius: '50%', background: CHANNEL_COLORS[conv.channel],
                border: '2px solid #fff',
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{conv.name}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{conv.time}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {conv.lastMsg}
              </p>
            </div>
            {conv.unread > 0 && (
              <div style={{
                minWidth: 18, height: 18, borderRadius: 9, background: 'var(--primary)',
                color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex',
                alignItems: 'center', justifyContent: 'center', padding: '0 4px',
              }}>
                {conv.unread}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, color: 'var(--text-muted)',
    }}>
      <div style={{ fontSize: 48 }}>💬</div>
      <p style={{ fontSize: 15, fontWeight: 500 }}>Selecciona una conversación</p>
      <p style={{ fontSize: 13 }}>Elige un chat de la lista para ver los mensajes</p>
    </div>
  );
}
