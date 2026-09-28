import { z } from 'zod';

import { parsePlanHighlights } from './plan.utils';

export const planSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a plan name.').max(150),
    description: z.string().trim().max(2000).optional(),
    highlightsText: z
      .string()
      .refine(
        (value) => parsePlanHighlights(value).length <= 5,
        'Add no more than five highlights.',
      )
      .refine(
        (value) => parsePlanHighlights(value).every((item) => item.length <= 100),
        'Each highlight must be 100 characters or fewer.',
      ),
    downloadMbps: z.coerce.number().int().min(1, 'Must be at least 1 Mbps.').max(100_000),
    uploadMbps: z.coerce.number().int().min(1, 'Must be at least 1 Mbps.').max(100_000),
    monthlyPrice: z.coerce
      .number()
      .positive('Enter a price greater than zero.')
      .max(1_000_000)
      .multipleOf(0.01, 'Use no more than two decimal places.'),
    stripePriceId: z
      .string()
      .trim()
      .refine(
        (value) => value === '' || /^price_[A-Za-z0-9]+$/.test(value),
        'Enter a valid Stripe Price ID.',
      ),
    tierRank: z.coerce.number().int().min(0, 'Tier rank cannot be negative.').max(1_000_000),
    isPublic: z.boolean(),
    isAvailable: z.boolean(),
    isFeatured: z.boolean(),
  })
  .refine((value) => !value.isAvailable || value.isPublic, {
    message: 'An orderable plan must also be publicly visible.',
    path: ['isAvailable'],
  })
  .refine((value) => !value.isFeatured || (value.isPublic && value.isAvailable), {
    message: 'Only a published and orderable plan can be featured.',
    path: ['isFeatured'],
  });

export type PlanFormInput = z.input<typeof planSchema>;
export type PlanFormValues = z.output<typeof planSchema>;
