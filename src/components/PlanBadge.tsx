import { Link } from 'react-router-dom';
import { Sparkles, Zap, Crown, ArrowUpRight } from 'lucide-react';
import { useBusiness } from '@/hooks/useBusiness';
import { getEffectivePlan, isTrial, trialDaysLeft } from '@/lib/planUtils';

const PLAN_META = {
  free: {
    label: 'Plan Gratuito',
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

  const effectivePlan = getEffectivePlan(business) as keyof typeof PLAN_META;
  const trial = isTrial(business);
  const daysLeft = trialDaysLeft(business);
  const meta = PLAN_META[effectivePlan] ?? PLAN_META.free;
  const Icon = trial ? Sparkles : meta.icon;

  return (
    <div className="px-3 pb-3 space-y-2">
      <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border ${
        trial
          ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-400 dark:border-violet-800'
          : meta.color
      }`}>
        <Icon className="w-3.5 h-3.5 flex-shrink-0" />
        {!collapsed && (
          <span className="truncate">
            {trial ? `Trial Pro · ${daysLeft ?? 0}d` : meta.label}
          </span>
        )}
      </div>
      {!collapsed && effectivePlan !== 'pro' && !trial && (
        <Link
          to="/pricing"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowUpRight className="w-3 h-3" />
          Mejorar plan
        </Link>
      )}
      {!collapsed && trial && (
        <Link
          to="/pricing"
          className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700 transition-colors"
        >
          <ArrowUpRight className="w-3 h-3" />
          Ver planes
        </Link>
      )}
    </div>
  );
}
