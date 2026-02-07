import { v4 as uuidv4 } from 'uuid';
import { createProvider } from './llmProviders.js';
import { getAllAgents, saveAgent, deleteAgentFromDb } from './database.js';
import { TOOL_DEFINITIONS, parseToolCalls, executeTool } from './agentTools.js';

export class AgentManager {
  constructor(io) {
    this.agents = new Map();
    this.abortControllers = new Map(); // Track ongoing requests by agentId
    this.io = io;
  }

  async loadFromDatabase() {
    try {
      const agents = await getAllAgents();
      for (const agent of agents) {
        // Reset runtime state
        agent.status = 'idle';
        agent.currentThinking = '';
        this.agents.set(agent.id, agent);
      }
      console.log(`📂 Loaded ${agents.length} agents from database`);
    } catch (err) {
      console.error('Failed to load agents from database:', err.message);
    }
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
      project: config.project || null,
      isLeader: config.isLeader || false,
      template: config.template || null,
      color: config.color || this._randomColor(),
      icon: config.icon || '🤖',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.agents.set(id, agent);
    saveAgent(agent); // Persist to database
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
      'color', 'icon', 'provider', 'model', 'endpoint', 'apiKey', 'project', 'isLeader'
    ];

    for (const key of allowed) {
      if (updates[key] !== undefined) {
        agent[key] = updates[key];
      }
    }
    agent.updatedAt = new Date().toISOString();

