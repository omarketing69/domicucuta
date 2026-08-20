export default function Sidebar({ session, tabs, activeTab, onTabChange, onLogout }) {
  return (
    <aside style={{
      width: 220, background: 'var(--sidebar-bg)', display: 'flex',
      flexDirection: 'column', flexShrink: 0, height: '100vh',
    }}>
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, color: '#fff', fontSize: 14, flexShrink: 0,
          }}>
            C
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.businessName}
            </div>
            <div style={{ fontSize: 11, color: 'var(--sidebar-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {session.email}
            </div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '12px 8px' }}>
        {tabs.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 10px', borderRadius: 6, border: 'none',
                background: isActive ? 'var(--sidebar-active-bg)' : 'transparent',
                color: isActive ? 'var(--sidebar-active)' : 'var(--sidebar-text)',
                fontSize: 14, fontWeight: isActive ? 600 : 400,
                cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                marginBottom: 2,
              }}
            >
              <span style={{ fontSize: 16 }}>{tab.icon}</span>
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '12px 8px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <button
          onClick={onLogout}
          style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '9px 10px', borderRadius: 6, border: 'none',
            background: 'transparent', color: 'var(--sidebar-text)',
            fontSize: 14, cursor: 'pointer', textAlign: 'left',
          }}
        >
          <span>🚪</span> Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
