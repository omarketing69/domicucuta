import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import { supabase } from '@/integrations/supabase/client';
import { Check, ChefHat, Zap, Crown, Sparkles, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

const plans = [
  {
    id: 'free',
    name: 'Gratis',
    price: 0,
    period: '30 días',
    description: 'Prueba todo sin compromiso. Sin tarjeta.',
    icon: Sparkles,
    highlight: false,
    badge: null,
    features: [
      'Menú público con tu link único',
      'Hasta 20 productos',
      'Hasta 3 categorías',
      'Pedidos por WhatsApp',
      'Panel de administración',
      'Válido 30 días',
    ],
    cta: 'Empezar gratis',
    ctaVariant: 'outline' as const,
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 10,
    period: 'mes',
    description: 'Para negocios que están creciendo.',
    icon: Zap,
    highlight: true,
    badge: 'Más popular',
    features: [
      'Todo lo del plan Gratis',
      'Productos ilimitados',
      'Categorías ilimitadas',
      'Pedidos en tiempo real',
      'Historial de pedidos completo',
      'Soporte prioritario',
    ],
    cta: 'Elegir Starter',
    ctaVariant: 'default' as const,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 30,
    period: 'mes',
    description: 'Para negocios con alto volumen de pedidos.',
    icon: Crown,
    highlight: false,
    badge: null,
    features: [
      'Todo lo del plan Starter',
      'Múltiples sucursales',
      'Imágenes en productos y categorías',
      'Logo del negocio personalizado',
      'Análisis de ventas avanzado',
      'Onboarding dedicado',
    ],
    cta: 'Elegir Pro',
    ctaVariant: 'default' as const,
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const { business, refetch } = useBusiness();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelectPlan = async (planId: string) => {
    if (!user) {
      navigate('/register');
      return;
    }

    if (!business) {
      navigate('/admin/onboarding');
      return;
    }

    if (business.plan === planId) {
      toast({ title: 'Ya tienes este plan activo.' });
      return;
    }

    setLoading(planId);
    try {
      const now = new Date();
      const expiresAt = new Date(now);
      if (planId === 'free') {
        expiresAt.setDate(expiresAt.getDate() + 30);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }

      const { error } = await supabase
        .from('businesses')
        .update({
          plan: planId,
          plan_started_at: now.toISOString(),
          plan_expires_at: expiresAt.toISOString(),
        })
        .eq('id', business.id);

      if (error) throw error;

      refetch();
      toast({
        title: '¡Plan actualizado!',
        description: `Tu plan ${plans.find(p => p.id === planId)?.name} está activo.`,
      });
      navigate('/admin/dashboard');
    } catch {
      toast({ title: 'Error al actualizar el plan', variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <ChefHat className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm tracking-tight">MenuApp</span>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/admin/dashboard">
                <Button variant="outline" size="sm">Mi panel</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">Iniciar sesión</Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Registrarse</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-16 pb-12 text-center px-4">
        <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium px-3 py-1 rounded-full border border-primary/20 mb-5">
          <Sparkles className="w-3 h-3" />
          Precios simples y transparentes
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight mb-4 max-w-2xl mx-auto">
          Elige el plan que se ajusta a tu negocio
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
          Empieza gratis, crece sin límites. Cancela cuando quieras.
        </p>
      </section>

      {/* Plans */}
      <section className="pb-20 px-4">
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 items-start">
          {plans.map((plan) => {
            const Icon = plan.icon;
            const isCurrentPlan = business?.plan === plan.id;
            const isLoading = loading === plan.id;

            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 flex flex-col gap-6 transition-shadow ${
                  plan.highlight
                    ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/30'
                    : 'border-border bg-card shadow-sm'
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full shadow">
                      {plan.badge}
                    </span>
                  </div>
                )}

                {/* Plan header */}
                <div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
                    plan.highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="text-xl font-semibold">{plan.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                </div>

                {/* Price */}
                <div>
                  {plan.price === 0 ? (
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">Gratis</span>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-semibold text-muted-foreground">$</span>
                      <span className="text-4xl font-bold">{plan.price}</span>
                      <span className="text-muted-foreground text-sm">/ {plan.period}</span>
                    </div>
                  )}
                  {plan.price === 0 && (
                    <p className="text-sm text-muted-foreground mt-0.5">Sin tarjeta de crédito</p>
                  )}
                </div>

                {/* CTA */}
                <Button
                  variant={plan.highlight ? 'default' : plan.ctaVariant}
                  className="w-full"
                  onClick={() => handleSelectPlan(plan.id)}
                  disabled={isCurrentPlan || isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Activando...
                    </span>
                  ) : isCurrentPlan ? (
                    <span className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      Plan actual
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      {plan.cta}
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  )}
                </Button>

                {/* Features */}
                <ul className="space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm">
                      <Check className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        plan.highlight ? 'text-primary' : 'text-muted-foreground'
                      }`} />
                      <span className={plan.highlight ? 'text-foreground' : 'text-muted-foreground'}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* FAQ / Trust */}
      <section className="border-t border-border py-14 px-4 bg-muted/30">
        <div className="max-w-2xl mx-auto text-center space-y-3">
          <h3 className="text-lg font-semibold">¿Tienes dudas?</h3>
          <p className="text-muted-foreground text-sm">
            Todos los planes incluyen el mismo panel de administración completo. Puedes cambiar de plan en cualquier momento desde tu configuración.
          </p>
          <Link to={user ? '/admin/dashboard' : '/register'} className="inline-flex items-center gap-1.5 text-primary text-sm font-medium hover:underline mt-2">
            {user ? 'Ir a mi panel' : 'Crear mi cuenta gratis'}
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
