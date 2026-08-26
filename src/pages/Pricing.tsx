import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useBusiness } from '@/hooks/useBusiness';
import { supabase } from '@/integrations/supabase/client';
import { Check, ChefHat, ArrowRight, Loader2, Zap, Crown, Sparkles, Bot, BarChart3, Truck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface PlanRow {
  id: string;
  label: string;
  price_monthly: number;
  description: string | null;
  features: string[];
  badge_text: string | null;
  period_text: string | null;
  cta_text: string | null;
  highlight: boolean;
  is_active: boolean;
}

const PLAN_META: Record<string, {
  emoji: string;
  resultName: string;
  techName: string;
  desc: string;
  cta: string;
  features: string[];
  badge?: string;
}> = {
  free: {
    emoji: '🚀',
    resultName: 'Empieza Gratis',
    techName: 'Plan Demo',
    desc: 'Prueba toda la experiencia del Centro de Ventas con IA durante 30 días. Sin compromiso. Sin tarjeta.',
    cta: 'Empieza gratis ahora',
    features: [
      'Centro de Ventas con IA disponible 24 horas',
      'Menú Digital en un solo enlace (WhatsApp, redes, QR)',
      'Productos ilimitados con fotos, precios y variantes',
      'Agente IA que vende, sugiere y hace venta cruzada',
      'Director Comercial con IA — detecta oportunidades y recuerda al cliente',
      'Centro Inteligente de Pedidos — controla tiempos y entregas',
      'Dashboard comercial con ventas, clientes y recomendaciones IA',
      'Al terminar continúas con Plan Starter sin perder nada',
    ],
  },
  starter: {
    emoji: '📈',
    resultName: 'Haz Crecer tu Negocio',
    techName: 'Plan Starter',
    desc: 'Todo lo del período demo, para siempre. La solución completa para vender más sin depender de integraciones complejas.',
    cta: 'Haz crecer mi negocio',
    badge: 'Ideal para restaurantes y negocios locales',
    features: [
      'Todo lo incluido en Empieza Gratis, sin límite de tiempo',
      'Uso permanente y actualizaciones continuas',
      'Historial completo de clientes y pedidos',
      'Estadísticas comerciales de tu negocio',
      'La IA aprende continuamente los gustos de tus clientes',
      'Soporte incluido',
    ],
  },
  pro: {
    emoji: '🤖',
    resultName: 'Automatiza y Escala tus Ventas',
    techName: 'Plan Pro',
    desc: 'Convierte tu Centro de Ventas con IA en una máquina automática de fidelización y remarketing.',
    cta: 'Automatizar mis ventas',
    features: [
      'Todo lo incluido en Haz Crecer tu Negocio',
      'Campañas inteligentes: solo a clientes con mayor probabilidad de compra',
      'Remarketing automático: recupera carritos y reactiva clientes inactivos',
      'Segmentación por VIP, frecuentes, nuevos, inactivos, cumpleaños y más',
      'La IA recomienda el mejor momento para lanzar promociones',
      'Integración oficial con WhatsApp — marketing profesional y escalable',
      'Automatización comercial avanzada: fidelización y recuperación sin intervención manual',
    ],
  },
};

// Paid plans (starter/pro) aren't self-activated — there's no payment
// gateway integrated yet, so upgrading routes the owner to WhatsApp to
// arrange payment manually; only the free plan stays instant self-serve.
const PLATFORM_CONTACT_WHATSAPP = '573154113761';

const PLAN_ICONS: Record<string, typeof Sparkles> = {
  free: Sparkles,
  starter: Zap,
  pro: Crown,
};

const FALLBACK_PLANS: PlanRow[] = [
  {
    id: 'free',
    label: 'Empieza Gratis',
    price_monthly: 0,
    description: 'Prueba toda la experiencia del Centro de Ventas con IA durante 30 días. Sin compromiso. Sin tarjeta.',
    features: PLAN_META.free.features,
    badge_text: null,
    period_text: '30 días',
    cta_text: 'Empieza gratis ahora',
    highlight: false,
    is_active: true,
  },
  {
    id: 'starter',
    label: 'Haz Crecer tu Negocio',
    price_monthly: 10,
    description: 'Todo lo del período demo, para siempre.',
    features: PLAN_META.starter.features,
    badge_text: 'Ideal para restaurantes y negocios locales',
    period_text: 'mes',
    cta_text: 'Haz crecer mi negocio',
    highlight: true,
    is_active: true,
  },
  {
    id: 'pro',
    label: 'Automatiza y Escala tus Ventas',
    price_monthly: 30,
    description: 'Convierte tu Centro de Ventas con IA en una máquina automática de fidelización.',
    features: PLAN_META.pro.features,
    badge_text: null,
    period_text: 'mes',
    cta_text: 'Automatizar mis ventas',
    highlight: false,
    is_active: true,
  },
];

const PILLARS = [
  {
    icon: Smartphone,
    emoji: '📱',
    title: 'Menú Digital Inteligente',
    desc: 'Un único enlace para compartir en WhatsApp, redes sociales o QR de mesa. Tus clientes ordenan sin llamar.',
  },
  {
    icon: Bot,
    emoji: '🤖',
    title: 'Agente IA que vende por ti',
    desc: 'Responde preguntas, sugiere productos, hace venta cruzada y cierra ventas solo — incluso a las 3am.',
  },
  {
    icon: BarChart3,
    emoji: '📊',
    title: 'Director Comercial con IA',
    desc: 'Interpreta conversaciones, detecta oportunidades, recuerda el historial del cliente y propone acciones concretas.',
  },
  {
    icon: Truck,
    emoji: '🚚',
    title: 'Centro Inteligente de Pedidos',
    desc: 'Controla el flujo completo desde que entra el pedido hasta que el cliente lo recibe, supervisando tiempos y entregas.',
  },
];

export default function Pricing() {
  const { user } = useAuth();
  const { business, refetch } = useBusiness();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    supabase
      .from('plan_pricing')
      .select('id, label, price_monthly, description, features, badge_text, period_text, cta_text, highlight, is_active')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true })
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setPlans(FALLBACK_PLANS);
        } else {
          setPlans(data as PlanRow[]);
        }
        setLoadingPlans(false);
      });
  }, []);

  const handleSelectPlan = async (planId: string) => {
    if (!user) { navigate('/register'); return; }
    if (!business) { navigate('/admin/onboarding'); return; }
    if (business.plan === planId) {
      toast({ title: 'Ya tienes este plan activo.' });
      return;
    }

    // Paid plans require manual activation (no payment gateway yet) — send
    // the owner to WhatsApp to arrange payment instead of activating for free.
    if (planId !== 'free') {
      const meta = PLAN_META[planId];
      const planName = meta ? `${meta.techName} (${meta.resultName})` : `Plan ${planId}`;
      const message = `Hola, quiero activar el ${planName} para mi negocio "${business.name}".`;
      window.open(`https://wa.me/${PLATFORM_CONTACT_WHATSAPP}?text=${encodeURIComponent(message)}`, '_blank');
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
        .update({ plan: planId, plan_started_at: now.toISOString(), plan_expires_at: expiresAt.toISOString() })
        .eq('id', business.id);

      if (error) throw error;
      refetch();
      const meta = PLAN_META[planId];
      const label = meta ? meta.resultName : planId;
      toast({ title: '¡Plan actualizado!', description: `Tu plan "${label}" está activo.` });
      navigate('/admin/dashboard');
    } catch {
      toast({ title: 'Error al actualizar el plan', variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <ChefHat className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-semibold text-sm tracking-tight">WhatOrden</span>
          </Link>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link to="/admin/dashboard">
                  <Button variant="outline" size="sm" data-testid="btn-mi-panel">Mi panel</Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={handleSignOut} data-testid="btn-sign-out">Cerrar sesión</Button>
              </>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm" data-testid="btn-login">Iniciar sesión</Button>
                </Link>
                <Link to="/register">
                  <Button size="sm" data-testid="btn-register">Registrarse</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="pt-16 pb-12 text-center px-4">
        <div className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-semibold px-3 py-1.5 rounded-full border border-primary/20 mb-6">
          <Sparkles className="w-3 h-3" />
          No es un menú digital. No es un chatbot. Es tu Centro de Ventas con IA.
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-5 max-w-3xl mx-auto leading-tight">
          Contrata un vendedor inteligente que{' '}
          <span className="text-primary">nunca duerme.</span>
        </h1>
        <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
          El empleado comercial con IA que trabaja 24 horas para atraer clientes, vender más,
          recuperar ventas perdidas y fidelizar compradores mientras tú administras tu negocio.
        </p>
      </section>

      {/* ── Pillars ── */}
      <section className="pb-14 px-4">
        <div className="max-w-5xl mx-auto">
          <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-8">
            ¿Qué incluye tu Centro de Ventas con IA?
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PILLARS.map(({ emoji, title, desc }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow"
              >
                <span className="text-3xl">{emoji}</span>
                <h3 className="font-semibold text-sm leading-snug">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Plans ── */}
      <section className="pb-20 px-4">
        <p className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-10">
          Elige tu objetivo
        </p>
        {loadingPlans ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-6 items-start">
            {plans.map((plan) => {
              const meta = PLAN_META[plan.id];
              const Icon = PLAN_ICONS[plan.id] ?? Sparkles;
              const isCurrentPlan = business?.plan === plan.id;
              const isLoading = loading === plan.id;
              const price = Number(plan.price_monthly);
              const features = (meta?.features ?? plan.features ?? []);
              const ctaText = meta?.cta ?? plan.cta_text ?? 'Elegir plan';
              const badgeText = meta?.badge ?? plan.badge_text;

              return (
                <div
                  key={plan.id}
                  data-testid={`plan-card-${plan.id}`}
                  className={cn(
                    'relative rounded-2xl border p-6 flex flex-col gap-6 transition-shadow',
                    plan.highlight
                      ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10 ring-1 ring-primary/30'
                      : 'border-border bg-card shadow-sm'
                  )}
                >
                  {badgeText && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
                      <span className="bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full shadow">
                        {badgeText}
                      </span>
                    </div>
                  )}

                  {/* Plan header */}
                  <div>
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center mb-4',
                      plan.highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                    )}>
                      <Icon className="w-5 h-5" />
                    </div>
                    {/* Result-focused name */}
                    <h2 className="text-xl font-bold leading-tight">
                      {meta ? `${meta.emoji} ${meta.resultName}` : plan.label}
                    </h2>
                    {/* Technical name as secondary reference */}
                    {meta && (
                      <p className="text-xs text-muted-foreground mt-0.5">{meta.techName}</p>
                    )}
                    <p className="text-sm text-muted-foreground mt-2 leading-snug">
                      {meta?.desc ?? plan.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div>
                    <div className="flex items-baseline gap-1">
                      {price === 0 ? (
                        <span className="text-4xl font-bold">Gratis</span>
                      ) : (
                        <>
                          <span className="text-2xl font-semibold text-muted-foreground">$</span>
                          <span className="text-4xl font-bold">{price}</span>
                          <span className="text-muted-foreground text-sm">usd / {plan.period_text || 'mes'}</span>
                        </>
                      )}
                    </div>
                    {price === 0 && (
                      <p className="text-xs text-muted-foreground mt-1">30 días · Sin tarjeta de crédito</p>
                    )}
                  </div>

                  {/* CTA */}
                  <Button
                    variant={plan.highlight ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => handleSelectPlan(plan.id)}
                    disabled={isCurrentPlan || isLoading}
                    data-testid={`btn-select-plan-${plan.id}`}
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Activando...
                      </span>
                    ) : isCurrentPlan ? (
                      <span className="flex items-center gap-2">
                        <Check className="w-4 h-4" /> Plan actual
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        {ctaText}
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    )}
                  </Button>

                  {/* Features */}
                  <ul className="space-y-2.5">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <Check className={cn('w-4 h-4 mt-0.5 flex-shrink-0', plan.highlight ? 'text-primary' : 'text-emerald-500')} />
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
        )}
      </section>

      {/* ── Trust / Closing ── */}
      <section className="border-t border-border py-16 px-4 bg-muted/30">
        <div className="max-w-3xl mx-auto text-center space-y-5">
          <h3 className="text-2xl md:text-3xl font-bold leading-snug">
            No estás comprando software.<br />
            Estás incorporando un nuevo miembro a tu equipo.
          </h3>
          <p className="text-muted-foreground leading-relaxed">
            WhatOrden combina un <strong>Menú Digital Inteligente</strong>, un{' '}
            <strong>Agente IA que vende 24/7</strong>, un{' '}
            <strong>Director Comercial con IA</strong> que interpreta conversaciones y detecta
            oportunidades, y un <strong>Centro Inteligente de Pedidos</strong> que supervisa
            cada entrega. Todo en una sola plataforma, sin conocimientos técnicos.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link to={user ? '/admin/dashboard' : '/register'}>
              <Button size="lg" data-testid="btn-cta-bottom">
                {user ? 'Ir a mi panel' : 'Crear mi cuenta gratis'}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
            {!user && (
              <Link to="/login">
                <Button variant="ghost" size="lg" data-testid="btn-login-bottom">
                  Ya tengo cuenta
                </Button>
              </Link>
            )}
          </div>
          <p className="text-xs text-muted-foreground pt-2">
            Puedes cambiar de plan en cualquier momento desde tu configuración.
          </p>
        </div>
      </section>
    </div>
  );
}
