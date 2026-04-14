// ─── Task Statistics & Time Series ──────────────────────────────────────────

/** @this {import('./index.js').AgentManager} */
export const taskStatsMethods = {

  _collectTasks(projectFilter = null) {
    const tasks = [];
    for (const agent of this.agents.values()) {
      const tasks_ = this._getAgentTasks(agent.id);
      if (!tasks_.length) continue;
      for (const t of tasks_) {
        const proj = t.project || agent.project || null;
        if (projectFilter && proj !== projectFilter) continue;
        tasks.push({ ...t, _agentId: agent.id, _project: proj });
      }
    }
    return tasks;
  },

  getTaskStats(projectFilter = null) {
    const tasks = this._collectTasks(projectFilter);
    const total = tasks.length;
    const byType = {};
    const byStatus = {};
    const resolutionTimes = [];
    const resolutionByType = {};
    const stateDurations = {};

    for (const t of tasks) {
      const typ = t.taskType || 'untyped';
      byType[typ] = (byType[typ] || 0) + 1;
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;

      if (t.status === 'done' && t.history?.length) {
        const doneEntry = [...t.history].reverse().find(h => h.status === 'done' || h.to === 'done');
        if (doneEntry) {
          const created = new Date(t.createdAt).getTime();
          const resolved = new Date(doneEntry.at).getTime();
          const resMs = resolved - created;
          if (resMs > 0) {
            resolutionTimes.push(resMs);
            if (!resolutionByType[typ]) resolutionByType[typ] = [];
            resolutionByType[typ].push(resMs);
          }
        }
      }

      if (t.history?.length > 1) {
        for (let i = 0; i < t.history.length - 1; i++) {
          const state = t.history[i].status || t.history[i].to;
          const enterTime = new Date(t.history[i].at).getTime();
          const exitTime = new Date(t.history[i + 1].at).getTime();
          const dur = exitTime - enterTime;
          if (dur > 0 && state) {
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

    const resolutionByTypeStats = {};
    for (const [typ, arr] of Object.entries(resolutionByType)) {
      resolutionByTypeStats[typ] = { count: arr.length, avg: Math.round(avg(arr)), median: Math.round(median(arr)) };
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
      resolutionByType: resolutionByTypeStats,
      avgStateDurations,
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

  getAgentTimeSeries(projectFilter = null, days = 30) {
    const tasks = this._collectTasks(projectFilter);
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const toDay = (d) => d.toISOString().slice(0, 10);

    const ACTIVE_STATES = new Set(['pending', 'in_progress', 'code', 'build', 'test', 'deploy', 'review']);

    // Build a map: agentId -> agentName
    const agentNames = {};
    for (const agent of this.agents.values()) {
      agentNames[agent.id] = agent.name || agent.id.slice(0, 8);
    }

    // dailyAgent: { "2026-03-20": { "agentId1": msTotal, "agentId2": msTotal } }
    const dailyAgent = {};

    for (const t of tasks) {
      const agentId = t.assignee || t.agentId || t._agentId;
      if (!agentId) continue;

      // Build timeline from history entries
      const events = [];
      if (t.history?.length) {
        for (const h of t.history) {
          if (h.at) {
            events.push({ at: new Date(h.at).getTime(), status: h.status || h.to || null });
          }
        }
      }
      // If task was started but has no history transitions, use startedAt -> completedAt/now
      if (events.length === 0 && t.startedAt) {
        const start = new Date(t.startedAt).getTime();
        const end = t.completedAt ? new Date(t.completedAt).getTime() : now.getTime();
        events.push({ at: start, status: t.status });
        events.push({ at: end, status: 'done' });
      }

      if (events.length < 2) continue;
      events.sort((a, b) => a.at - b.at);

      // Walk through consecutive pairs and attribute active time
      for (let i = 0; i < events.length - 1; i++) {
        const state = events[i].status;
        if (!state || !ACTIVE_STATES.has(state)) continue;

        const start = Math.max(events[i].at, cutoff.getTime());
        const end = Math.min(events[i + 1].at, now.getTime());
        if (end <= start) continue;

        // Distribute across days
        let cursor = new Date(start);
        while (cursor.getTime() < end) {
          const dayStr = toDay(cursor);
          const dayEnd = new Date(cursor);
          dayEnd.setUTCHours(23, 59, 59, 999);
          const segEnd = Math.min(dayEnd.getTime() + 1, end);
          const ms = segEnd - cursor.getTime();

          if (ms > 0) {
            if (!dailyAgent[dayStr]) dailyAgent[dayStr] = {};
            dailyAgent[dayStr][agentId] = (dailyAgent[dayStr][agentId] || 0) + ms;
          }

          // Move to next day
          cursor = new Date(dayEnd.getTime() + 1);
        }
      }
    }

    // Build date range
    const allDays = [];
    for (let d = new Date(cutoff); d <= now; d.setDate(d.getDate() + 1)) {
      allDays.push(d.toISOString().slice(0, 10));
    }

    // Collect all agents that appear
    const agentSet = new Set();
    for (const dayData of Object.values(dailyAgent)) {
      for (const id of Object.keys(dayData)) agentSet.add(id);
    }

    const agents = Array.from(agentSet).map(id => ({
      id,
      name: agentNames[id] || id.slice(0, 8),
    }));

    const daily = allDays.map(date => {
      const agentTimes = {};
      for (const a of agents) {
        agentTimes[a.id] = dailyAgent[date]?.[a.id] || 0;
      }
      return { date, agentTimes };
    });

    // Totals
    let totalMs = 0;
    for (const d of daily) {
      for (const ms of Object.values(d.agentTimes)) totalMs += ms;
    }
    const daysWithData = daily.filter(d => Object.values(d.agentTimes).some(ms => ms > 0)).length;
    const avgDailyMs = daysWithData > 0 ? Math.round(totalMs / daysWithData) : 0;

    return { agents, daily, totalMs, avgDailyMs };
  },
};
