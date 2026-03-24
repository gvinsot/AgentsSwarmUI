import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchGlobalTodos, updateGlobalTodo, addGlobalTodo, deleteGlobalTodo, fetchProjects } from '../api';
import { useWebSocket } from '../contexts/WebSocketContext';

export default function Dashboard({ agents, swarmConfig }) {
  const [todos, setTodos] = useState([]);
  const [projects, setProjects] = useState([]);
  const [newTodo, setNewTodo] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [showHello, setShowHello] = useState(false);
  const { lastMessage } = useWebSocket();

  const activeAgents = agents.filter(a => a.status === 'busy' || a.status === 'idle');
  const busyAgents = agents.filter(a => a.status === 'busy');

  useEffect(() => {
    fetchGlobalTodos().then(setTodos);
    fetchProjects().then(setProjects);
  }, []);

  useEffect(() => {
    if (!lastMessage) return;
    if (['todos-updated', 'todo-added', 'todo-updated', 'todo-deleted'].includes(lastMessage.type)) {
      fetchGlobalTodos().then(setTodos);
    }
  }, [lastMessage]);

  const handleAddTodo = async (e) => {
    e.preventDefault();
    if (!newTodo.trim()) return;
    await addGlobalTodo(newTodo, selectedProject || undefined);
    setNewTodo('');
    fetchGlobalTodos().then(setTodos);
  };

  const handleToggle = async (todo) => {
    await updateGlobalTodo(todo.id, { status: todo.status === 'done' ? 'pending' : 'done' });
    fetchGlobalTodos().then(setTodos);
  };

  const handleDelete = async (todoId) => {
    await deleteGlobalTodo(todoId);
    fetchGlobalTodos().then(setTodos);
  };

  const pendingTodos = todos.filter(t => t.status !== 'done');
  const doneTodos = todos.filter(t => t.status === 'done');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-400">Total Agents</div>
          <div className="text-2xl font-bold">{agents.length}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-400">Active</div>
          <div className="text-2xl font-bold text-green-400">{activeAgents.length}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-400">Busy</div>
          <div className="text-2xl font-bold text-yellow-400">{busyAgents.length}</div>
        </div>
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <div className="text-sm text-gray-400">Swarm Mode</div>
          <div className="text-2xl font-bold text-purple-400">{swarmConfig?.enabled ? 'ON' : 'OFF'}</div>
        </div>
      </div>

      {/* Hello Button */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowHello(!showHello)}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium"
          >
            {showHello ? 'Hide' : 'Say Hello'}
          </button>
          {showHello && <span className="text-xl font-semibold text-green-400">hello</span>}
        </div>
      </div>

      {/* Global Todo List */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6 mb-8">
        <h2 className="text-xl font-semibold mb-4">📋 Global Tasks</h2>

        <form onSubmit={handleAddTodo} className="flex gap-2 mb-4">
          <input
            type="text"
            value={newTodo}
            onChange={e => setNewTodo(e.target.value)}
            placeholder="Add a new task..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
          />
          {projects.length > 0 && (
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm"
            >
              <option value="">No project</option>
              {projects.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium">
            Add
          </button>
        </form>

        {pendingTodos.length === 0 && doneTodos.length === 0 && (
          <p className="text-gray-500 text-sm">No tasks yet</p>
        )}

        {pendingTodos.map(todo => (
          <div key={todo.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
            <button onClick={() => handleToggle(todo)} className="text-gray-500 hover:text-green-400">
              ○
            </button>
            <span className="flex-1 text-sm">{todo.text}</span>
            {todo.project && (
              <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">{todo.project}</span>
            )}
            {todo.source && (
              <span className="text-xs bg-gray-800 text-blue-400 px-2 py-1 rounded">{todo.source}</span>
            )}
            <span className={`text-xs px-2 py-1 rounded ${
              todo.status === 'in_progress' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-800 text-gray-400'
            }`}>
              {todo.status}
            </span>
            <button onClick={() => handleDelete(todo.id)} className="text-gray-600 hover:text-red-400 text-sm">✕</button>
          </div>
        ))}

        {doneTodos.length > 0 && (
          <div className="mt-4">
            <div className="text-sm text-gray-500 mb-2">Completed ({doneTodos.length})</div>
            {doneTodos.map(todo => (
              <div key={todo.id} className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0 opacity-50">
                <button onClick={() => handleToggle(todo)} className="text-green-400">✓</button>
                <span className="flex-1 text-sm line-through">{todo.text}</span>
                {todo.project && (
                  <span className="text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded">{todo.project}</span>
                )}
                <button onClick={() => handleDelete(todo.id)} className="text-gray-600 hover:text-red-400 text-sm">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agent List */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-xl font-semibold mb-4">🤖 Agents</h2>
        {agents.length === 0 ? (
          <p className="text-gray-500 text-sm">No agents registered</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <Link key={agent.id} to={`/agent/${agent.id}`} className="block bg-gray-800 rounded-lg p-4 hover:bg-gray-750 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{agent.name}</span>
                  <span className={`text-xs px-2 py-1 rounded ${
                    agent.status === 'busy' ? 'bg-yellow-900 text-yellow-300' :
                    agent.status === 'idle' ? 'bg-green-900 text-green-300' :
                    'bg-gray-700 text-gray-400'
                  }`}>
                    {agent.status}
                  </span>
                </div>
                {agent.currentTask && (
                  <p className="text-sm text-gray-400 truncate">{agent.currentTask}</p>
                )}
                {agent.project && (
                  <p className="text-xs text-gray-500 mt-1">📁 {agent.project}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}