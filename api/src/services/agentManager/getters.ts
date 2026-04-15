// ─── Agent Getters: read-only lookups ────────────────────────────────────────

/** @this {import('./index.js').AgentManager} */
export const gettersMethods = {

  getAll(this: any): any[] {
    return Array.from(this.agents.values()).map((a: any) => this._sanitize(a));
  },

  getAllForUser(this: any, userId: string, role: string): any[] {
    return Array.from(this.agents.values())
      .filter((a: any) => a.ownerId === userId || !a.ownerId)
      .map((a: any) => this._sanitize(a));
  },

  _agentsForUser(this: any, userId: string, role: string): any[] {
    return Array.from(this.agents.values())
      .filter((a: any) => a.ownerId === userId || !a.ownerId);
  },

  getById(this: any, id: string): any {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return this._sanitize(agent);
  },

  getLastMessages(this: any, agentId: string, limit: number = 1): any {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const parsedLimit = Number(limit);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(50, parsedLimit)) : 1;
    const history = Array.isArray(agent.conversationHistory) ? agent.conversationHistory : [];
    const startIndex = Math.max(0, history.length - safeLimit);

    const messages = history.slice(-safeLimit).map((m: any, idx: number) => ({
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

  getLastMessagesByName(this: any, agentName: string, limit: number = 1): any {
    if (!agentName) return null;
    const target = Array.from(this.agents.values()).find(
      (a: any) => (a.name || '').toLowerCase() === String(agentName).toLowerCase()
    );
    if (!target) return null;
    return this.getLastMessages((target as any).id, limit);
  },
};
