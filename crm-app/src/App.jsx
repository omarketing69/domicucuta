import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import LoginGate from './pages/LoginGate.jsx';

const SUPABASE_URL = 'https://khhxcruhhhzuuykfeivd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaHhjcnVoaGh6dXV5a2ZlaXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzA3NjcsImV4cCI6MjA4OTI0Njc2N30.RoALBCT3HpNSkBGl4NsdML0H1qYwI5uqIM32jWIyBnY';
const SESSION_KEY = 'crm_session';

async function verifySsoToken(token) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-sso-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Token inválido');
  }
  return res.json();
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      window.history.replaceState({}, '', window.location.pathname);
      verifySsoToken(token)
        .then(user => {
          localStorage.setItem(SESSION_KEY, JSON.stringify(user));
          setSession(user);
          window.parent?.postMessage({ type: 'crm_ready' }, '*');
        })
        .catch(err => {
          setError(err.message);
          setSession(null);
        });
      return;
    }

    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) {
      try {
        const user = JSON.parse(stored);
        setSession(user);
        window.parent?.postMessage({ type: 'crm_ready' }, '*');
      } catch {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
      }
    } else {
      setSession(null);
    }
  }, []);

  if (session === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12 }}>
        <Spinner />
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Conectando con el CRM…</p>
      </div>
    );
  }

  if (!session) {
    return <LoginGate error={error} />;
  }

  return (
    <Dashboard
      session={session}
      onLogout={() => {
        localStorage.removeItem(SESSION_KEY);
        setSession(null);
      }}
    />
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes crm-spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{
        width: 32, height: 32, border: '3px solid #e2e8f0',
        borderTopColor: '#f59e0b', borderRadius: '50%',
        animation: 'crm-spin 0.8s linear infinite',
      }} />
    </>
  );
}
