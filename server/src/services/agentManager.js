import { v4 as uuidv4 } from 'uuid';
import { createProvider } from './llmProviders.js';

export class AgentManager {
  constructor(io) {
    this.agents = new Map();
    this.io = io;
  }

  create(config) {
    const id = uuidv4();
    const agent = {
      id,
      name: config.name || 'Unnamed Agent',
      role: config.role || 'general',
      description: config.description || '',
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint || '',
      apiKey: config.apiKey || '',
      instructions: config.instructions || 'You are a helpful AI assistant.',
      status: 'idle',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
      todoList: config.todoList || [],
      ragDocuments: config.ragDocuments || [],
      conversationHistory: [],
      currentThinking: '',
      metrics: {
        totalMessages: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        lastActiveAt: null,
        errors: 0
      },
      handoffTargets: config.handoffTargets || [],
      template: config.template || null,
      color: config.color || this._randomColor(),
      icon: config.icon || '🤖',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.agents.set(id, agent);
    this._emit('agent:created', this._sanitize(agent));
    return this._sanitize(agent);
  }

  getAll() {
    return Array.from(this.agents.values()).map(a => this._sanitize(a));
  }

  getById(id) {
    const agent = this.agents.get(id);
    if (!agent) return null;
    return this._sanitize(agent);
  }

  update(id, updates) {
    const agent = this.agents.get(id);
    if (!agent) return null;

    const allowed = [
      'name', 'role', 'description', 'instructions', 'temperature',
      'maxTokens', 'todoList', 'ragDocuments', 'handoffTargets',
      'color', 'icon', 'provider', 'model', 'endpoint', 'apiKey'
    ];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        agent[key] = updates[key];
      }
    }
    agent.updatedAt = new Date().toISOString();

    this._emit('agent:updated', this._sanitize(agent));
    return this._sanitize(agent);
  }

  delete(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.agents.delete(id);
    this._emit('agent:deleted', { id });
    return true;
  }

  setStatus(id, status) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.status = status;
    this._emit('agent:status', { id, status });
  }

  // ─── Chat ───────────────────────────────────────────────────────────
  async sendMessage(id, userMessage, streamCallback) {
    const agent = this.agents.get(id);
    if (!agent) throw new Error('Agent not found');

    this.setStatus(id, 'busy');
    agent.currentThinking = '';

    // Build messages array
    const messages = [];
    if (agent.instructions) {
      let systemContent = agent.instructions;
      // Append RAG context if available
      if (agent.ragDocuments.length > 0) {
        systemContent += '\n\n--- Reference Documents ---\n';
        for (const doc of agent.ragDocuments) {
          systemContent += `\n[${doc.name}]:\n${doc.content}\n`;
        }
      }
      // Append todo list context
      if (agent.todoList.length > 0) {
        systemContent += '\n\n--- Current Todo List ---\n';
        for (const todo of agent.todoList) {
          systemContent += `- [${todo.done ? 'x' : ' '}] ${todo.text}\n`;
        }
      }
      messages.push({ role: 'system', content: systemContent });
    }

    // Add conversation history (last 50 messages)
    const recentHistory = agent.conversationHistory.slice(-50);
    messages.push(...recentHistory);

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    // Store user message
    agent.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    });

    try {
      const provider = createProvider({
        provider: agent.provider,
        model: agent.model,
        endpoint: agent.endpoint,
        apiKey: agent.apiKey
      });

      let fullResponse = '';

      // Stream response
      for await (const chunk of provider.chatStream(messages, {
        temperature: agent.temperature,
        maxTokens: agent.maxTokens
      })) {
        if (chunk.type === 'text') {
          fullResponse += chunk.text;
          agent.currentThinking = fullResponse;
          if (streamCallback) streamCallback(chunk.text);
        }
        if (chunk.type === 'done' && chunk.usage) {
          agent.metrics.totalTokensIn += chunk.usage.inputTokens;
          agent.metrics.totalTokensOut += chunk.usage.outputTokens;
        }
      }

      // Store assistant message
      agent.conversationHistory.push({
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date().toISOString()
      });

      agent.metrics.totalMessages += 1;
      agent.metrics.lastActiveAt = new Date().toISOString();
      agent.currentThinking = '';
      this.setStatus(id, 'idle');

      return fullResponse;
    } catch (err) {
      agent.metrics.errors += 1;
      agent.currentThinking = '';
      this.setStatus(id, 'error');
      throw err;
    }
  }

  // ─── Global Broadcast (tmux-style) ─────────────────────────────────
  async broadcastMessage(message, streamCallback) {
    const agents = Array.from(this.agents.values());
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
  }

  // ─── Handoff ────────────────────────────────────────────────────────
  async handoff(fromId, toId, context) {
    const fromAgent = this.agents.get(fromId);
    const toAgent = this.agents.get(toId);
    if (!fromAgent || !toAgent) throw new Error('Agent not found');

    const handoffMessage = `[HANDOFF from ${fromAgent.name}]: ${context}\n\nPrevious conversation context:\n${
      fromAgent.conversationHistory.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n')
    }`;

    this._emit('agent:handoff', {
      from: { id: fromId, name: fromAgent.name },
      to: { id: toId, name: toAgent.name },
      context
    });

    return this.sendMessage(toId, handoffMessage);
  }

  // ─── Todo Management ───────────────────────────────────────────────
  addTodo(agentId, text) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const todo = { id: uuidv4(), text, done: false, createdAt: new Date().toISOString() };
    agent.todoList.push(todo);
    this._emit('agent:updated', this._sanitize(agent));
    return todo;
  }

  toggleTodo(agentId, todoId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const todo = agent.todoList.find(t => t.id === todoId);
    if (!todo) return null;
    todo.done = !todo.done;
    this._emit('agent:updated', this._sanitize(agent));
    return todo;
  }

  deleteTodo(agentId, todoId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.todoList = agent.todoList.filter(t => t.id !== todoId);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  }

  // ─── RAG Document Management ───────────────────────────────────────
  addRagDocument(agentId, name, content) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const doc = { id: uuidv4(), name, content, addedAt: new Date().toISOString() };
    agent.ragDocuments.push(doc);
    this._emit('agent:updated', this._sanitize(agent));
    return doc;
  }

  deleteRagDocument(agentId, docId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.ragDocuments = agent.ragDocuments.filter(d => d.id !== docId);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  }

  // ─── Clear Conversation ────────────────────────────────────────────
  clearHistory(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.conversationHistory = [];
    agent.currentThinking = '';
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  }

  // ─── Helpers ────────────────────────────────────────────────────────
  _sanitize(agent) {
    const { apiKey, ...rest } = agent;
    return { ...rest, hasApiKey: !!apiKey };
  }

  _emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }

  _randomColor() {
    const colors = [
      '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f97316',
      '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }
}
