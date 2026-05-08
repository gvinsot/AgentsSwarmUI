import { z } from 'zod';

export const contactSubmitSchema = z.object({
  email: z.string().email().max(320),
  // Phone validation is intentionally permissive — exact format varies per
  // country. We trim, cap the length and then re-check digit count in the
  // handler. Anything beyond 50 chars is almost certainly junk.
  phone: z.string().min(1).max(50),
  name: z.string().max(200).optional().default(''),
  company: z.string().max(200).optional().default(''),
  message: z.string().max(5000).optional().default(''),
  type: z.enum(['contact', 'support']),
});
