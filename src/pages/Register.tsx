import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, MailCheck } from 'lucide-react';
import logo from '@/assets/logo.png';

export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/login` }
    });
    if (error) { setError(error.message); setLoading(false); return; }

    if (data.session) {
      // Email confirmation is disabled — user is immediately logged in
      navigate('/admin/onboarding');
    } else {
      // Email confirmation is required — show check-your-inbox screen
      setConfirming(true);
      setLoading(false);
    }
  };

  if (confirming) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex items-center gap-2 justify-center mb-8">
            <img src={logo} alt="WhatOrden" className="w-10 h-10" />
            <span className="text-xl font-semibold tracking-tight">WhatOrden</span>
          </div>
          <div className="card-elevated p-8 space-y-4">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
              <MailCheck className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-lg font-semibold">Revisa tu correo</h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Te enviamos un enlace de confirmación a <span className="font-medium text-foreground">{email}</span>.
              Haz clic en el enlace para activar tu cuenta y continuar con la configuración.
            </p>
            <p className="text-xs text-muted-foreground">
              ¿No lo ves? Revisa la carpeta de spam.
            </p>
          </div>
          <p className="text-center text-sm text-muted-foreground mt-4">
            ¿Ya confirmaste?{' '}
            <Link to="/login" className="text-primary font-medium hover:underline">
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <img src={logo} alt="WhatOrden" className="w-10 h-10" />
          <span className="text-xl font-semibold tracking-tight">WhatOrden</span>
        </div>

        <div className="card-elevated p-6">
          <h1 className="text-lg font-semibold mb-1">Crear cuenta</h1>
          <p className="text-sm text-muted-foreground mb-6">Crea tu menú digital gratis</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={e => setPassword(e.target.value)}
                minLength={6}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Crear cuenta
            </Button>
          </form>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-4">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-primary font-medium hover:underline">
            Inicia sesión
          </Link>
        </p>
      </div>
    </div>
  );
}
