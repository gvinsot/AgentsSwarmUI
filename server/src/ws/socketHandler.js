export function setupSocketHandlers(io, agentManager) {
  io.on('connection', (socket) => {
    console.log(`⚡ Client connected: ${socket.user?.username}`);

    // Send initial state
    socket.emit('agents:list', agentManager.getAll());

    // ── Chat with streaming ───────────────────────────────────────────
    socket.on('agent:chat', async (data) => {
      const { agentId, message } = data;
      if (!agentId || !message) return;

      try {
        socket.emit('agent:stream:start', { agentId });

        await agentManager.sendMessage(agentId, message, (chunk) => {
          socket.emit('agent:stream:chunk', { agentId, chunk });
          // Also broadcast the thinking state to all clients
          io.emit('agent:thinking', {
            agentId,
            thinking: agentManager.agents.get(agentId)?.currentThinking || ''
          });
        });

        socket.emit('agent:stream:end', { agentId });
        // Send updated agent with metrics
        const agent = agentManager.getById(agentId);
        if (agent) io.emit('agent:updated', agent);
      } catch (err) {
        socket.emit('agent:stream:error', { agentId, error: err.message });
      }
    });

    // ── Broadcast to all agents (tmux) ────────────────────────────────
    socket.on('broadcast:message', async (data) => {
      const { message } = data;
      if (!message) return;

      socket.emit('broadcast:start', { message });

      try {
        const results = await agentManager.broadcastMessage(
          message,
          (agentId, chunk) => {
            socket.emit('agent:stream:chunk', { agentId, chunk });
            io.emit('agent:thinking', {
              agentId,
              thinking: agentManager.agents.get(agentId)?.currentThinking || ''
            });
          }
        );

        socket.emit('broadcast:complete', { results });
      } catch (err) {
        socket.emit('broadcast:error', { error: err.message });
      }
    });

    // ── Handoff ───────────────────────────────────────────────────────
    socket.on('agent:handoff', async (data) => {
      const { fromId, toId, context } = data;
      if (!fromId || !toId || !context) return;

      try {
        const response = await agentManager.handoff(fromId, toId, context);
        socket.emit('agent:handoff:complete', { fromId, toId, response });
      } catch (err) {
        socket.emit('agent:handoff:error', { error: err.message });
      }
    });

    // ── Ping agent status ─────────────────────────────────────────────
    socket.on('agents:refresh', () => {
      socket.emit('agents:list', agentManager.getAll());
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Client disconnected: ${socket.user?.username}`);
    });
  });
}
