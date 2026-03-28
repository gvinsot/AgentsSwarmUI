import express from 'express';
import { z } from 'zod';

const mcpConfigSchema = z.object({
  id: z.string().max(200).optional(),
  name: z.string().min(1).max(200),
  url: z.string().max(2000),
  description: z.string().max(2000).optional(),
  icon: z.string().max(50).optional(),
  enabled: z.boolean().optional(),
  authMode: z.enum(['none', 'bearer']).optional(),
  apiKey: z.string().max(500).optional(),
  hasApiKey: z.boolean().optional(),
  userConfig: z.record(z.any()).optional(),
}).catchall(z.any());

const pluginSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: z.string().max(100).optional(),
  icon: z.string().max(50).optional(),
  instructions: z.string().min(1).max(50000),
  userConfig: z.record(z.any()).optional(),
  mcps: z.array(mcpConfigSchema).optional(),
}).catchall(z.any());

const createPluginSchema = pluginSchema;
const updatePluginSchema = pluginSchema.partial();

function sanitizeMcp(mcp) {
  if (!mcp) return mcp;
  return {
    ...mcp,
    authMode: mcp.authMode || (mcp.apiKey ? 'bearer' : 'none'),
    hasApiKey: !!mcp.apiKey,
    apiKey: mcp.apiKey ? '••••••••' : '',
  };
}

function sanitizePlugin(plugin) {
  return {
    ...plugin,
    userConfig: plugin.userConfig || {},
    mcps: Array.isArray(plugin.mcps) ? plugin.mcps.map(sanitizeMcp) : [],
    mcpServerIds: Array.isArray(plugin.mcpServerIds) ? plugin.mcpServerIds : [],
  };
}

export function pluginRoutes(skillManager, mcpManager) {
  const router = express.Router();

  /** Only admins can create, edit, or delete plugins */
  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }

  router.get('/', (req, res) => {
    const plugins = skillManager.getAll().map(sanitizePlugin);
    res.json(plugins);
  });

  router.get('/:id', (req, res) => {
    const plugin = skillManager.getById(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json(sanitizePlugin(plugin));
  });

  router.post('/', requireAdmin, async (req, res) => {
    try {
      const parsed = createPluginSchema.parse(req.body);
      const plugin = await skillManager.create(parsed);
      res.status(201).json(sanitizePlugin(plugin));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: err.issues });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', requireAdmin, async (req, res) => {
    try {
      const parsed = updatePluginSchema.parse(req.body);

      // Preserve existing API keys when the frontend sends the masked placeholder
      if (Array.isArray(parsed.mcps)) {
        const current = skillManager.getById(req.params.id);
        const currentMcps = current && Array.isArray(current.mcps) ? current.mcps : [];
        for (const mcp of parsed.mcps) {
          if (mcp.apiKey === '••••••••' && mcp.id) {
            const existing = currentMcps.find(m => m.id === mcp.id);
            mcp.apiKey = existing ? existing.apiKey : '';
          }
        }
      }

      const plugin = await skillManager.update(req.params.id, parsed);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });

      // Sync MCP apiKeys to the MCP server registry (global key)
      if (Array.isArray(parsed.mcps)) {
        for (const mcp of parsed.mcps) {
          if (mcp.id && mcpManager.getById(mcp.id)) {
            const newKey = mcp.apiKey || '';
            const current = mcpManager.getById(mcp.id);
            if (current.apiKey !== newKey) {
              await mcpManager.update(mcp.id, { apiKey: newKey });
            }
          }
        }
      }

      res.json(sanitizePlugin(plugin));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: 'Validation failed', details: err.issues });
      }
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const success = await skillManager.delete(req.params.id);
      if (!success) return res.status(404).json({ error: 'Plugin not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/:id/mcps/:mcpId', requireAdmin, async (req, res) => {
    try {
      const plugin = skillManager.getById(req.params.id);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      const server = mcpManager.getById(req.params.mcpId);
      if (!server) return res.status(404).json({ error: 'MCP server not found' });

      const mcps = Array.isArray(plugin.mcps) ? [...plugin.mcps] : [];
      if (!mcps.some((m) => m.id === server.id)) {
        mcps.push({
          id: server.id,
          name: server.name,
          url: server.url,
          description: server.description || '',
          icon: server.icon || '🔌',
          enabled: server.enabled !== false,
          apiKey: server.apiKey || '',
          userConfig: {},
        });
      }

      const updated = await skillManager.update(req.params.id, { mcps });
      res.json(sanitizePlugin(updated));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id/mcps/:mcpId', requireAdmin, async (req, res) => {
    try {
      const plugin = skillManager.getById(req.params.id);
      if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
      const mcps = (Array.isArray(plugin.mcps) ? plugin.mcps : []).filter((m) => m.id !== req.params.mcpId);
      const updated = await skillManager.update(req.params.id, { mcps });
      res.json(sanitizePlugin(updated));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}