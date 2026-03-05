import express from 'express';
import { z } from 'zod';

// Schema for creating a plugin
const createPluginSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  icon: z.string().max(50).optional(),
  instructions: z.string().min(1).max(50000),
  mcpServerIds: z.array(z.string().max(200)).optional(),
});

// Schema for updating a plugin (all fields optional)
const updatePluginSchema = createPluginSchema.partial();

export function pluginRoutes(skillManager, mcpManager) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const plugins = skillManager.getAll().map((s) => ({
      ...s,
      mcpServerIds: Array.isArray(s.mcpServerIds) ? s.mcpServerIds : []
    }));
    res.json(plugins);
  });

  router.get('/:id', (req, res) => {
    const plugin = skillManager.getById(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json({
      ...plugin,
      mcpServerIds: Array.isArray(plugin.mcpServerIds) ? plugin.mcpServerIds : []
    });
  });

  router.post('/', async (req, res) => {
    try {
      const parsed = createPluginSchema.parse(req.body);
      const plugin = await skillManager.create({
        ...parsed,
        mcpServerIds: Array.isArray(parsed.mcpServerIds) ? parsed.mcpServerIds : []
      });
      res.status(201).json(plugin);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: err.issues });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const parsed = updatePluginSchema.parse(req.body);
      const plugin = await skillManager.update(req.params.id, parsed);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      res.json(plugin);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: err.issues });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const success = await skillManager.delete(req.params.id);
      if (!success) return res.status(404).json({ error: 'Plugin not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/mcps/:mcpId', async (req, res) => {
    try {
      const plugin = skillManager.getById(req.params.id);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      const ids = new Set(Array.isArray(plugin.mcpServerIds) ? plugin.mcpServerIds : []);
      ids.add(req.params.mcpId);
      const updated = await skillManager.update(req.params.id, { mcpServerIds: [...ids] });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id/mcps/:mcpId', async (req, res) => {
    try {
      const plugin = skillManager.getById(req.params.id);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      const ids = (Array.isArray(plugin.mcpServerIds) ? plugin.mcpServerIds : []).filter((id) => id !== req.params.mcpId);
      const updated = await skillManager.update(req.params.id, { mcpServerIds: ids });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}