import express from 'express';
import { getSettings, updateSettings, getWorkflow, getAllWorkflows, updateWorkflow } from '../services/configManager.js';

export function settingsRoutes() {
  const router = express.Router();

  // ── General settings ──────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const settings = await getSettings();
      res.json(settings);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/', async (req, res) => {
    try {
      const settings = await updateSettings(req.body || {});
      res.json(settings);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Workflow configuration ────────────────────────────────────────
  // GET /workflow — get default workflow (project = '_default')
  router.get('/workflow', async (req, res) => {
    try {
      const workflow = await getWorkflow('_default');
      res.json(workflow);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /workflow — update default workflow
  router.put('/workflow', async (req, res) => {
    try {
      const workflow = await updateWorkflow('_default', req.body || {});
      res.json(workflow);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /workflow/:project — get workflow for a specific project
  router.get('/workflow/:project', async (req, res) => {
    try {
      const workflow = await getWorkflow(req.params.project);
      res.json(workflow);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /workflow/:project — update workflow for a specific project
  router.put('/workflow/:project', async (req, res) => {
    try {
      const workflow = await updateWorkflow(req.params.project, req.body || {});
      res.json(workflow);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /workflows — list all project workflows
  router.get('/workflows', async (req, res) => {
    try {
      const workflows = await getAllWorkflows();
      res.json(workflows);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
