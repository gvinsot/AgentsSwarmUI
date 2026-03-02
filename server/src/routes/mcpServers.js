import express from 'express';

/** Mask apiKey so the full value isn't exposed to the client. */
function sanitize(server) {
  if (!server) return server;
  const copy = { ...server };
  copy.hasApiKey = !!copy.apiKey;
  copy.apiKey = copy.apiKey ? '••••••••' : '';
  return copy;
}

export function mcpServerRoutes(mcpManager) {
  const router = express.Router();

  // List all MCP servers (with tools & status)
  router.get('/', (req, res) => {
    res.json(mcpManager.getAll().map(sanitize));
  });

  // Get single MCP server
  router.get('/:id', (req, res) => {
    const server = mcpManager.getById(req.params.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    res.json(sanitize(server));
  });

  // Create MCP server
  router.post('/', async (req, res) => {
    try {
      const { name, url, description, icon, enabled, apiKey } = req.body;
      if (!name || !url) {
        return res.status(400).json({ error: 'Name and URL required' });
      }
      const server = await mcpManager.create({ name, url, description, icon, enabled, apiKey });
      res.status(201).json(sanitize(server));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update MCP server
  router.put('/:id', async (req, res) => {
    try {
      const server = await mcpManager.update(req.params.id, req.body);
      if (!server) return res.status(404).json({ error: 'MCP server not found' });
      res.json(sanitize(server));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete MCP server
  router.delete('/:id', async (req, res) => {
    try {
      const success = await mcpManager.delete(req.params.id);
      if (!success) return res.status(404).json({ error: 'MCP server not found' });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Force reconnect & refresh tools
  router.post('/:id/connect', async (req, res) => {
    try {
      const server = await mcpManager.connect(req.params.id);
      res.json(sanitize(server));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
