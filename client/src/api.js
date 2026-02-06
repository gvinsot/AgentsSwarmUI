const API_BASE = '/api';

function getHeaders() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function handleResponse(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login: (username, password) =>
    fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    }).then(handleResponse),

  verify: () =>
    fetch(`${API_BASE}/auth/verify`, { headers: getHeaders() }).then(handleResponse),

  // Agents
  getAgents: () =>
    fetch(`${API_BASE}/agents`, { headers: getHeaders() }).then(handleResponse),

  getAgent: (id) =>
    fetch(`${API_BASE}/agents/${id}`, { headers: getHeaders() }).then(handleResponse),

  createAgent: (config) =>
    fetch(`${API_BASE}/agents`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(config)
    }).then(handleResponse),

  updateAgent: (id, updates) =>
    fetch(`${API_BASE}/agents/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(updates)
    }).then(handleResponse),

  deleteAgent: (id) =>
    fetch(`${API_BASE}/agents/${id}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  chatAgent: (id, message) =>
    fetch(`${API_BASE}/agents/${id}/chat`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message })
    }).then(handleResponse),

  getHistory: (id) =>
    fetch(`${API_BASE}/agents/${id}/history`, { headers: getHeaders() }).then(handleResponse),

  clearHistory: (id) =>
    fetch(`${API_BASE}/agents/${id}/history`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  handoff: (fromId, targetAgentId, context) =>
    fetch(`${API_BASE}/agents/${fromId}/handoff`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ targetAgentId, context })
    }).then(handleResponse),

  broadcast: (message) =>
    fetch(`${API_BASE}/agents/broadcast/all`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ message })
    }).then(handleResponse),

  // Todos
  addTodo: (agentId, text) =>
    fetch(`${API_BASE}/agents/${agentId}/todos`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text })
    }).then(handleResponse),

  toggleTodo: (agentId, todoId) =>
    fetch(`${API_BASE}/agents/${agentId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: getHeaders()
    }).then(handleResponse),

  deleteTodo: (agentId, todoId) =>
    fetch(`${API_BASE}/agents/${agentId}/todos/${todoId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // RAG
  addRagDoc: (agentId, name, content) =>
    fetch(`${API_BASE}/agents/${agentId}/rag`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, content })
    }).then(handleResponse),

  deleteRagDoc: (agentId, docId) =>
    fetch(`${API_BASE}/agents/${agentId}/rag/${docId}`, {
      method: 'DELETE',
      headers: getHeaders()
    }).then(handleResponse),

  // Templates
  getTemplates: () =>
    fetch(`${API_BASE}/templates`, { headers: getHeaders() }).then(handleResponse),
};
