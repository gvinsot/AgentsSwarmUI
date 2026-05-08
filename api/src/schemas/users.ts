import { z } from 'zod';

export const createUserSchema = z.object({
  username: z.string().min(2).max(100),
  password: z.string().min(4).max(200),
  role: z.enum(['admin', 'advanced', 'basic']).default('advanced'),
  displayName: z.string().max(200).optional(),
});

export const updateUserSchema = z.object({
  username: z.string().min(2).max(100).optional(),
  password: z.string().min(4).max(200).optional(),
  role: z.enum(['admin', 'advanced', 'basic']).optional(),
  displayName: z.string().max(200).optional(),
});

export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});
