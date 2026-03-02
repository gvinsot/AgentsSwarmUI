import express from 'express';

export function pluginRoutes(pluginManager, mcpManager) {
  const router = express.Router();

  // Unified settings endpoint for global control panel
  router.get('/settings', (req, res) => {
    const plugins = pluginManager.getAll().map((p) => ({
      ...p,
      mcpModules: Array.isArray(p.mcpModules) ? p.mcpModules : []
    }));

    const mcpModules = mcpManager.getAll();

    res.json({
      definitions: plugins,
      settings: {
        plugins,
        mcpModules,
        revision: Date.now()
      }
    });
  });

  router.put('/settings', async (req, res) => {
    try {
      const { plugins = [] } = req.body || {};
      const updated = [];

      for (const plugin of plugins) {
        const existing = pluginManager.getById(plugin.id);
        if (!existing) continue;
        const next = await pluginManager.update(plugin.id, {
          ...plugin,
          mcpModules: Array.isArray(plugin.mcpModules) ? plugin.mcpModules : []
        });
        if (next) updated.push(next);
      }

      res.json({ success: true, plugins: updated });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to save plugin settings' });
    }
  });

  // Marketplace/list
  router.get('/', (req, res) => {
    const plugins = pluginManager.getAll().map((p) => ({
      ...p,
      mcpModules: Array.isArray(p.mcpModules) ? p.mcpModules : []
    }));
    res.json(plugins);
  });

  router.get('/:id', (req, res) => {
    const plugin = pluginManager.getById(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json({
      ...plugin,
      mcpModules: Array.isArray(plugin.mcpModules) ? plugin.mcpModules : []
    });
  });

  router.post('/', async (req, res) => {
    try {
      const { name, description, category, icon, instructions, mcpModules = [] } = req.body;
      if (!name || !instructions) {
        return res.status(400).json({ error: 'name and instructions are required' });
      }
      const plugin = await pluginManager.create({
        name,
        description,
        category,
        icon,
        instructions,
        mcpModules: Array.isArray(mcpModules) ? mcpModules : []
      });
      res.status(201).json(plugin);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to create plugin' });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const plugin = await pluginManager.update(req.params.id, {
        ...req.body,
        mcpModules: Array.isArray(req.body?.mcpModules) ? req.body.mcpModules : req.body?.mcpModules
      });
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      res.json(plugin);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to update plugin' });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const success = await pluginManager.delete(req.params.id);
      if (!success) return res.status(404).json({ error: 'Plugin not found' });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to delete plugin' });
    }
  });

  return router;
}