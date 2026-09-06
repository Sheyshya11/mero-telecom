'use client';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../../lib/api/client';

// Reuse the plan catalogue; customer/subscription records are never fetched for filter options.
export function usePlanOptions(accessToken: string | null | undefined, enabled: boolean) {
  const plans = useQuery({
    queryKey: ['plans', 'filter-options'],
    queryFn: () => apiRequest<Array<{ id: string; name: string }>>('/plans', {}, accessToken),
    enabled: Boolean(accessToken && enabled),
    staleTime: 60_000,
  });
  return (plans.data ?? []).map((plan) => ({ value: plan.id, label: plan.name }));
}
