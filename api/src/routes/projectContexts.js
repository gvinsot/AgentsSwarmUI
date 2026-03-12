import express from 'express';
import { z } from 'zod';
import { getAllProjectContexts, saveProjectContext, deleteProjectContextFromDb } from '../services/database.js';

// Only allow safe project names — no path traversal, no SQL special chars
const projectNameSchema = z.string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_\- .]+$/, 'Invalid project name');

const contextBodySchema = z.object({
  description: z.string().max(10000).optional().default(''),
  rules: z.string().max(10000).optional().default(''),
});

export function projectContextRoutes() {
  const router = express.Router();

  // List all project contexts
  router.get('/', async (req, res) => {
    try {
      const contexts = await getAllProjectContexts();
      res.json(contexts);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get single project context by name
  router.get('/:name', async (req, res) => {
    try {
      const name = projectNameSchema.parse(req.params.name);
      const contexts = await getAllProjectContexts();
      const ctx = contexts.find(c => c.name === name);
      if (!ctx) return res.json({ name, description: '', rules: '' });
      res.json(ctx);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid project name' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Create or update a project context
  router.put('/:name', async (req, res) => {
    try {
      const name = projectNameSchema.parse(req.params.name);
      const { description, rules } = contextBodySchema.parse(req.body || {});
      const ctx = { name, description, rules, updatedAt: new Date().toISOString() };
      await saveProjectContext(ctx);
      res.json(ctx);
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: 'Validation failed', details: err.issues });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete a project context
  router.delete('/:name', async (req, res) => {
    try {
      const name = projectNameSchema.parse(req.params.name);
      await deleteProjectContextFromDb(name);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid project name' });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
