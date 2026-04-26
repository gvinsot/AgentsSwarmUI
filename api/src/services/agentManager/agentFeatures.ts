// ─── Agent Features: RAG Documents, Skills, MCP Servers ─────────────────────
import { v4 as uuidv4 } from 'uuid';
import { saveAgent } from '../database.js';

async function fetchUrlContent(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'PulsarTeam/1.0', 'Accept': 'text/plain, text/html, text/markdown, application/json, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const maxChars = 200_000;
    return text.length > maxChars ? text.slice(0, maxChars) + '\n\n[... truncated at 200k chars]' : text;
  } finally {
    clearTimeout(timeout);
  }
}

/** @this {import('./index.js').AgentManager} */
export const agentFeaturesMethods = {

  // ─── RAG Document Management ───────────────────────────────────────
  addRagDocument(this: any, agentId: string, name: string, content: string): any {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const doc = { id: uuidv4(), name, content, type: 'text' as const, addedAt: new Date().toISOString() };
    agent.ragDocuments.push(doc);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return doc;
  },

  async addRagUrlDocument(this: any, agentId: string, name: string, url: string): Promise<any> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const content = await fetchUrlContent(url);
    const doc = {
      id: uuidv4(), name, url, content,
      type: 'url' as const,
      addedAt: new Date().toISOString(),
      lastFetched: new Date().toISOString(),
    };
    agent.ragDocuments.push(doc);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return doc;
  },

  async refreshRagUrlDocument(this: any, agentId: string, docId: string): Promise<any> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const doc = agent.ragDocuments.find((d: any) => d.id === docId);
    if (!doc || doc.type !== 'url' || !doc.url) return null;
    doc.content = await fetchUrlContent(doc.url);
    doc.lastFetched = new Date().toISOString();
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return doc;
  },

  deleteRagDocument(this: any, agentId: string, docId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.ragDocuments = agent.ragDocuments.filter((d: any) => d.id !== docId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  // ─── Skills ────────────────────────────────────────────────────────
  assignSkill(this: any, agentId: string, skillId: string): any {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    if (!agent.skills) agent.skills = [];
    if (agent.skills.includes(skillId)) return agent.skills;
    agent.skills.push(skillId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return agent.skills;
  },

  removeSkill(this: any, agentId: string, skillId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    if (!agent.skills) agent.skills = [];
    agent.skills = agent.skills.filter((id: string) => id !== skillId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },

  // ─── MCP Servers ──────────────────────────────────────────────────
  assignMcpServer(this: any, agentId: string, serverId: string): any {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    if (!agent.mcpServers) agent.mcpServers = [];
    if (agent.mcpServers.includes(serverId)) return agent.mcpServers;
    agent.mcpServers.push(serverId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return agent.mcpServers;
  },

  removeMcpServer(this: any, agentId: string, serverId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    if (!agent.mcpServers) agent.mcpServers = [];
    agent.mcpServers = agent.mcpServers.filter((id: string) => id !== serverId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  },
};
