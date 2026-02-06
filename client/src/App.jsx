import { useState, useEffect, useCallback } from 'react';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import { api } from './api';
import LoginPage from './components/LoginPage';
import Dashboard from './components/Dashboard';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [thinkingMap, setThinkingMap] = useState({});
  const [streamBuffers, setStreamBuffers] = useState({});

  // Check existing token on mount
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      api.verify()
        .then((data) => {
          setUser(data.user);
          initSocket(token);
          loadData();
        })
        .catch(() => {
          localStorage.removeItem('token');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [agentsData, templatesData] = await Promise.all([
        api.getAgents(),
        api.getTemplates()
      ]);
      setAgents(agentsData);
      setTemplates(templatesData);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
  }, []);

  const initSocket = useCallback((token) => {
    const sock = connectSocket(token);

    sock.on('agents:list', (list) => setAgents(list));

    sock.on('agent:created', (agent) => {
      setAgents(prev => [...prev, agent]);
    });

    sock.on('agent:updated', (agent) => {
      setAgents(prev => prev.map(a => a.id === agent.id ? agent : a));
    });

    sock.on('agent:deleted', ({ id }) => {
      setAgents(prev => prev.filter(a => a.id !== id));
    });

    sock.on('agent:status', ({ id, status }) => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    });

    sock.on('agent:thinking', ({ agentId, thinking }) => {
      setThinkingMap(prev => ({ ...prev, [agentId]: thinking }));
    });

    sock.on('agent:stream:start', ({ agentId }) => {
      setStreamBuffers(prev => ({ ...prev, [agentId]: '' }));
    });

    sock.on('agent:stream:chunk', ({ agentId, chunk }) => {
      setStreamBuffers(prev => ({
        ...prev,
        [agentId]: (prev[agentId] || '') + chunk
      }));
    });

    sock.on('agent:stream:end', ({ agentId }) => {
      setStreamBuffers(prev => {
        const copy = { ...prev };
        delete copy[agentId];
        return copy;
      });
      setThinkingMap(prev => {
        const copy = { ...prev };
        delete copy[agentId];
        return copy;
      });
      // Refresh agent data
      loadData();
    });

    sock.on('agent:stream:error', ({ agentId, error }) => {
      console.error(`Stream error for ${agentId}:`, error);
      setStreamBuffers(prev => {
        const copy = { ...prev };
        delete copy[agentId];
        return copy;
      });
    });

    sock.on('agent:handoff', (data) => {
      console.log('Handoff:', data);
    });
  }, [loadData]);

  const handleLogin = async (username, password) => {
    const data = await api.login(username, password);
    localStorage.setItem('token', data.token);
    setUser({ username: data.username, role: data.role });
    initSocket(data.token);
    await loadData();
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    disconnectSocket();
    setUser(null);
    setAgents([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-dark-300 text-sm">Loading Agent Swarm...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <Dashboard
      user={user}
      agents={agents}
      templates={templates}
      thinkingMap={thinkingMap}
      streamBuffers={streamBuffers}
      onLogout={handleLogout}
      onRefresh={loadData}
      socket={getSocket()}
    />
  );
}
