import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const TODOS_FILE = path.join(DATA_DIR, 'global-todos.json');

class GlobalTodoStore {
  constructor() {
    this.todos = new Map();
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(TODOS_FILE)) {
        const data = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf8'));
        if (Array.isArray(data)) {
          for (const t of data) {
            // Backfill: ensure type and history exist
            if (!t.type) t.type = 'bug';
            if (!t.history) t.history = [{ from: null, to: t.status || 'backlog', at: t.createdAt || new Date().toISOString(), by: null }];
            this.todos.set(t.id, t);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load global todos:', err.message);
    }
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(TODOS_FILE, JSON.stringify(Array.from(this.todos.values()), null, 2));
    } catch (err) {
      console.error('Failed to save global todos:', err.message);
    }
  }

  getAll() {
    return Array.from(this.todos.values());
  }

  add({ title, description, priority, status, assignee, project, type }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const initialStatus = status || 'backlog';
    const todo = {
      id,
      title: title || 'Untitled',
      description: description || '',
      status: initialStatus,
      type: type || 'bug',
      priority: priority || 'medium',
      assignee: assignee || null,
      project: project || null,
      createdAt: now,
      updatedAt: now,
      history: [{ from: null, to: initialStatus, at: now, by: null }],
    };
    this.todos.set(id, todo);
    this._save();
    return todo;
  }

  update(id, updates, changedBy = null) {
    const todo = this.todos.get(id);
    if (!todo) return null;
    const now = new Date().toISOString();
    const oldStatus = todo.status;

    if (updates.title !== undefined) todo.title = updates.title;
    if (updates.description !== undefined) todo.description = updates.description;
    if (updates.priority !== undefined) todo.priority = updates.priority;
    if (updates.assignee !== undefined) todo.assignee = updates.assignee;
    if (updates.project !== undefined) todo.project = updates.project;
    if (updates.type !== undefined) todo.type = updates.type;

    // Track status changes in history
    if (updates.status !== undefined && updates.status !== oldStatus) {
      todo.status = updates.status;
      if (!todo.history) todo.history = [];
      todo.history.push({ from: oldStatus, to: updates.status, at: now, by: changedBy });
    }

    todo.updatedAt = now;
    this._save();
    return todo;
  }

  delete(id) {
    const existed = this.todos.has(id);
    this.todos.delete(id);
    if (existed) this._save();
    return existed;
  }

  get(id) {
    return this.todos.get(id) || null;
  }

  getHistory(id) {
    const todo = this.todos.get(id);
    if (!todo) return null;
    return todo.history || [];
  }

  getStats(projectFilter = null) {
    let todos = Array.from(this.todos.values());
    if (projectFilter) {
      todos = todos.filter(t => t.project === projectFilter);
    }

    const total = todos.length;
    const byType = { bug: 0, feature: 0 };
    const byStatus = {};
    const resolutionTimes = [];
    const resolutionByType = { bug: [], feature: [] };
    const stateDurations = {};

    for (const t of todos) {
      // Count by type
      byType[t.type || 'bug'] = (byType[t.type || 'bug'] || 0) + 1;

      // Count by status
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;

      // Calculate resolution time (creation to done)
      if (t.status === 'done' && t.history?.length) {
        const doneEntry = [...t.history].reverse().find(h => h.to === 'done');
        if (doneEntry) {
          const created = new Date(t.createdAt).getTime();
          const resolved = new Date(doneEntry.at).getTime();
          const resMs = resolved - created;
          if (resMs > 0) {
            resolutionTimes.push(resMs);
            const typ = t.type || 'bug';
            if (!resolutionByType[typ]) resolutionByType[typ] = [];
            resolutionByType[typ].push(resMs);
          }
        }
      }

      // Calculate time in each state
      if (t.history?.length > 1) {
        for (let i = 0; i < t.history.length - 1; i++) {
          const state = t.history[i].to;
          const enterTime = new Date(t.history[i].at).getTime();
          const exitTime = new Date(t.history[i + 1].at).getTime();
          const dur = exitTime - enterTime;
          if (dur > 0) {
            if (!stateDurations[state]) stateDurations[state] = [];
            stateDurations[state].push(dur);
          }
        }
      }
    }

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const median = arr => {
      if (!arr.length) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const avgStateDurations = {};
    for (const [state, durations] of Object.entries(stateDurations)) {
      avgStateDurations[state] = {
        avg: Math.round(avg(durations)),
        median: Math.round(median(durations)),
        count: durations.length,
      };
    }

    return {
      total,
      byType,
      byStatus,
      resolution: {
        count: resolutionTimes.length,
        avg: Math.round(avg(resolutionTimes)),
        median: Math.round(median(resolutionTimes)),
      },
      resolutionByType: {
        bug: { count: resolutionByType.bug.length, avg: Math.round(avg(resolutionByType.bug)), median: Math.round(median(resolutionByType.bug)) },
        feature: { count: resolutionByType.feature.length, avg: Math.round(avg(resolutionByType.feature)), median: Math.round(median(resolutionByType.feature)) },
      },
      avgStateDurations,
    };
  }
}

export const globalTodoStore = new GlobalTodoStore();