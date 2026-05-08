import { z } from 'zod';

const optionalString = (max: number) => z.string().max(max).optional().nullable();

export const reorderTasksSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(2000),
});

// PUT /tasks/:id — task updates are partial; only fields present are applied.
// Permissive shape (passthrough) because the legacy handler reads many optional
// fields, but every known field is bounded.
export const updateTaskSchema = z.object({
  title: optionalString(2000),
  description: optionalString(20000),
  text: optionalString(20000),
  column: optionalString(100),
  status: optionalString(100),
  boardId: z.string().uuid().nullable().optional(),
  agentId: z.string().uuid().nullable().optional(),
  assignee: optionalString(200),
  type: optionalString(50),
  taskType: optionalString(50),
  priority: optionalString(50),
  dueDate: optionalString(50),
  position: z.number().int().optional(),
  isManual: z.boolean().optional(),
  signal: optionalString(100),
  metadata: z.record(z.string(), z.any()).optional(),
}).passthrough();

export const bulkMoveSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(2000),
  boardId: z.string().uuid(),
  column: z.string().min(1).max(100).optional(),
}).passthrough();

export const idParamsSchema = z.object({
  id: z.string().uuid(),
});

export const purgeTasksSchema = z.object({
  olderThanDays: z.number().int().min(1).max(3650).optional(),
  status: z.string().min(1).max(100).optional(),
  boardId: z.string().uuid().optional(),
}).passthrough();
