import { getSettings } from './configManager.js';

/**
 * Process a todo via workflow auto-refine: send it as a message to the
 * configured agent so the refinement is visible in the agent's chat,
 * then move the todo to the target status with the improved description.
 */
export async function processIdeaTodo(todo, agentManager, io) {
  const targetStatus = todo._transition?.to || 'backlog';

  try {
    const settings = await getSettings();
    const ideasAgentName = settings.ideasAgent;

    // Find agent: prefer transition-level agent name, fall back to global setting
    const transitionAgentName = todo._transition?.agent;
    let refinementAgent = null;

    if (transitionAgentName) {
      refinementAgent = Array.from(agentManager.agents.values()).find(
        a => a.enabled !== false && (a.name || '').toLowerCase() === transitionAgentName.toLowerCase()
      );
    }
    if (!refinementAgent && ideasAgentName) {
      refinementAgent = Array.from(agentManager.agents.values()).find(
        a => a.enabled !== false && (a.name || '').toLowerCase() === ideasAgentName.toLowerCase()
      );
    }

    if (!refinementAgent) {
      console.log(`[Workflow] No agent found for auto-refine, moving to ${targetStatus} as-is`);
      agentManager.setTodoStatus(todo.agentId, todo.id, targetStatus, { skipAutoRefine: true });
      return;
    }

    const instructions = todo._transition?.instructions
      || 'Improve the task description with more details or adding relevant context. Keep it concise but informative.';

    const prompt = `Refine the following task idea into a clear, actionable task description for a development team.

Task: ${todo.text}
${todo.project ? `Project: ${todo.project}` : ''}

${instructions}

Reply ONLY with the improved description. No title, no headers, no preamble.`;

    console.log(`[Workflow] Refining "${todo.text}" via agent "${refinementAgent.name}" (${todo.status} -> ${targetStatus})`);

    let fullResponse = '';

    io.emit('agent:stream:start', {
      agentId: refinementAgent.id,
      agentName: refinementAgent.name,
      project: refinementAgent.project || null,
    });

    try {
      const result = await agentManager.sendMessage(
        refinementAgent.id,
        `[Auto-Refine] ${prompt}`,
        (chunk) => {
          fullResponse += chunk;
          io.emit('agent:stream:chunk', {
            agentId: refinementAgent.id,
            agentName: refinementAgent.name,
            project: refinementAgent.project || null,
            chunk,
          });
        }
      );

      const improved = (result?.content || fullResponse).trim();
      if (improved) {
        agentManager.updateTodoText(todo.agentId, todo.id, `${todo.text}\n\n---\n${improved}`);
      }
      agentManager.setTodoStatus(todo.agentId, todo.id, targetStatus, { skipAutoRefine: true });
      console.log(`[Workflow] Refined and moved to ${targetStatus}: "${todo.text}"`);
    } finally {
      io.emit('agent:stream:end', {
        agentId: refinementAgent.id,
        agentName: refinementAgent.name,
        project: refinementAgent.project || null,
      });
    }
  } catch (err) {
    console.error(`[Workflow] Error processing "${todo.text}":`, err.message);
    try {
      agentManager.setTodoStatus(todo.agentId, todo.id, targetStatus, { skipAutoRefine: true });
    } catch (e) {
      console.error(`[Workflow] Failed to move to ${targetStatus} after error:`, e.message);
    }
  }
}
