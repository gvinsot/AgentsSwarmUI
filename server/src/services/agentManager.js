import { v4 as uuidv4 } from 'uuid';
import { createProvider } from './llmProviders.js';
import { getAllAgents, saveAgent, deleteAgentFromDb } from './database.js';
import { TOOL_DEFINITIONS, parseToolCalls, executeTool } from './agentTools.js';

export class AgentManager {
  constructor(io) {
    this.agents = new Map();
    this.abortControllers = new Map(); // Track ongoing requests by agentId
    this._taskQueues = new Map();       // Per-agent sequential task queue
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
  async sendMessage(id, userMessage, streamCallback, delegationDepth = 0, messageMeta = null) {
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
          systemContent += `\n\n--- Available Swarm Agents ---\nYou can delegate tasks to these agents using the format: @delegate(AgentName, "task description")\n${availableAgents.join('\n')}\n\nWhen you need an agent to work on something, use the @delegate command. The agent's response will be provided back to you.\n\nIMPORTANT: Agents may report errors using @report_error(). When you receive delegation results containing errors, analyze the problem and decide whether to retry the task, reassign it to another agent, provide additional guidance, or escalate to the user.`;
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

    // Store user message (with optional metadata for tool/delegation results)
    const historyEntry = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString()
    };
    if (messageMeta) {
      historyEntry.type = messageMeta.type;
      if (messageMeta.toolResults) historyEntry.toolResults = messageMeta.toolResults;
      if (messageMeta.delegationResults) historyEntry.delegationResults = messageMeta.delegationResults;
      if (messageMeta.fromAgent) historyEntry.fromAgent = messageMeta.fromAgent;
    }
    agent.conversationHistory.push(historyEntry);

    try {
      const provider = createProvider({
        provider: agent.provider,
        model: agent.model,
        endpoint: agent.endpoint,
        apiKey: agent.apiKey
      });

      let fullResponse = '';

      // ── Incremental delegation: detect → enqueue immediately ───────────
      // As the leader streams, we detect complete @delegate() commands and:
      //  1. Notify the UI immediately (create todo + emit event)
      //  2. Enqueue execution on the target agent's task queue
      // The per-agent queue guarantees tasks run one-at-a-time per Developer,
      // but multiple tasks can be ADDED to the queue in parallel.
      // Each enqueue returns a Promise that resolves when execution finishes.
      let detectedCount = 0;
      const delegationPromises = [];   // Promise[] — one per enqueued task
      const isLeaderStreaming = agent.isLeader && delegationDepth < MAX_DELEGATION_DEPTH;

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

          // ── Incremental delegation detection ──────────────────────
          if (isLeaderStreaming) {
            const parsed = this._parseDelegations(fullResponse);
            while (detectedCount < parsed.length) {
              const delegation = parsed[detectedCount];
              detectedCount++;

              const targetAgent = Array.from(this.agents.values()).find(
                a => a.name.toLowerCase() === delegation.agentName.toLowerCase() && a.id !== id
              );

              if (!targetAgent) {
                console.log(`⚠️  Agent "${delegation.agentName}" not found in swarm`);
                delegationPromises.push(
                  Promise.resolve({ agentName: delegation.agentName, response: null, error: `Agent "${delegation.agentName}" not found in swarm` })
                );
                continue;
              }

              console.log(`⚡ [Incremental] Detected delegation #${detectedCount}: ${delegation.agentName} — enqueuing`);

              // Notify UI immediately
              this._emit('agent:delegation', {
                from: { id, name: agent.name },
                to: { id: targetAgent.id, name: targetAgent.name },
                task: delegation.task
              });

              // Create todo immediately
              const todo = this.addTodo(targetAgent.id, `[From ${agent.name}] ${delegation.task}`);

              // Enqueue execution — the queue will process it when the agent is free
              const promise = this._enqueueAgentTask(targetAgent.id, async () => {
                if (streamCallback) streamCallback(`\n\n--- \uD83D\uDCE8 Delegating to ${targetAgent.name} ---\n`);
                let delegateStreamStarted = false;
                const agentResponse = await this.sendMessage(
                  targetAgent.id,
                  `[TASK from ${agent.name}]: ${delegation.task}`,
                  (chunk) => {
                    if (streamCallback) {
                      if (!delegateStreamStarted) {
                        delegateStreamStarted = true;
                        streamCallback(`\n**[${targetAgent.name}]:**\n`);
                      }
                      streamCallback(chunk);
                    }
                  },
                  delegationDepth + 1,
                  { type: 'delegation-task', fromAgent: agent.name }
                );

                // Mark todo as done
                if (todo) {
                  const t = targetAgent.todoList.find(t => t.id === todo.id);
                  if (t) {
                    t.done = true;
                    t.completedAt = new Date().toISOString();
                    saveAgent(targetAgent);
                    this._emit('agent:updated', this._sanitize(targetAgent));
                  }
                }

                return { agentId: targetAgent.id, agentName: targetAgent.name, task: delegation.task, response: agentResponse, error: null };
              }).catch(err => {
                return { agentId: targetAgent?.id, agentName: targetAgent?.name || delegation.agentName, task: delegation.task, response: null, error: err.message };
              });

              delegationPromises.push(promise);
            }
          }
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
          const resultsSummary = toolResults.map(r => {
            if (r.isErrorReport) {
              return `--- ⚠️ ERROR REPORT ---\n${r.args[0] || r.result}`;
            }
            return `--- ${r.tool}(${r.args.join(', ')}) ---\n${r.success ? r.result : `ERROR: ${r.error}`}`;
          }).join('\n\n');

          // Check if there are error reports — add specific instructions for the agent
          const hasErrorReports = toolResults.some(r => r.isErrorReport);
          const hasRealErrors = toolResults.some(r => !r.success && !r.isErrorReport);
          let continuationPrompt = 'Continue with your task based on these results. Use more tools if needed, or provide your final response.';
          if (hasErrorReports) {
            continuationPrompt = 'You reported an error. The error has been escalated to the manager. Summarize what you attempted and what went wrong so the manager can help.';
          } else if (hasRealErrors) {
            continuationPrompt = 'Some tools encountered errors. Try to resolve the issues, use alternative approaches, or use @report_error(description) to escalate the problem to the manager if you cannot resolve it.';
          }
          
          const continuedResponse = await this.sendMessage(
            id,
            `[TOOL RESULTS]\n${resultsSummary}\n\n${continuationPrompt}`,
            streamCallback,
            delegationDepth + 1,
            { type: 'tool-result', toolResults: toolResults.map(r => ({ tool: r.tool, args: r.args, success: r.success, result: r.success ? r.result : undefined, error: r.success ? undefined : r.error, isErrorReport: r.isErrorReport || false })) }
          );
          this.setStatus(id, 'idle');
          return continuedResponse;
        }
      }

