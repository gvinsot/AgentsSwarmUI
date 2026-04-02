// ─── Agent Lifecycle: CRUD, Getters, Status, Stats, Broadcast, Handoff, Logs,
//     RAG, Skills, MCP, Voice, Conversation ────────────────────────────────────
import { v4 as uuidv4 } from 'uuid';
import { saveAgent, deleteAgentFromDb, setAgentOwner } from '../database.js';
import { transferUserFiles } from './helpers.js';

/** @this {import('./index.js').AgentManager} */
export const lifecycleMethods = {

  async create(config) {
    const id = uuidv4();
    const agent = {
      id,
      name: config.name || 'Unnamed Agent',
      role: config.role || 'general',
      description: config.description || '',
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint || '',
      apiKey: config.apiKey || (config.copyApiKeyFromAgent && this.agents.get(config.copyApiKeyFromAgent)?.apiKey) || '',
      instructions: config.instructions || 'You are a helpful AI assistant.',
      status: 'idle',
      currentTask: null,
      temperature: config.temperature !== undefined ? config.temperature : 0.7,
      maxTokens: config.maxTokens ?? 128000,
      contextLength: config.contextLength ?? 0,
      todoList: config.todoList || [],
      ragDocuments: config.ragDocuments || [],
      skills: config.skills || [],
      mcpServers: config.mcpServers || [],
      conversationHistory: [],
      actionLogs: [],
      currentThinking: '',
      metrics: {
        totalMessages: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastActiveAt: null,
        errors: 0
      },
      handoffTargets: config.handoffTargets || [],
      project: config.project || null,
      projectChangedAt: config.project ? new Date().toISOString() : null,
      projectContexts: {},
      enabled: config.enabled !== undefined ? config.enabled : true,
      isLeader: config.isLeader || config.isVoice || false,
      isVoice: config.isVoice || false,
      isReasoning: config.isReasoning || false,
      voice: config.voice || 'alloy',
      template: config.template || null,
      costPerInputToken: config.costPerInputToken ?? null,
      costPerOutputToken: config.costPerOutputToken ?? null,
      llmConfigId: config.llmConfigId || null,
      ownerId: config.ownerId || null,
      color: config.color || this._randomColor(),
      icon: config.icon || '🤖',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.agents.set(id, agent);
    await saveAgent(agent);
    if (config.ownerId) {
      await setAgentOwner(id, config.ownerId);
    }
    this._emit('agent:created', this._sanitize(agent));
    return this._sanitize(agent);
  },

  getAll() {
    return Array.from(this.agents.values()).map(a => this._sanitize(a));
  },

  getAllForUser(userId, role) {
    return Array.from(this.agents.values())
      .filter(a => a.ownerId === userId || !a.ownerId)
      .map(a => this._sanitize(a));
  },

  _agentsForUser(userId, role) {
    return Array.from(this.agents.values())
      .filter(a => a.ownerId === userId || !a.ownerId);
  },

  getById(id) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return this._sanitize(agent);
  },

  getLastMessages(agentId, limit = 1) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 1;
    const history = Array.isArray(agent.conversationHistory) ? agent.conversationHistory : [];
    const startIndex = Math.max(0, history.length - safeLimit);

    const messages = history.slice(-safeLimit).map((m, idx) => ({
      ...m,
      index: startIndex + idx
    }));

    return messages;
  },

  getHistory(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return this._sanitize(agent).conversationHistory;
  },

  clearHistory(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.conversationHistory = [];
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  truncateHistory(agentId, afterIndex) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    const parsed = Number(afterIndex);
    const safeIdx = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    agent.conversationHistory = agent.conversationHistory.slice(0, safeIdx + 1);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  update(agentId, updates) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const allowedKeys = ['name', 'role', 'description', 'instructions', 'temperature', 'maxTokens', 'contextLength', 'enabled', 'project', 'color', 'icon'];
    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        agent[key] = updates[key];
        if (key === 'project') {
          agent.projectChangedAt = new Date().toISOString();
        }
      }
    }
    agent.updatedAt = new Date().toISOString();
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return this._sanitize(agent);
  },

  delete(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    this.agents.delete(agentId);
    deleteAgentFromDb(agentId);
    this._emit('agent:deleted', { id: agentId });
    return true;
  },

  stop(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.status = 'stopped';
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  getAgentStatus(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      status: agent.status,
      currentTask: agent.currentTask,
      activeTasks: (agent.todoList || []).filter(t => this._isActiveTaskStatus(t.status)),
      project: agent.project,
      enabled: agent.enabled
    };
  },

  getAgentStatuses(project = null) {
    const agents = project
      ? Array.from(this.agents.values()).filter(a => a.project === project)
      : Array.from(this.agents.values());
    return agents.map(a => this.getAgentStatus(a.id));
  },

  _collectTasks(projectFilter = null) {
    const tasks = [];
    for (const [, agent] of this.agents) {
      if (projectFilter && agent.project !== projectFilter) continue;
      for (const t of (agent.todoList || [])) {
        tasks.push({ ...t, agentId: agent.id, agentName: agent.name, project: agent.project });
      }
    }
    return tasks;
  },

  getTaskStats(projectFilter = null) {
    const tasks = this._collectTasks(projectFilter);
    const total = tasks.length;
    const done = tasks.filter(t => t.status === 'done').length;
    const active = tasks.filter(t => !['done', 'error', 'backlog'].includes(t.status || 'backlog')).length;
    const waiting = tasks.filter(t => ['error', 'backlog'].includes(t.status || 'backlog')).length;
    const bugs = tasks.filter(t => (t.type || 'bug') === 'bug').length;
    const features = tasks.filter(t => t.type === 'feature').length;
    const byType = {};
    for (const t of tasks) {
      const type = t.type || 'untyped';
      byType[type] = (byType[type] || 0) + 1;
    }

    const resolution = { count: done, avg: 0 };
    const resolutionTimes = [];
    for (const t of tasks) {
      if (t.status === 'done' && t.history?.length) {
        for (const h of t.history) {
          if ((h.status || h.to) === 'done') {
            const created = new Date(t.createdAt).getTime();
            const resolved = new Date(h.at).getTime();
            if (resolved > created) resolutionTimes.push(resolved - created);
            break;
          }
        }
      }
    }
    if (resolutionTimes.length > 0) {
      resolution.avg = resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length;
    }

    const avgStateDurations = {};
    for (const t of tasks) {
      if (!t.history?.length) continue;
      for (let i = 0; i < t.history.length - 1; i++) {
        const curr = t.history[i];
        const next = t.history[i + 1];
        const state = curr.status || curr.to;
        const currTime = new Date(curr.at).getTime();
        const nextTime = new Date(next.at).getTime();
        const duration = nextTime - currTime;
        if (duration > 0) {
          if (!avgStateDurations[state]) avgStateDurations[state] = { sum: 0, count: 0 };
          avgStateDurations[state].sum += duration;
          avgStateDurations[state].count += 1;
        }
      }
    }
    for (const [state, data] of Object.entries(avgStateDurations)) {
      avgStateDurations[state] = { avg: data.sum / data.count, count: data.count };
    }

    return {
      total,
      done,
      active,
      waiting,
      bugs,
      features,
      byType,
      resolution,
      avgStateDurations
    };
  },

  getTaskTimeSeries(projectFilter = null, days = 30) {
    const tasks = this._collectTasks(projectFilter);
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const toDay = (iso) => iso ? new Date(iso).toISOString().slice(0, 10) : null;

    const createdByDay = {};
    const resolvedByDay = {};
    const resolutionTimesByDay = {};

    for (const t of tasks) {
      const createdDay = toDay(t.createdAt);
      if (createdDay && new Date(t.createdAt) >= cutoff) {
        createdByDay[createdDay] = (createdByDay[createdDay] || 0) + 1;
      }

      if (t.history?.length) {
        for (const h of t.history) {
          const target = h.status || h.to;
          if (target === 'done' && h.at && new Date(h.at) >= cutoff) {
            const resolvedDay = toDay(h.at);
            resolvedByDay[resolvedDay] = (resolvedByDay[resolvedDay] || 0) + 1;
            const created = new Date(t.createdAt).getTime();
            const resolved = new Date(h.at).getTime();
            const resMs = resolved - created;
            if (resMs > 0) {
              if (!resolutionTimesByDay[resolvedDay]) resolutionTimesByDay[resolvedDay] = [];
              resolutionTimesByDay[resolvedDay].push(resMs);
            }
            break;
          }
        }
      }
    }

    const allDays = [];
    for (let d = new Date(cutoff); d <= now; d.setDate(d.getDate() + 1)) {
      allDays.push(d.toISOString().slice(0, 10));
    }

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const createdVsResolved = allDays.map(day => ({
      date: day,
      created: createdByDay[day] || 0,
      resolved: resolvedByDay[day] || 0,
    }));

    const resolutionTimeEvolution = allDays
      .filter(day => resolutionTimesByDay[day]?.length > 0)
      .map(day => ({
        date: day,
        avgMs: Math.round(avg(resolutionTimesByDay[day])),
        count: resolutionTimesByDay[day].length,
      }));

    let cumOpen = 0;
    for (const t of tasks) {
      if (new Date(t.createdAt) < cutoff && t.status !== 'done') cumOpen++;
      if (new Date(t.createdAt) < cutoff && t.status === 'done') {
        const doneEntry = t.history?.find(h => (h.status || h.to) === 'done');
        if (doneEntry && new Date(doneEntry.at) >= cutoff) cumOpen++;
      }
    }
    const openOverTime = createdVsResolved.map(d => {
      cumOpen += d.created - d.resolved;
      return { date: d.date, open: Math.max(0, cumOpen) };
    });

    return { createdVsResolved, resolutionTimeEvolution, openOverTime };
  },

  getProjectTimeSpent(projectFilter = null, days = 30) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const toDay = (iso) => iso ? new Date(iso).toISOString().slice(0, 10) : null;

    // Collect all agents for the project
    const agents = projectFilter
      ? Array.from(this.agents.values()).filter(a => a.project === projectFilter)
      : Array.from(this.agents.values());

    // Aggregate time spent per day
    const timeSpentByDay = {};
    const allDays = [];
    for (let d = new Date(cutoff); d <= now; d.setDate(d.getDate() + 1)) {
      const dayStr = d.toISOString().slice(0, 10);
      allDays.push(dayStr);
      timeSpentByDay[dayStr] = 0;
    }

    for (const agent of agents) {
      if (!agent.actionLogs || agent.actionLogs.length === 0) continue;

      for (const log of agent.actionLogs) {
        if (!log.timestamp) continue;
        const logDay = toDay(log.timestamp);
        if (!logDay || !timeSpentByDay.hasOwnProperty(logDay)) continue;

        // Use durationMs if available, otherwise estimate 5 minutes per action
        const duration = log.durationMs !== undefined && log.durationMs > 0
          ? log.durationMs
          : 5 * 60 * 1000; // 5 minutes default estimate

        timeSpentByDay[logDay] += duration;
      }
    }

    const timeSpentOverTime = allDays.map(day => ({
      date: day,
      timeSpentMs: timeSpentByDay[day]
    }));

    return { timeSpentOverTime };
  },

  getSwarmStatus(userId = null, role = null) {
    const allAgents = (userId && role) ? this._agentsForUser(userId, role) : Array.from(this.agents.values());
    const enabled = allAgents.filter(a => a.enabled !== false);
    const disabled = allAgents.filter(a => a.enabled === false);

    const projectMap = {};
    const unassigned = [];
    for (const agent of enabled) {
      const status = this.getAgentStatus(agent.id);
      if (agent.project) {
        if (!projectMap[agent.project]) projectMap[agent.project] = [];
        projectMap[agent.project].push(status);
      } else {
        unassigned.push(status);
      }
    }

    const projectSummaries = {};
    for (const [project, agents] of Object.entries(projectMap)) {
      projectSummaries[project] = {
        total: agents.length,
        busy: agents.filter(a => a.status === 'busy').length,
        idle: agents.filter(a => a.status === 'idle').length,
        error: agents.filter(a => a.status === 'error').length,
        agents: agents.map(a => ({
          name: a.name,
          status: a.status,
          role: a.role,
          currentTask: a.currentTask || null,
          activeTasks: (a.activeTasks || []).length,
          projectChangedAt: a.projectChangedAt || null
        }))
      };
    }

    return {
      enabled: enabled.map(a => this.getAgentStatus(a.id)),
      disabled: disabled.map(a => this.getAgentStatus(a.id)),
      projectSummaries,
      unassigned
    };
  },

  broadcast(message, project = null) {
    const agents = project
      ? Array.from(this.agents.values()).filter(a => a.project === project && a.enabled !== false)
      : Array.from(this.agents.values()).filter(a => a.enabled !== false);

    for (const agent of agents) {
      agent.conversationHistory.push({
        role: 'system',
        content: `[BROADCAST] ${message}`,
        timestamp: new Date().toISOString()
      });
      saveAgent(agent);
    }
    this._emit('agent:updated', { message: 'broadcast sent' });
    return agents.length;
  },

  handoff(fromAgentId, targetAgentId, context = '') {
    const fromAgent = this.agents.get(fromAgentId);
    const targetAgent = this.agents.get(targetAgentId);
    if (!fromAgent || !targetAgent) return null;

    const targetTask = {
      id: uuidv4(),
      text: context || `Handoff from ${fromAgent.name}`,
      status: 'backlog',
      project: targetAgent.project || fromAgent.project,
      assignee: targetAgentId
    };

    targetAgent.todoList.push(targetTask);
    fromAgent.currentTask = null;
    fromAgent.status = 'idle';

    saveAgent(fromAgent);
    saveAgent(targetAgent);

    this._emit('agent:updated', this._sanitize(fromAgent));
    this._emit('agent:updated', this._sanitize(targetAgent));

    return targetTask;
  },

  addActionLog(agentId, type, message, errorDetail = null) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const now = new Date();

    if (agent.actionLogs.length > 0) {
      const lastLog = agent.actionLogs[agent.actionLogs.length - 1];
      if (!lastLog.durationMs) {
        lastLog.durationMs = now.getTime() - new Date(lastLog.timestamp).getTime();
      }
    }

    // Find the current active task for this agent
    let taskId = null;
    let taskTitle = null;
    const ownTask = agent.todoList?.find(t => this._isActiveTaskStatus(t.status) && (!t.assignee || t.assignee === agentId));
    if (ownTask) {
      taskId = ownTask.id;
      taskTitle = ownTask.text?.slice(0, 200) || null;
    } else {
      for (const [, otherAgent] of this.agents) {
        const delegated = otherAgent.todoList?.find(t => this._isActiveTaskStatus(t.status) && t.assignee === agentId);
        if (delegated) { taskId = delegated.id; taskTitle = delegated.text?.slice(0, 200) || null; break; }
      }
    }

    const entry = {
      id: uuidv4(),
      type,
      message,
      error: errorDetail,
      taskId: taskId || null,
      taskTitle: taskTitle || null,
      timestamp: now.toISOString()
    };

    agent.actionLogs.push(entry);
    if (agent.actionLogs.length > 200) {
      agent.actionLogs = agent.actionLogs.slice(-200);
    }

    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return entry;
  },

  clearActionLogs(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.actionLogs = [];
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  // ─── Execution Log ──────────────────────────────────────────────────
  _saveExecutionLog(creatorAgentId, taskId, executorId, startMsgIdx, startedAt, success = true, actionMode = 'execute') {
    const creator = this.agents.get(creatorAgentId);
    const executor = this.agents.get(executorId);
    if (!creator || !executor) return null;

    const entry = {
      id: uuidv4(),
      creatorAgentId,
      taskId,
      executorId,
      startMsgIdx,
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      success,
      actionMode,
      output: ''
    };

    if (!creator.executionLogs) creator.executionLogs = [];
    creator.executionLogs.push(entry);
    if (creator.executionLogs.length > 100) {
      creator.executionLogs = creator.executionLogs.slice(-100);
    }
    saveAgent(creator);
    this._emit('agent:updated', this._sanitize(creator));
    return entry;
  },

  _isActiveTaskStatus(status) {
    return status && !['done', 'error', 'backlog'].includes(status);
  },

  _sanitize(agent) {
    const { apiKey, ...safe } = agent;
    return safe;
  },

  _randomColor() {
    const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#6366f1'];
    return colors[Math.floor(Math.random() * colors.length)];
  }
};