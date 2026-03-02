const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  verify: () => request('/auth/verify'),

  getAgents: () => request('/agents'),
  getTemplates: () => request('/templates'),
  getProjects: () => request('/projects'),

  getPlugins: () => request('/plugins'),
  getSkills: () => request('/plugins'),
  createPlugin: (payload) => request('/plugins', { method: 'POST', body: JSON.stringify(payload) }),
  updatePlugin: (id, payload) => request(`/plugins/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deletePlugin: (id) => request(`/plugins/${id}`, { method: 'DELETE' }),

  getMcpServers: () => request('/mcp'),
  createMcpServer: (payload) => request('/mcp', { method: 'POST', body: JSON.stringify(payload) }),
  updateMcpServer: (id, payload) => request(`/mcp/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteMcpServer: (id) => request(`/mcp/${id}`, { method: 'DELETE' }),
  attachMcpToPlugin: (pluginId, mcpId) => request(`/plugins/${pluginId}/mcps/${mcpId}`, { method: 'POST' }),
  detachMcpFromPlugin: (pluginId, mcpId) => request(`/plugins/${pluginId}/mcps/${mcpId}`, { method: 'DELETE' })
};