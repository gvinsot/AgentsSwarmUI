// ─── Agent Getters: read-only lookups ────────────────────────────────────────

/** @this {import('./index.js').AgentManager} */
export const gettersMethods = {

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
      index: startIndex + idx,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp || null,
      type: m.type || null
    }));

    return {
      agentId: agent.id,
      agentName: agent.name,
      project: agent.project || null,
      status: agent.status,
      totalMessages: history.length,
      returned: messages.length,
      limit: safeLimit,
      messages
    };
  },

  getLastMessagesByName(agentName, limit = 1) {
    if (!agentName) return null;
    const target = Array.from(this.agents.values()).find(
      a => (a.name || '').toLowerCase() === String(agentName).toLowerCase()
    );
    if (!target) return null;
    return this.getLastMessages(target.id, limit);
  },
};
