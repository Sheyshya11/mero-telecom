import { z } from 'zod';

export const australianStates = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(100),
  lastName: z.string().trim().min(1, 'Last name is required.').max(100),
  email: z.string().trim().pipe(z.email('Enter a valid email address.').max(320)),
  phone: z.string().regex(/^(?:\+61|0)4\d{8}$/, 'Enter an Australian mobile number.'),
  addressLine1: z.string().trim().min(1, 'Address is required.').max(255),
  addressLine2: z.string().trim().max(255).optional(),
  suburb: z.string().trim().min(1, 'Suburb is required.').max(100),
  state: z.enum(australianStates, 'Select an Australian state or territory.'),
  postcode: z.string().regex(/^\d{4}$/, 'Enter a four-digit postcode.'),
  status: z.enum(['INVITATION_PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
});

export type CustomerFormValues = z.infer<typeof customerSchema>;
