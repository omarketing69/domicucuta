export default function LoginGate({ error }) {
  const errorMessages = {
    'Token expirado': 'El enlace de acceso expiró. Por favor accede de nuevo desde el panel de DomiCircusPop.',
    'Firma inválida': 'Token de acceso inválido.',
  };

  const errorText = error ? (errorMessages[error] || `Error: ${error}`) : null;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: 24, padding: 24,
      background: 'var(--bg)',
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: 'var(--primary)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 24, fontWeight: 700, color: 'var(--primary-fg)',
      }}>
        C
      </div>

      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
          CRM Multi-Canal
        </h1>
        {errorText ? (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: 8, padding: '12px 16px', color: '#dc2626',
            fontSize: 14, marginTop: 8,
          }}>
            {errorText}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6 }}>
            Accede desde tu panel de administración en DomiCircusPop
            para iniciar sesión automáticamente.
          </p>
        )}
      </div>
    </div>
  );
}
