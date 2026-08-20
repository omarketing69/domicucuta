import express from 'express';
import session from 'express-session';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const SSO_SECRET = process.env.SSO_SECRET;

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
}

function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token inválido');

  const [headerB64, payloadB64, sigB64] = parts;
  const signingInput = `${headerB64}.${payloadB64}`;

  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  if (expectedSig !== sigB64) throw new Error('Firma inválida');

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expirado');
  }

  return payload;
}

app.use(express.json());
app.use(
  session({
    secret: SSO_SECRET || 'dev-fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.get('/api/sso', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.redirect('/?error=missing_token');
  }

  if (!SSO_SECRET) {
    console.error('SSO_SECRET no configurado');
    return res.redirect('/?error=server_config');
  }

  try {
    const payload = verifyJwt(token, SSO_SECRET);
    req.session.user = {
      email: payload.email,
      businessId: payload.business_id,
      businessName: payload.business_name,
    };
    res.redirect('/dashboard');
  } catch (err) {
    console.error('SSO error:', err.message);
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json(req.session.user);
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`CRM server escuchando en puerto ${PORT}`);
});
