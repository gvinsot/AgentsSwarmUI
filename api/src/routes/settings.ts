import express from 'express';
import { getSettings, updateSettings, getWorkflow, getReminderConfig } from '../services/configManager.js';
import { getGitConnections, saveGitConnections, maskConnections, testConnection } from '../services/gitProvider.js';

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

  // ── Reminder configuration ──────────────────────────────────────
  router.get('/reminders', async (req, res) => {
    try {
      const config = await getReminderConfig();
      res.json({
        intervalMinutes: config.intervalMinutes,
        maxReminders: config.maxReminders,
        cooldownMinutes: config.cooldownMinutes,
        envOverride: !!process.env.TASK_REMINDER_INTERVAL_MINUTES,
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/reminders', async (req, res) => {
    try {
      const patch: Record<string, string> = {};
      const { intervalMinutes, maxReminders, cooldownMinutes } = req.body || {};
      if (intervalMinutes !== undefined) patch.taskReminderIntervalMinutes = String(Math.max(1, parseInt(intervalMinutes, 10) || 10));
      if (maxReminders !== undefined) patch.taskReminderMaxCount = String(Math.max(1, parseInt(maxReminders, 10) || 12));
      if (cooldownMinutes !== undefined) patch.taskReminderCooldownMinutes = String(Math.max(0, parseInt(cooldownMinutes, 10) || 0));
      await updateSettings(patch);
      const config = await getReminderConfig();
      res.json({
        intervalMinutes: config.intervalMinutes,
        maxReminders: config.maxReminders,
        cooldownMinutes: config.cooldownMinutes,
        envOverride: !!process.env.TASK_REMINDER_INTERVAL_MINUTES,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Workflow configuration ────────────────────────────────────────
  // GET /workflow — get default board workflow (read-only)
  router.get('/workflow', async (req, res) => {
    try {
      const workflow = await getWorkflow('_default');
      res.json(workflow);
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── Git Connections ────────────────────────────────────────────────
  router.get('/git-connections', async (req, res) => {
    try {
      const connections = await getGitConnections();
      res.json(maskConnections(connections));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/git-connections', async (req, res) => {
    try {
      const { connections } = req.body || {};
      if (!Array.isArray(connections)) {
        return res.status(400).json({ error: 'connections must be an array' });
      }

      // Preserve existing tokens when the client sends masked values
      const existing = await getGitConnections();
      const existingMap = new Map(existing.map(c => [c.id, c]));

      for (const conn of connections) {
        // If token looks masked (contains ***), use the existing token
        if (conn.token && conn.token.includes('***') && existingMap.has(conn.id)) {
          conn.token = existingMap.get(conn.id).token;
        }
      }

      await saveGitConnections(connections);
      const saved = await getGitConnections();
      res.json(maskConnections(saved));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/git-connections/test', async (req, res) => {
    try {
      const conn = req.body;
      if (!conn || !conn.provider || !conn.token) {
        return res.status(400).json({ error: 'provider and token are required' });
      }

      // If token is masked, look up the real token
      if (conn.token.includes('***') && conn.id) {
        const existing = await getGitConnections();
        const found = existing.find(c => c.id === conn.id);
        if (found) conn.token = found.token;
      }

      const result = await testConnection(conn);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