      // For leader agents, process delegation commands (with depth limit)
      if (isLeaderStreaming) {
        // Final pass: catch any delegations completed in the last chunk
        const finalParsed = this._parseDelegations(fullResponse);
        while (detectedCount < finalParsed.length) {
          const delegation = finalParsed[detectedCount];
          detectedCount++;

          const targetAgent = Array.from(this.agents.values()).find(
            a => a.name.toLowerCase() === delegation.agentName.toLowerCase() && a.id !== id
          );

          if (!targetAgent) {
            delegationPromises.push(
              Promise.resolve({ agentName: delegation.agentName, response: null, error: `Agent "${delegation.agentName}" not found in swarm` })
            );
            continue;
          }

          this._emit('agent:delegation', {
            from: { id, name: agent.name },
            to: { id: targetAgent.id, name: targetAgent.name },
            task: delegation.task
          });
          const todo = this.addTodo(targetAgent.id, `[From ${agent.name}] ${delegation.task}`);

          const promise = this._enqueueAgentTask(targetAgent.id, async () => {
            if (streamCallback) streamCallback(`\n\n--- \uD83D\uDCE8 Delegating to ${targetAgent.name} ---\n`);
            let delegateStreamStarted = false;
            const agentResponse = await this.sendMessage(
              targetAgent.id,
              `[TASK from ${agent.name}]: ${delegation.task}`,
              (chunk) => {
                if (streamCallback) {
                  if (!delegateStreamStarted) {
                    delegateStreamStarted = true;
                    streamCallback(`\n**[${targetAgent.name}]:**\n`);
                  }
                  streamCallback(chunk);
                }
              },
              delegationDepth + 1,
              { type: 'delegation-task', fromAgent: agent.name }
            );
            if (todo) {
              const t = targetAgent.todoList.find(t => t.id === todo.id);
              if (t) {
                t.done = true;
                t.completedAt = new Date().toISOString();
                saveAgent(targetAgent);
                this._emit('agent:updated', this._sanitize(targetAgent));
              }
            }
            return { agentId: targetAgent.id, agentName: targetAgent.name, task: delegation.task, response: agentResponse, error: null };
          }).catch(err => {
            return { agentId: targetAgent?.id, agentName: targetAgent?.name || delegation.agentName, task: delegation.task, response: null, error: err.message };
          });

          delegationPromises.push(promise);
        }

        if (delegationPromises.length > 0) {
          console.log(`📨 [Delegation] Waiting for ${delegationPromises.length} queued delegation(s) to complete...`);
          // Wait for all enqueued delegations to finish (they run sequentially per agent)
          const delegationResults = await Promise.all(delegationPromises);

          // Notify the stream that delegation results are being processed
          if (streamCallback) {
            streamCallback(`\n\n--- Delegation complete, synthesizing results ---\n\n`);
          }
          
          // Feed delegation results back to leader and get synthesis
          const resultsSummary = delegationResults.map(r => {
            const header = r.error
              ? `--- ⚠️ ERROR from ${r.agentName} ---`
              : `--- Response from ${r.agentName} ---`;
            return `${header}\n${r.response || r.error}`;
          }).join('\n\n');
          
          const hasErrors = delegationResults.some(r => r.error);
          const synthesisHint = hasErrors
            ? 'Some agents reported errors. Decide whether to retry, reassign, or adapt your plan accordingly.'
            : 'Please synthesize these results and continue with your plan. If more delegations are needed, use @delegate() commands. If the task is complete, provide the final response.';

          // Continue conversation with delegation results (increment depth)
          const synthesisResponse = await this.sendMessage(
            id, 
            `[DELEGATION RESULTS]\n${resultsSummary}\n\n${synthesisHint}`,
            streamCallback,
            delegationDepth + 1,
            { type: 'delegation-result', delegationResults: delegationResults.map(r => ({ agentName: r.agentName, task: r.task, response: r.response, error: r.error })) }
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
    if (!agent) return [];
    
    if (!agent.project) {
      // Even without a project, @report_error should still work
      const errorReportCalls = parseToolCalls(response).filter(c => c.tool === 'report_error');
      if (errorReportCalls.length > 0) {
        const results = [];
        for (const call of errorReportCalls) {
          const errorDescription = call.args[0] || 'Unknown error';
          console.log(`🚨 [Error Report] Agent "${agent.name}" (no project) reports: ${errorDescription.slice(0, 200)}`);
          this._emit('agent:error:report', {
            agentId,
            agentName: agent.name,
            description: errorDescription,
            timestamp: new Date().toISOString()
          });
          if (streamCallback) {
            streamCallback(`\n\n🚨 **Error reported by ${agent.name}:** ${errorDescription}\n`);
          }
          results.push({
            tool: 'report_error',
            args: call.args,
            success: true,
            result: `Error reported: ${errorDescription}`,
            isErrorReport: true
          });
        }
        return results;
      }
      
      // Check if the response contains tool-like patterns — warn if tools are used without a project
      const hasToolSyntax = /@(read_file|write_file|list_dir|search_files|run_command|append_file)\s*\(/i.test(response)
        || /<tool_call>/i.test(response);
      if (hasToolSyntax) {
        console.warn(`⚠️  Agent "${agent.name}" generated tool calls but has NO PROJECT assigned — tools will NOT execute. Assign a project to enable tool use.`);
        if (streamCallback) {
          streamCallback(`\n\n⚠️ **Tool calls detected but no project is assigned.** Assign a project to this agent (in Settings tab) to enable file and command tools.\n`);
        }
      }
      return [];
    }
    
    const toolCalls = parseToolCalls(response);
    
    console.log(`\n🔧 [Tools] Parsing response from "${agent.name}" (depth=${depth}, length=${response.length})`);
    
    if (toolCalls.length === 0) {
      // Log if we see tool-like patterns that didn't parse
      const rawCount = (response.match(/@(read_file|write_file|list_dir|search_files|run_command|append_file)/gi) || []).length;
      const tagCount = (response.match(/<tool_call>/gi) || []).length;
      if (rawCount > 0 || tagCount > 0) {
        console.warn(`⚠️  [Tools] Agent "${agent.name}": found ${rawCount} @tool mention(s) and ${tagCount} <tool_call> tag(s) but parseToolCalls returned 0 matches`);
        // Log lines containing tool patterns for debugging
        const lines = response.split('\n');
        const toolLines = lines
          .map((line, i) => ({ line, i }))
          .filter(({ line }) => /@(read_file|write_file|list_dir|search_files|run_command|append_file)/i.test(line) || /<tool_call>/i.test(line));
        for (const { line, i } of toolLines.slice(0, 5)) {
          console.warn(`   L${i + 1}: ${line.slice(0, 200)}`);
        }
      }
      return [];
    }
    
    console.log(`🔧 Agent ${agent.name} executing ${toolCalls.length} tool(s) (project=${agent.project})`);
    
    const results = [];
    for (const call of toolCalls) {
      // ── Handle @report_error() specially ─────────────────────────────
      if (call.tool === 'report_error') {
        const errorDescription = call.args[0] || 'Unknown error';
        console.log(`🚨 [Error Report] Agent "${agent.name}" reports: ${errorDescription.slice(0, 200)}`);
        
        // Emit error report event for UI notifications
        this._emit('agent:error:report', {
          agentId,
          agentName: agent.name,
          description: errorDescription,
          timestamp: new Date().toISOString()
        });

        // Also push into stream so the user can see it inline
        if (streamCallback) {
          streamCallback(`\n\n🚨 **Error reported by ${agent.name}:** ${errorDescription}\n`);
        }

        results.push({
          tool: 'report_error',
          args: call.args,
          success: true,
          result: `Error reported: ${errorDescription}`,
          isErrorReport: true
        });
        continue;
      }

      try {
        // Emit structured tool-start event (not raw text into stream)
        this._emit('agent:tool:start', {
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
        
        if (result.success) {
          // Emit structured tool-result event
          this._emit('agent:tool:result', {
            agentId,
            tool: call.tool,
            args: call.args,
            success: true,
            preview: result.result.slice(0, 300)
          });
        } else {
          // ── Tool returned an error ─────────────────────────────────
          console.warn(`⚠️  [Tool Error] Agent "${agent.name}" — @${call.tool}(${(call.args[0] || '').slice(0, 80)}): ${result.error}`);
          
          this._emit('agent:tool:error', {
            agentId,
            agentName: agent.name,
            tool: call.tool,
            args: call.args,
            error: result.error || 'Unknown error',
            timestamp: new Date().toISOString()
          });

          // Push error visibly into the stream
          if (streamCallback) {
            streamCallback(`\n\n⚠️ **Tool error** \`@${call.tool}(${(call.args[0] || '').slice(0, 100)})\`: ${result.error}\n`);
          }
        }
      } catch (err) {
        console.error(`❌ [Tool Crash] Agent "${agent.name}" — @${call.tool}: ${err.message}`);
        
        results.push({
          tool: call.tool,
          args: call.args,
          success: false,
          error: err.message
        });
        
        this._emit('agent:tool:error', {
          agentId,
          agentName: agent.name,
          tool: call.tool,
          args: call.args,
          error: err.message,
          timestamp: new Date().toISOString()
        });

        if (streamCallback) {
          streamCallback(`\n\n❌ **Tool crashed** \`@${call.tool}(${(call.args[0] || '').slice(0, 100)})\`: ${err.message}\n`);
        }
      }
    }
    
    return results;
  }

  // ─── Delegation Processing (for Leader agents) ────────────────────

  /**
   * Pure parser: extract all complete @delegate(Agent, "task") commands from text.
   * Returns array of { agentName, task }.
   */
  _parseDelegations(text) {
    // Build code-block ranges to skip @delegate inside examples/docs
    const codeBlockRanges = [];
    const cbRe = /```[\s\S]*?```|`[^`]*`/g;
    let cbMatch;
    while ((cbMatch = cbRe.exec(text)) !== null) {
      codeBlockRanges.push({ start: cbMatch.index, end: cbMatch.index + cbMatch[0].length });
    }
    const isInsideCodeBlock = (pos) => codeBlockRanges.some(r => pos >= r.start && pos < r.end);

    const delegations = [];
    const delegateRe = /@delegate\s*\(/gi;
    let reMatch;
    while ((reMatch = delegateRe.exec(text)) !== null) {
      if (isInsideCodeBlock(reMatch.index)) continue;

      const startAfterParen = reMatch.index + reMatch[0].length;
      const commaIdx = text.indexOf(',', startAfterParen);
      if (commaIdx === -1) continue;
      const agentName = text.slice(startAfterParen, commaIdx).trim();

      let i = commaIdx + 1;
      while (i < text.length && /\s/.test(text[i])) i++;
      const quoteChar = text[i];
      if (quoteChar !== '"' && quoteChar !== "'") continue;
      i++;

      let taskContent = '';
      let found = false;
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) {
          taskContent += text[i] + text[i + 1];
          i += 2;
          continue;
        }
        if (text[i] === quoteChar) {
          let j = i + 1;
          while (j < text.length && /\s/.test(text[j])) j++;
          if (j < text.length && text[j] === ')') {
            found = true;
            break;
          }
          taskContent += text[i];
          i++;
          continue;
        }
        taskContent += text[i];
        i++;
      }

      if (found && agentName && taskContent.trim()) {
        delegations.push({ agentName, task: taskContent.trim() });
      }
    }
    return delegations;
  }

  /**
   * Execute a single delegation: find target agent, create todo, send message, mark done.
   * Returns { agentId, agentName, task, response, error }.
   */
  async _executeSingleDelegation(leaderId, delegation, streamCallback, delegationDepth) {
    const leader = this.agents.get(leaderId);
    const targetAgent = Array.from(this.agents.values()).find(
      a => a.name.toLowerCase() === delegation.agentName.toLowerCase() && a.id !== leaderId
    );

    if (!targetAgent) {
      console.log(`⚠️  Agent "${delegation.agentName}" not found in swarm`);
      if (streamCallback) streamCallback(`\n⚠️ Agent "${delegation.agentName}" not found in swarm\n`);
      return { agentName: delegation.agentName, response: null, error: `Agent "${delegation.agentName}" not found in swarm` };
    }

    try {
      console.log(`📨 Delegating to ${targetAgent.name}: ${delegation.task.slice(0, 80)}...`);
      if (streamCallback) streamCallback(`\n\n--- 📨 Delegating to ${targetAgent.name} ---\n`);

      this._emit('agent:delegation', {
        from: { id: leaderId, name: leader.name },
        to: { id: targetAgent.id, name: targetAgent.name },
        task: delegation.task
      });

      const todo = this.addTodo(targetAgent.id, `[From ${leader.name}] ${delegation.task}`);

      let delegateStreamStarted = false;
      const agentResponse = await this.sendMessage(
        targetAgent.id,
        `[TASK from ${leader.name}]: ${delegation.task}`,
        (chunk) => {
          if (streamCallback) {
            if (!delegateStreamStarted) {
              delegateStreamStarted = true;
              streamCallback(`\n**[${targetAgent.name}]:**\n`);
            }
            streamCallback(chunk);
          }
        },
        delegationDepth + 1,
        { type: 'delegation-task', fromAgent: leader.name }
      );

      if (todo) {
        const t = targetAgent.todoList.find(t => t.id === todo.id);
        if (t) {
          t.done = true;
          t.completedAt = new Date().toISOString();
          saveAgent(targetAgent);
          this._emit('agent:updated', this._sanitize(targetAgent));
        }
      }

      return { agentId: targetAgent.id, agentName: targetAgent.name, task: delegation.task, response: agentResponse, error: null };
    } catch (err) {
      return { agentId: targetAgent.id, agentName: targetAgent.name, task: delegation.task, response: null, error: err.message };
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

  // Execute a single todo — sends it as a chat message to the agent
  async executeTodo(agentId, todoId, streamCallback) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');
    const todo = agent.todoList.find(t => t.id === todoId);
    if (!todo) throw new Error('Todo not found');
    if (todo.done) throw new Error('Todo already completed');

    console.log(`▶️  Executing todo for ${agent.name}: "${todo.text.slice(0, 80)}"`);
    this._emit('agent:todo:executing', { agentId, todoId, text: todo.text });

    try {
      const response = await this.sendMessage(
        agentId,
        `[TASK] ${todo.text}`,
        streamCallback
      );

      // Mark as done
      todo.done = true;
      todo.completedAt = new Date().toISOString();
      saveAgent(agent);
      this._emit('agent:updated', this._sanitize(agent));

      return { todoId, response };
    } catch (err) {
      // Mark as failed but don't mark done
      this._emit('agent:todo:error', { agentId, todoId, error: err.message });
      throw err;
    }
  }

  // Execute all pending todos sequentially
  async executeAllTodos(agentId, streamCallback) {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error('Agent not found');

    const pending = agent.todoList.filter(t => !t.done);
    if (pending.length === 0) throw new Error('No pending tasks');

    console.log(`▶️  Executing ${pending.length} pending todo(s) for ${agent.name}`);
    this._emit('agent:todo:executeAll:start', { agentId, count: pending.length });

    const results = [];
    for (const todo of pending) {
      try {
        const result = await this.executeTodo(agentId, todo.id, streamCallback);
        results.push({ todoId: todo.id, text: todo.text, success: true, response: result.response });
      } catch (err) {
        results.push({ todoId: todo.id, text: todo.text, success: false, error: err.message });
        // Continue with next todo
      }
    }

    this._emit('agent:todo:executeAll:complete', { agentId, results: results.map(r => ({ todoId: r.todoId, success: r.success })) });
    return results;
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

  // ─── Truncate Conversation (keep messages 0..afterIndex, remove the rest) ──
  truncateHistory(agentId, afterIndex) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const idx = parseInt(afterIndex, 10);
    if (isNaN(idx) || idx < 0) return null;
    // Keep messages from 0 to afterIndex (inclusive)
    agent.conversationHistory = agent.conversationHistory.slice(0, idx + 1);
    saveAgent(agent);
    this._emit('agent:updated', this._sanitize(agent));
    return agent.conversationHistory;
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  /**
   * Per-agent sequential task queue.
   * Tasks are added instantly (returns a Promise) but execute one at a time.
   * Multiple callers can enqueue concurrently — the queue serialises execution.
   */
  _enqueueAgentTask(agentId, taskFn) {
    if (!this._taskQueues.has(agentId)) {
      this._taskQueues.set(agentId, Promise.resolve());
    }

    // Chain the new task after whatever is currently running/queued
    const resultPromise = this._taskQueues.get(agentId).then(
      () => taskFn(),
      () => taskFn()   // If the previous task rejected, still run the next one
    );

    // Update the queue tail (ignore rejections so the chain never breaks)
    this._taskQueues.set(agentId, resultPromise.catch(() => {}));

    return resultPromise;
  }

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
