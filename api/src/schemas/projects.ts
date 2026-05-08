import { z } from 'zod';

export const projectNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_\- .]+$/, 'Invalid project name');

export const createProjectSchema = z.object({
  name: projectNameSchema,
  description: z.string().max(10000).optional().default(''),
  rules: z.string().max(10000).optional().default(''),
});

export const updateProjectSchema = z.object({
  name: projectNameSchema.optional(),
  description: z.string().max(10000).optional(),
  rules: z.string().max(10000).optional(),
});