    saveAgent(agent); // Persist to database
    this._emit('agent:updated', this._sanitize(agent));
    return this._sanitize(agent);
  }

  delete(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;
    this.agents.delete(id);
    deleteAgentFromDb(id); // Remove from database
    this._emit('agent:deleted', { id });
    return true;
  }

  updateAllProjects(project) {
    const updated = [];
    for (const agent of this.agents.values()) {
      agent.project = project;
      agent.updatedAt = new Date().toISOString();
      saveAgent(agent);
      updated.push(this._sanitize(agent));
      this._emit('agent:updated', this._sanitize(agent));
    }
    return updated;
  }

  setStatus(id, status) {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.status = status;
    this._emit('agent:status', { id, status });
  }

  // ─── Stop Agent ─────────────────────────────────────────────────────
  stopAgent(id) {
    const agent = this.agents.get(id);
    if (!agent) return false;
    
    // Abort any in-progress request
    const controller = this.abortControllers.get(id);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(id);
    }
    
    // Reset agent state
    agent.currentThinking = '';
    this.setStatus(id, 'idle');
    saveAgent(agent);
    
    console.log(`🛑 Agent ${agent.name} stopped`);
    this._emit('agent:stopped', { id, name: agent.name });
    return true;
  }

  // ─── Chat ───────────────────────────────────────────────────────────
  async sendMessage(id, userMessage, streamCallback, delegationDepth = 0) {
    const MAX_DELEGATION_DEPTH = 5; // Prevent infinite loops
    
    // Create abort controller for this request
    const abortController = new AbortController();
    this.abortControllers.set(id, abortController);
    
    const agent = this.agents.get(id);
    if (!agent) throw new Error('Agent not found');

    this.setStatus(id, 'busy');
    agent.currentThinking = '';

    // Build messages array
    const messages = [];
    if (agent.instructions) {
      let systemContent = agent.instructions;
      
      // For leader agents, inject available agents context (only at top level to avoid confusion)
      if (agent.isLeader && delegationDepth === 0) {
        const availableAgents = Array.from(this.agents.values())
          .filter(a => a.id !== id) // Exclude self
          .map(a => `- ${a.name} (${a.role}): ${a.description || 'No description'}`);
        
        if (availableAgents.length > 0) {
          systemContent += `\n\n--- Available Swarm Agents ---\nYou can delegate tasks to these agents using the format: @delegate(AgentName, "task description")\n${availableAgents.join('\n')}\n\nWhen you need an agent to work on something, use the @delegate command. The agent's response will be provided back to you.`;
        } else {
          systemContent += `\n\n--- Available Swarm Agents ---\nNo other agents are currently available in the swarm. You will need to complete tasks yourself or ask the user to create specialist agents.`;
        }
      }
      
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
      
      // Inject tool definitions when agent has a project assigned
      if (agent.project) {
        systemContent += `\n\n--- PROJECT CONTEXT ---\nYou are working on project: ${agent.project}\n`;
        systemContent += TOOL_DEFINITIONS;
        systemContent += `\nAlways use these tools to read, analyze, and modify code. Do not just discuss - take action!`;
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

      // Stream response (check for abort on each chunk)
      for await (const chunk of provider.chatStream(messages, {
        temperature: agent.temperature,
        maxTokens: agent.maxTokens
      })) {
        // Check if aborted
        if (abortController.signal.aborted) {
          throw new Error('Agent stopped by user');
        }
        
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
      saveAgent(agent); // Persist conversation and metrics

      // Process tool calls if agent has a project (with depth limit)
      if (agent.project && delegationDepth < MAX_DELEGATION_DEPTH) {
        const toolResults = await this._processToolCalls(id, fullResponse, streamCallback, delegationDepth);
        if (toolResults.length > 0) {
          // Feed tool results back to agent and continue
          const resultsSummary = toolResults.map(r => 
            `--- ${r.tool}(${r.args.join(', ')}) ---\n${r.success ? r.result : `ERROR: ${r.error}`}`
          ).join('\n\n');
          
          const continuedResponse = await this.sendMessage(
            id,
            `[TOOL RESULTS]\n${resultsSummary}\n\nContinue with your task based on these results. Use more tools if needed, or provide your final response.`,
            streamCallback,
            delegationDepth + 1
          );
          this.setStatus(id, 'idle');
          return continuedResponse;
        }
      }

      // For leader agents, process delegation commands (with depth limit)
      if (agent.isLeader && delegationDepth < MAX_DELEGATION_DEPTH) {
        const delegationResults = await this._processDelegations(id, fullResponse, streamCallback, delegationDepth);
        if (delegationResults.length > 0) {
          // Feed delegation results back to leader and get synthesis
          const resultsSummary = delegationResults.map(r => 
            `--- Response from ${r.agentName} ---\n${r.response || r.error}`
          ).join('\n\n');
          
          // Continue conversation with delegation results (increment depth)
          const synthesisResponse = await this.sendMessage(
            id, 
            `[DELEGATION RESULTS]\n${resultsSummary}\n\nPlease synthesize these results and continue with your plan. If more delegations are needed, use @delegate() commands. If the task is complete, provide the final response.`,
            streamCallback,
            delegationDepth + 1
          );
          this.setStatus(id, 'idle');
          return synthesisResponse;
        }
      } else if (agent.isLeader && delegationDepth >= MAX_DELEGATION_DEPTH) {
        console.log(`⚠️ Max delegation depth (${MAX_DELEGATION_DEPTH}) reached for leader ${agent.name}`);
      }

      this.setStatus(id, 'idle');
      this.abortControllers.delete(id); // Clean up abort controller
      return fullResponse;
    } catch (err) {
      this.abortControllers.delete(id); // Clean up abort controller
      agent.metrics.errors += 1;
      agent.currentThinking = '';
      this.setStatus(id, err.message === 'Agent stopped by user' ? 'idle' : 'error');
      saveAgent(agent); // Persist error count
      throw err;
    }
  }

  // ─── Tool Execution (for agents with projects) ────────────────────
  async _processToolCalls(agentId, response, streamCallback, depth = 0) {
    const agent = this.agents.get(agentId);
    if (!agent || !agent.project) return [];
    
    const toolCalls = parseToolCalls(response);
    if (toolCalls.length === 0) return [];
    
    console.log(`🔧 Agent ${agent.name} executing ${toolCalls.length} tool(s)`);
    
    const results = [];
    for (const call of toolCalls) {
      try {
        if (streamCallback) {
          streamCallback(`\n[Executing: @${call.tool}(${call.args[0]})...]\n`);
        }
        
        this._emit('agent:tool', {
          agentId,
          agentName: agent.name,
          tool: call.tool,
          args: call.args
        });
        
        const result = await executeTool(call.tool, call.args, agent.project);
        results.push({
          tool: call.tool,
          args: call.args,
          ...result
        });
        
        if (streamCallback && result.success) {
          const preview = result.result.slice(0, 500);
          streamCallback(`${preview}${result.result.length > 500 ? '...(truncated)' : ''}\n`);
        }
      } catch (err) {
        results.push({
          tool: call.tool,
          args: call.args,
          success: false,
          error: err.message
        });
      }
    }
    
    return results;
  }

  // ─── Delegation Processing (for Leader agents) ────────────────────
  async _processDelegations(leaderId, response, streamCallback, delegationDepth = 0) {
    // Parse @delegate(AgentName, "task") commands from response
    const delegationPattern = /@delegate\s*\(\s*([^,]+?)\s*,\s*["'](.+?)["']\s*\)/gi;
    const delegations = [];
    let match;
    
    while ((match = delegationPattern.exec(response)) !== null) {
      delegations.push({
        agentName: match[1].trim(),
        task: match[2].trim()
      });
    }
    
    if (delegations.length === 0) return [];
    
    const leader = this.agents.get(leaderId);
    const results = [];
    
    // Execute each delegation
    for (const delegation of delegations) {
      // Find target agent by name (case-insensitive)
      const targetAgent = Array.from(this.agents.values()).find(
        a => a.name.toLowerCase() === delegation.agentName.toLowerCase() && a.id !== leaderId
      );
      
      if (!targetAgent) {
        results.push({
          agentName: delegation.agentName,
          response: null,
          error: `Agent "${delegation.agentName}" not found in swarm`
        });
        continue;
      }
      
      try {
        this._emit('agent:delegation', {
          from: { id: leaderId, name: leader.name },
          to: { id: targetAgent.id, name: targetAgent.name },
          task: delegation.task
        });
        
        // Send task to target agent (pass depth to prevent nested leader loops)
        const agentResponse = await this.sendMessage(
          targetAgent.id,
          `[TASK from ${leader.name}]: ${delegation.task}`,
          (chunk) => {
            if (streamCallback) streamCallback(`\n[${targetAgent.name}]: ${chunk}`);
          },
          delegationDepth + 1
        );
        
        results.push({
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          task: delegation.task,
          response: agentResponse,
          error: null
        });
      } catch (err) {
        results.push({
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          task: delegation.task,
          response: null,
          error: err.message
        });
      }
    }
    
    return results;
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
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return todo;
  }

  toggleTodo(agentId, todoId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const todo = agent.todoList.find(t => t.id === todoId);
    if (!todo) return null;
    todo.done = !todo.done;
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return todo;
  }

  deleteTodo(agentId, todoId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.todoList = agent.todoList.filter(t => t.id !== todoId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  }

  // ─── RAG Document Management ───────────────────────────────────────
  addRagDocument(agentId, name, content) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const doc = { id: uuidv4(), name, content, addedAt: new Date().toISOString() };
    agent.ragDocuments.push(doc);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return doc;
  }

  deleteRagDocument(agentId, docId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.ragDocuments = agent.ragDocuments.filter(d => d.id !== docId);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return true;
  }

  // ─── Clear Conversation ────────────────────────────────────────────
  clearHistory(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;
    agent.conversationHistory = [];
    agent.currentThinking = '';
    saveAgent(agent);
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
