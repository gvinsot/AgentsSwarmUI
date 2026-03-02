const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function getToken() {
  return localStorage.getItem('token');
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

export const api = {
  auth: {
    login: (username, password) =>
      request('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
  },

  agents: {
    list: () => request('/agents'),
    create: (payload) => request('/agents', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/agents/${id}`, { method: 'DELETE' })
  },

  plugins: {
    list: () => request('/plugins'),
    get: (id) => request(`/plugins/${id}`),
    create: (payload) => request('/plugins', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/plugins/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/plugins/${id}`, { method: 'DELETE' }),
    getSettings: () => request('/plugins/settings'),
    saveSettings: (payload) => request('/plugins/settings', { method: 'PUT', body: JSON.stringify(payload) })
  },

  // Backward compatibility alias
  skills: {
    list: () => request('/plugins'),
    get: (id) => request(`/plugins/${id}`),
    create: (payload) => request('/plugins', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/plugins/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/plugins/${id}`, { method: 'DELETE' })
  },

  mcpServers: {
    list: () => request('/mcp-servers'),
    create: (payload) => request('/mcp-servers', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id, payload) => request(`/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
    remove: (id) => request(`/mcp-servers/${id}`, { method: 'DELETE' })
  }
};