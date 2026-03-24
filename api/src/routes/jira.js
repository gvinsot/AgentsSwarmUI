import express from 'express';
import { getJiraSyncStatus, fullSync } from '../services/jiraSync.js';

export function jiraRoutes(agentManager) {
  const router = express.Router();

  // GET /jira/status — sync status for UI
  router.get('/status', (req, res) => {
    res.json(getJiraSyncStatus());
  });

  // POST /jira/sync — trigger manual sync
  router.post('/sync', async (req, res) => {
    try {
      await fullSync(agentManager);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
