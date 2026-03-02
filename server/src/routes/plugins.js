import { Router } from 'express';
import {
  getPlugins,
  createPlugin,
  updatePlugin,
  deletePlugin,
  addMcpToPlugin,
  removeMcpFromPlugin
} from '../data/plugins.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(getPlugins());
});

router.post('/', (req, res) => {
  try {
    const plugin = createPlugin(req.body || {});
    res.status(201).json(plugin);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create plugin' });
  }
});

router.put('/:id', (req, res) => {
  const updated = updatePlugin(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: 'Plugin not found' });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const ok = deletePlugin(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Plugin not found' });
  res.status(204).send();
});

router.post('/:id/mcps/:mcpId', (req, res) => {
  const updated = addMcpToPlugin(req.params.id, req.params.mcpId);
  if (!updated) return res.status(404).json({ error: 'Plugin not found' });
  res.json(updated);
});

router.delete('/:id/mcps/:mcpId', (req, res) => {
  const updated = removeMcpFromPlugin(req.params.id, req.params.mcpId);
  if (!updated) return res.status(404).json({ error: 'Plugin not found' });
  res.json(updated);
});

export default router;