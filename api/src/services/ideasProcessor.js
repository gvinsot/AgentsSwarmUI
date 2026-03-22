import { getSettings } from './configManager.js';

/**
 * Process a todo in "idea" status: send it as a message to the configured
 * ideas-agent so the refinement is visible in the agent's chat, then move
 * the todo to backlog with the improved description.
 *
 * @param {object}       todo         The todo object (must have .id, .text, .agentId)
 * @param {AgentManager} agentManager The running AgentManager instance
 * @param {SocketIO}     io           Socket.IO server (for streaming to all clients)
 */
export async function processIdeaTodo(todo, agentManager, io) {
  try {
    const settings = await getSettings();
    const ideasAgentName = settings.ideasAgent;

    if (!ideasAgentName) {
      // No agent configured — silently move to backlog
      agentManager.setTodoStatus(todo.agentId, todo.id, 'backlog');
      return;
    }

    // Find the ideas-refinement agent by name
    const ideasAgent = Array.from(agentManager.agents.values()).find(
      a => (a.name || '').toLowerCase() === ideasAgentName.toLowerCase()
    );

    if (!ideasAgent) {
      console.log(`[Ideas] Agent "${ideasAgentName}" not found, moving to backlog as-is`);
      agentManager.setTodoStatus(todo.agentId, todo.id, 'backlog');
      return;
    }

    const prompt = `Refine the following task idea into a clear, actionable task description for a development team.

Task: ${todo.text}
${todo.project ? `Project: ${todo.project}` : ''}

Improve the task description with more details or adding relevant context and additionnal related ideas that can improve the product without too much effort. 
Keep it concise but informative.

Reply ONLY with the improved description. No title, no headers, no preamble.`;

    console.log(`[Ideas] Refining "${todo.text}" via agent "${ideasAgent.name}"`);

    // Stream the refinement through the ideas agent's chat so it's visible in the UI
    let fullResponse = '';

    io.emit('agent:stream:start', {
      agentId: ideasAgent.id,
      agentName: ideasAgent.name,
      project: ideasAgent.project || null,
    });

    try {
      const result = await agentManager.sendMessage(
        ideasAgent.id,
        `[Idea Refinement] ${prompt}`,
        (chunk) => {
          fullResponse += chunk;
          io.emit('agent:stream:chunk', {
            agentId: ideasAgent.id,
            agentName: ideasAgent.name,
            project: ideasAgent.project || null,
            chunk,
          });
        }
      );

      const improved = (result?.content || fullResponse).trim();

      if (improved) {
        // Update todo text with the refined description and move to backlog
        agentManager.updateTodoText(todo.agentId, todo.id, `${todo.text}\n\n---\n${improved}`);
      }
      agentManager.setTodoStatus(todo.agentId, todo.id, 'backlog');
      console.log(`[Ideas] Refined and moved to backlog: "${todo.text}"`);
    } finally {
      io.emit('agent:stream:end', {
        agentId: ideasAgent.id,
        agentName: ideasAgent.name,
        project: ideasAgent.project || null,
      });
    }
  } catch (err) {
    console.error(`[Ideas] Error processing "${todo.text}":`, err.message);
    // Move to backlog so it doesn't get stuck
    try {
      agentManager.setTodoStatus(todo.agentId, todo.id, 'backlog');
    } catch (e) {
      console.error(`[Ideas] Failed to move to backlog after error:`, e.message);
    }
  }
}
