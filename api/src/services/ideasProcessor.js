import { globalTodoStore } from './globalTodoStore.js';
import { getSettings } from './configManager.js';

/**
 * Process a todo in "idea" status by using an agent's LLM provider
 * to improve its description, then move it to backlog.
 */
export async function processIdeaTodo(todo, agentManager, io) {
  try {
    const settings = await getSettings();
    const ideasAgentName = settings.ideasAgent;

    if (!ideasAgentName) {
      console.log(`💡 [Ideas] No ideas agent configured, skipping for "${todo.title}"`);
      return;
    }

    // Find agent by name
    const agent = Array.from(agentManager.agents.values()).find(
      a => (a.name || '').toLowerCase() === ideasAgentName.toLowerCase()
    );

    if (!agent) {
      console.log(`💡 [Ideas] Agent "${ideasAgentName}" not found, skipping for "${todo.title}"`);
      return;
    }

    const agentConfig = {
      provider: agent.provider,
      model: agent.model,
      apiKey: agent.apiKey,
      endpoint: agent.endpoint,
    };

    console.log(`💡 [Ideas] Processing idea "${todo.title}" with agent "${ideasAgentName}" (${agentConfig.provider}/${agentConfig.model})`);

    const prompt = `You are a task refinement assistant. Analyze the following task idea and improve its description to make it clear, actionable, and well-structured for a development team.

Task Title: ${todo.title}
${todo.description ? `Current Description: ${todo.description}` : 'No description provided.'}
${todo.project ? `Project: ${todo.project}` : ''}

Please provide an improved, detailed description that includes:
1. A clear summary of what needs to be done
2. Acceptance criteria or expected outcomes
3. Any technical considerations or approach suggestions

IMPORTANT: Reply ONLY with the improved description text. Do not include the title, headers, or any preamble.`;

    const { createLoggingProvider } = await import('./llmProviders.js');
    const provider = createLoggingProvider({ ...agentConfig, agentName: ideasAgentName });

    const response = await provider.chat([
      { role: 'system', content: 'You are a concise task refinement assistant. Improve task descriptions to be clear and actionable.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 1024, temperature: 0.7 });

    const improvedDescription = response.content?.trim();

    if (improvedDescription) {
      globalTodoStore.update(todo.id, {
        description: improvedDescription,
        status: 'backlog',
      });
      console.log(`💡 [Ideas] Improved and moved to backlog: "${todo.title}" (${todo.id})`);
    } else {
      globalTodoStore.update(todo.id, { status: 'backlog' });
      console.log(`💡 [Ideas] No improvement returned, moved to backlog as-is: "${todo.title}"`);
    }

    // Broadcast update
    if (io) io.emit('todos:updated', globalTodoStore.getAll());
  } catch (err) {
    console.error(`💡 [Ideas] Error processing "${todo.title}":`, err.message);
    // Move to backlog so it doesn't get stuck
    try {
      globalTodoStore.update(todo.id, { status: 'backlog' });
      if (io) io.emit('todos:updated', globalTodoStore.getAll());
    } catch (e) {
      console.error(`💡 [Ideas] Failed to save after error:`, e.message);
    }
  }
}