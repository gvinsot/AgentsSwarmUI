// ─── Express Routes for Agents ───────────────────────────────────────────────
import express from 'express';
import { requireAuth, requireAgentAccess } from '../middleware/auth.js';
import { agentManager } from '../services/agentManager/index.js';
import { globalTaskStore } from '../services/globalTaskStore.js';

const router = express.Router();

// ─── Agent CRUD ─────────────────────────────────────────────────────────────
const agentListHandler = (req, res) => {
  const agents = agentManager.getAll();
  res.json(agents);
};

const agentCreateHandler = async (req, res) => {
  const agent = await agentManager.create(req.body);
  res.status(201).json(agent);
};

const agentGetHandler = (req, res) => {
  const agent = agentManager.getById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json(agent);
};

const agentUpdateHandler = (req, res) => {
  const agent = agentManager.update(req.params.id, req.body);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  res.json(agent);
};

const agentDeleteHandler = (req, res) => {
  const ok = agentManager.delete(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.status(204).send();
};

const agentStopHandler = (req, res) => {
  const ok = agentManager.stop(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── Agent Status ───────────────────────────────────────────────────────────
const agentStatusHandler = (req, res) => {
  const status = agentManager.getAgentStatus(req.params.id);
  if (!status) return res.status(404).json({ error: 'Not found' });
  res.json(status);
};

const agentStatusesHandler = (req, res) => {
  const { project } = req.query;
  const statuses = agentManager.getAgentStatuses(project || null);
  res.json(statuses);
};

const swarmStatusHandler = (req, res) => {
  const { userId, role } = req.query;
  const status = agentManager.getSwarmStatus(userId || null, role || null);
  res.json(status);
};

// ─── Agent Chat ─────────────────────────────────────────────────────────────
const agentChatHandler = async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const result = await agentManager.chat(req.params.id, message);
  res.json(result);
};

const agentHistoryHandler = (req, res) => {
  const history = agentManager.getHistory(req.params.id);
  if (!history) return res.status(404).json({ error: 'Not found' });
  res.json(history);
};

const agentClearHistoryHandler = (req, res) => {
  const ok = agentManager.clearHistory(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

const agentTruncateHistoryHandler = (req, res) => {
  const { afterIndex } = req.params;
  const ok = agentManager.truncateHistory(req.params.id, afterIndex);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── Agent Broadcast & Handoff ──────────────────────────────────────────────
const broadcastHandler = async (req, res) => {
  const { message, project } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });
  const count = agentManager.broadcast(message, project || null);
  res.json({ success: true, count });
};

const handoffHandler = async (req, res) => {
  const { targetAgentId, context } = req.body;
  if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId required' });
  const task = agentManager.handoff(req.params.id, targetAgentId, context || '');
  if (!task) return res.status(404).json({ error: 'Agent not found' });
  res.json({ success: true, task });
};

// ─── Action Logs ────────────────────────────────────────────────────────────
const clearActionLogsHandler = (req, res) => {
  const ok = agentManager.clearActionLogs(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── RAG Documents ──────────────────────────────────────────────────────────
const ragAddHandler = async (req, res) => {
  const { name, content } = req.body;
  if (!name || !content) return res.status(400).json({ error: 'name and content required' });
  const doc = await agentManager.addRagDoc(req.params.id, name, content);
  res.status(201).json(doc);
};

const ragDeleteHandler = (req, res) => {
  const { docId } = req.params;
  const ok = agentManager.deleteRagDoc(req.params.id, docId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── Plugin Assignment ──────────────────────────────────────────────────────
const pluginAssignHandler = async (req, res) => {
  const { pluginId } = req.body;
  if (!pluginId) return res.status(400).json({ error: 'pluginId required' });
  const skills = await agentManager.assignPlugin(req.params.id, pluginId);
  if (skills === null) return res.status(404).json({ error: 'Agent not found' });
  res.json({ success: true, skills });
};

const pluginRemoveHandler = (req, res) => {
  const { pluginId } = req.params;
  const ok = agentManager.removePlugin(req.params.id, pluginId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── Tasks ──────────────────────────────────────────────────────────────────
const taskAddHandler = async (req, res) => {
  const { text, project, status, boardId, recurrence, taskType } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const task = await agentManager.addTask(req.params.id, text, project, status, boardId, recurrence, taskType);
  res.status(201).json(task);
};

const taskToggleHandler = (req, res) => {
  const { taskId } = req.params;
  const task = agentManager.toggleTask(req.params.id, taskId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskDeleteHandler = (req, res) => {
  const { taskId } = req.params;
  const ok = agentManager.deleteTask(req.params.id, taskId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

const taskClearHandler = (req, res) => {
  const ok = agentManager.clearTasks(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

const taskTransferHandler = async (req, res) => {
  const { taskId } = req.params;
  const { targetAgentId } = req.body;
  if (!targetAgentId) return res.status(400).json({ error: 'targetAgentId required' });
  const task = await agentManager.transferTask(req.params.id, taskId, targetAgentId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskSetAssigneeHandler = (req, res) => {
  const { taskId } = req.params;
  const { assigneeId } = req.body;
  if (!assigneeId) return res.status(400).json({ error: 'assigneeId required' });
  const task = agentManager.setTaskAssignee(req.params.id, taskId, assigneeId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskRefineHandler = async (req, res) => {
  const { taskId } = req.params;
  const { refineAgentId } = req.body;
  if (!refineAgentId) return res.status(400).json({ error: 'refineAgentId required' });
  const task = await agentManager.refineTask(req.params.id, taskId, refineAgentId);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskSetStatusHandler = (req, res) => {
  const { taskId } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status required' });
  const task = agentManager.setTaskStatus(req.params.id, taskId, status);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskUpdateTextHandler = (req, res) => {
  const { taskId } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const task = agentManager.updateTaskText(req.params.id, taskId, text);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskUpdateHandler = (req, res) => {
  const { taskId } = req.params;
  const task = agentManager.updateTask(req.params.id, taskId, req.body);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskUpdateProjectHandler = (req, res) => {
  const { taskId } = req.params;
  const { project } = req.body;
  const task = agentManager.updateTaskProject(req.params.id, taskId, project);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
};

const taskAddCommitHandler = async (req, res) => {
  const { taskId } = req.params;
  const { hash, message } = req.body;
  if (!hash) return res.status(400).json({ error: 'hash required' });
  const ok = await agentManager.addTaskCommit(req.params.id, taskId, hash, message);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

const taskRemoveCommitHandler = (req, res) => {
  const { taskId, hash } = req.params;
  const ok = agentManager.removeTaskCommit(req.params.id, taskId, hash);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
};

// ─── Project Stats ──────────────────────────────────────────────────────────
router.get("/tasks/stats", (req, res) => {
  const { project } = req.query;
  const stats = agentManager.getTaskStats(project || null);
  res.json(stats);
});

router.get("/tasks/stats/timeseries", (req, res) => {
  const { project, days } = req.query;
  const d = Math.min(Math.max(parseInt(days) || 30, 1), 365);
  const timeseries = agentManager.getTaskTimeSeries(project || null, d);
  res.json(timeseries);
});

router.get("/tasks/stats/time-spent", (req, res) => {
  const { project, days } = req.query;
  const d = Math.min(Math.max(parseInt(days) || 30, 1), 365);
  const timeSpent = agentManager.getProjectTimeSpent(project || null, d);
  res.json(timeSpent);
});

router.get("/tasks/:id/history", (req, res) => {
  const history = globalTaskStore.getHistory(req.params.id);
  if (!history) return res.status(404).json({ error: "Not found" });
  res.json(history);
});

// ─── MCP server assignment endpoints (backward compat) ───────────
router.post('/:id/mcp-servers', requireAgentAccess, (req, res) => {
  const { serverId } = req.body;
  if (!serverId) return res.status(400).json({ error: 'serverId required' });
  const result = agentManager.assignMcpServer(req.params.id, serverId);
  if (result === null) return res.status(404).json({ error: 'Agent not found' });
  res.json({ success: true, mcpServers: result });
});

router.delete('/:id/mcp-servers/:serverId', requireAgentAccess, (req, res) => {
  const success = agentManager.removeMcpServer(req.params.id, req.params.serverId);
  if (!success) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ─── Voice Chat ─────────────────────────────────────────────────────────────
router.post('/:id/voice', requireAgentAccess, async (req, res) => {
  const { audio, transcript } = req.body;
  if (!audio && !transcript) return res.status(400).json({ error: 'audio or transcript required' });
  const result = await agentManager.voiceChat(req.params.id, audio, transcript);
  res.json(result);
});

// ─── Route Registration ─────────────────────────────────────────────────────
router.get('/', requireAuth, agentListHandler);
router.post('/', requireAuth, agentCreateHandler);
router.get('/:id', requireAuth, agentGetHandler);
router.put('/:id', requireAuth, requireAgentAccess, agentUpdateHandler);
router.delete('/:id', requireAuth, requireAgentAccess, agentDeleteHandler);
router.post('/:id/stop', requireAuth, requireAgentAccess, agentStopHandler);
router.get('/:id/status', requireAuth, agentStatusHandler);
router.post('/:id/chat', requireAuth, requireAgentAccess, agentChatHandler);
router.get('/:id/history', requireAuth, requireAgentAccess, agentHistoryHandler);
router.delete('/:id/history', requireAuth, requireAgentAccess, agentClearHistoryHandler);
router.delete('/:id/history/after/:afterIndex', requireAuth, requireAgentAccess, agentTruncateHistoryHandler);
router.post('/:id/handoff', requireAuth, requireAgentAccess, handoffHandler);
router.delete('/:id/action-logs', requireAuth, requireAgentAccess, clearActionLogsHandler);
router.post('/:id/rag', requireAuth, requireAgentAccess, ragAddHandler);
router.delete('/:id/rag/:docId', requireAuth, requireAgentAccess, ragDeleteHandler);
router.post('/:id/tasks', requireAuth, requireAgentAccess, taskAddHandler);
router.patch('/:id/tasks/:taskId', requireAuth, requireAgentAccess, taskToggleHandler);
router.delete('/:id/tasks/:taskId', requireAuth, requireAgentAccess, taskDeleteHandler);
router.delete('/:id/tasks', requireAuth, requireAgentAccess, taskClearHandler);
router.post('/:id/tasks/:taskId/transfer', requireAuth, requireAgentAccess, taskTransferHandler);
router.patch('/:id/tasks/:taskId/assignee', requireAuth, requireAgentAccess, taskSetAssigneeHandler);
router.post('/:id/tasks/:taskId/refine', requireAuth, requireAgentAccess, taskRefineHandler);
router.patch('/:id/tasks/:taskId/status', requireAuth, requireAgentAccess, taskSetStatusHandler);
router.patch('/:id/tasks/:taskId/text', requireAuth, requireAgentAccess, taskUpdateTextHandler);
router.patch('/:id/tasks/:taskId', requireAuth, requireAgentAccess, taskUpdateHandler);
router.patch('/:id/tasks/:taskId/project', requireAuth, requireAgentAccess, taskUpdateProjectHandler);
router.post('/:id/tasks/:taskId/commits', requireAuth, requireAgentAccess, taskAddCommitHandler);
router.delete('/:id/tasks/:taskId/commits/:hash', requireAuth, requireAgentAccess, taskRemoveCommitHandler);
router.post('/:id/plugins', requireAgentAccess, pluginAssignHandler);
router.delete('/:id/plugins/:pluginId', requireAgentAccess, pluginRemoveHandler);
// Backward compatibility
router.post('/:id/skills', requireAgentAccess, pluginAssignHandler);
router.delete('/:id/skills/:skillId', requireAgentAccess, pluginRemoveHandler);

export default router;