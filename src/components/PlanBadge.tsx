import { Link } from 'react-router-dom';
import { Sparkles, Zap, Crown, ArrowUpRight } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';

const PLAN_META = {
  free: {
    label: 'Prueba gratuita',
    icon: Sparkles,
    color: 'bg-muted text-muted-foreground border-border',
  },
  starter: {
    label: 'Starter',
    icon: Zap,
    color: 'bg-primary/10 text-primary border-primary/20',
  },
  pro: {
    label: 'Pro',
    icon: Crown,
    color: 'bg-amber-50 text-amber-700 border-amber-200',
  },
};

export function PlanBadge({ collapsed = false }: { collapsed?: boolean }) {
  const { business } = useBusiness();
  if (!business) return null;

  const plan = (business.plan ?? 'free') as keyof typeof PLAN_META;
  const meta = PLAN_META[plan] ?? PLAN_META.free;
  const Icon = meta.icon;

  // Compute days left for free plan
  let daysLeft: number | null = null;
  if (plan === 'free' && business.plan_expires_at) {
    const diff = new Date(business.plan_expires_at).getTime() - Date.now();
    daysLeft = Math.max(0, Math.ceil(diff / 86400000));
  }

  return (
    <div className="px-3 pb-3 space-y-2">
      <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${meta.color}`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {!collapsed && (
          <span className="truncate">
            {meta.label}
            {daysLeft !== null && ` · ${daysLeft}d`}
          </span>
        )}
      </div>
      {!collapsed && plan !== 'pro' && (
        <Link
          to="/pricing"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowUpRight className="w-3 h-3" />
          Mejorar plan
        </Link>
      )}
    </div>
  );
}
