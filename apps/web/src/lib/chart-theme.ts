export const chartColors = {
  primary: 'hsl(var(--chart-1))',
  success: 'hsl(var(--chart-2))',
  warning: 'hsl(var(--chart-3))',
  destructive: 'hsl(var(--chart-4))',
  info: 'hsl(var(--chart-5))',
  neutral: 'hsl(var(--chart-6))',
  grid: 'hsl(var(--chart-grid))',
  tick: 'hsl(var(--muted-foreground))',
} as const;

export const subscriptionStatusColors = {
  ACTIVE: chartColors.success,
  PAST_DUE: chartColors.destructive,
  CANCELLATION_PENDING: chartColors.warning,
  DISCONNECTION_PENDING: chartColors.destructive,
  PENDING: chartColors.primary,
  SUSPENDED: chartColors.warning,
  CANCELLED: chartColors.destructive,
  TERMINATED: chartColors.destructive,
} as const;

export const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  boxShadow: '0 12px 28px hsl(var(--shadow-color) / 0.1)',
  color: 'hsl(var(--foreground))',
  fontSize: 12,
} as const;

export const chartCursorStyle = { fill: 'hsl(var(--primary) / 0.06)' } as const;
