// ─── Broadcast & Handoff ────────────────────────────────────────────────────
import { transferUserFiles } from './helpers.js';

/** @this {import('./index.js').AgentManager} */
export const broadcastMethods = {

  async broadcastMessage(message, streamCallback, agentIdFilter = null) {
    let agents = Array.from(this.agents.values()).filter(a => a.enabled !== false);
    if (agentIdFilter) {
      agents = agents.filter(a => agentIdFilter.has(a.id));
    }
    const results = [];

    const promises = agents.map(async (agent) => {
      try {
        const response = await this.sendMessage(
          agent.id,
          message,
          (chunk) => streamCallback && streamCallback(agent.id, chunk)
        );
        results.push({ agentId: agent.id, agentName: agent.name, response, error: null });
      } catch (err) {
        results.push({ agentId: agent.id, agentName: agent.name, response: null, error: err.message });
      }
    });

    await Promise.all(promises);
    return results;
  },

  async handoff(fromId, toId, context, streamCallback) {
    const fromAgent = this.agents.get(fromId);
    const toAgent = this.agents.get(toId);
    if (!fromAgent || !toAgent) throw new Error('Agent not found');

    const handoffMessage = `[HANDOFF from ${fromAgent.name}]: ${context}\n\nPrevious conversation context:\n${
      fromAgent.conversationHistory.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n')
    }`;

    this._emit('agent:handoff', {
      from: { id: fromId, name: fromAgent.name, project: fromAgent.project || null },
      to: { id: toId, name: toAgent.name, project: toAgent.project || null },
      context
    });

    const fileTransferResult = await transferUserFiles(fromId, toId);

    const response = await this.sendMessage(toId, handoffMessage, streamCallback);

    return {
      ...response,
      fileTransfer: fileTransferResult
    };
  },
};
