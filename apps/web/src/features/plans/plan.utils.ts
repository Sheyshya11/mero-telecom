import type { InternetPlan, PlanLifecycle } from './plan.types';

export function parsePlanHighlights(value: string): string[] {
  return [
    ...new Set(
      value
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

export function formatPlanMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

export function planLifecycle(
  plan: Pick<InternetPlan, 'isActive' | 'isPublic' | 'isAvailable'>,
): PlanLifecycle {
  if (!plan.isActive) return 'RETIRED';
  if (plan.isPublic && plan.isAvailable) return 'PUBLISHED';
  if (plan.isPublic) return 'PAUSED';
  return 'DRAFT';
}
