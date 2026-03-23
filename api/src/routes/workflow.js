import express from 'express';
import { getWorkflow, saveWorkflow, deleteWorkflow, listWorkflows, getDefaultWorkflow } from '../services/workflowManager.js';

export function workflowRoutes() {
  const router = express.Router();

  // Get workflow for a project (or default)
  router.get('/', async (req, res) => {
    try {
      const { project } = req.query;
      const workflow = await getWorkflow(project || null);
      res.json(workflow);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get default workflow template
  router.get('/default', (req, res) => {
    res.json(getDefaultWorkflow());
  });

  // List all workflows
  router.get('/list', async (req, res) => {
    try {
      const workflows = await listWorkflows();
      res.json(workflows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save workflow for a project (or default)
  router.put('/', async (req, res) => {
    try {
      const { project, workflow } = req.body;
      if (!workflow || !workflow.columns || !workflow.transitions) {
        return res.status(400).json({ error: 'Invalid workflow: must have columns and transitions' });
      }
      // Validate columns have required fields
      for (const col of workflow.columns) {
        if (!col.id || !col.label) {
          return res.status(400).json({ error: 'Each column must have id and label' });
        }
      }
      // Validate transitions reference valid column ids
      const validIds = new Set(workflow.columns.map(c => c.id));
      validIds.add('error'); // error is always valid
      for (const t of workflow.transitions) {
        if (!validIds.has(t.from) || !validIds.has(t.to)) {
          return res.status(400).json({ error: `Invalid transition: ${t.from} -> ${t.to}` });
        }
      }
      const saved = await saveWorkflow(project || null, workflow);
      res.json(saved);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete project-specific workflow (falls back to default)
  router.delete('/', async (req, res) => {
    try {
      const { project } = req.query;
      if (!project) {
        return res.status(400).json({ error: 'Cannot delete default workflow' });
      }
      await deleteWorkflow(project);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
