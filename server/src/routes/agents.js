import express from 'express';

export function agentRoutes(agentManager) {
  const router = express.Router();

  // List all agents
  router.get('/', (req, res) => {
    res.json(agentManager.getAll());
  });

  // Get single agent
  router.get('/:id', (req, res) => {
    const agent = agentManager.getById(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });

  // Create agent
  router.post('/', (req, res) => {
    try {
      const agent = agentManager.create(req.body);
      res.status(201).json(agent);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update agent
  router.put('/:id', (req, res) => {
    const agent = agentManager.update(req.params.id, req.body);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent);
  });

  // Delete agent
  router.delete('/:id', (req, res) => {
    const success = agentManager.delete(req.params.id);
    if (!success) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  });

  // Send message to agent
  router.post('/:id/chat', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });

      const response = await agentManager.sendMessage(req.params.id, message);
      res.json({ response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get conversation history
  router.get('/:id/history', (req, res) => {
    const agent = agentManager.agents.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json(agent.conversationHistory);
  });

  // Clear conversation history
  router.delete('/:id/history', (req, res) => {
    const success = agentManager.clearHistory(req.params.id);
    if (!success) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  });

  // Handoff between agents
  router.post('/:id/handoff', async (req, res) => {
    try {
      const { targetAgentId, context } = req.body;
      if (!targetAgentId || !context) {
        return res.status(400).json({ error: 'targetAgentId and context required' });
      }
      const response = await agentManager.handoff(req.params.id, targetAgentId, context);
      res.json({ response });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Broadcast message to all agents
  router.post('/broadcast/all', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message required' });

      const results = await agentManager.broadcastMessage(message);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Todo endpoints ──────────────────────────────────────────────────
  router.post('/:id/todos', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const todo = agentManager.addTodo(req.params.id, text);
    if (!todo) return res.status(404).json({ error: 'Agent not found' });
    res.status(201).json(todo);
  });

  router.patch('/:id/todos/:todoId', (req, res) => {
    const todo = agentManager.toggleTodo(req.params.id, req.params.todoId);
    if (!todo) return res.status(404).json({ error: 'Not found' });
    res.json(todo);
  });

  router.delete('/:id/todos/:todoId', (req, res) => {
    const success = agentManager.deleteTodo(req.params.id, req.params.todoId);
    if (!success) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  // ── RAG Document endpoints ─────────────────────────────────────────
  router.post('/:id/rag', (req, res) => {
    const { name, content } = req.body;
    if (!name || !content) return res.status(400).json({ error: 'Name and content required' });
    const doc = agentManager.addRagDocument(req.params.id, name, content);
    if (!doc) return res.status(404).json({ error: 'Agent not found' });
    res.status(201).json(doc);
  });

  router.delete('/:id/rag/:docId', (req, res) => {
    const success = agentManager.deleteRagDocument(req.params.id, req.params.docId);
    if (!success) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  return router;
}
