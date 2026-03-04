import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Globe, Send, Loader2, FolderOpen, ChevronDown, StopCircle, Wrench, Plus, Pencil, Trash2, Check, Zap, MessageSquareOff, ScrollText, Plug, RefreshCw, ListX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { cleanToolSyntax } from './AgentDetail';
import { api } from '../api';

const STATUS_STYLES = {
  pending: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  in_progress: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  failed: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const STATUS_ICONS = {
  pending: Clock3,
  in_progress: Loader2,
  completed: CheckCircle2,
  failed: AlertTriangle,
};

function ConfirmDialog({ open, title, description, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-dark-600 bg-dark-800 p-4 shadow-2xl">
        <h4 className="text-base font-semibold text-dark-100">{title}</h4>
        <p className="mt-2 text-sm text-dark-300">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-dark-600 px-3 py-1.5 text-sm text-dark-200 hover:bg-dark-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, variant = 'default', disabled = false }) {
  const base = 'inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed';
  const styles =
    variant === 'danger'
      ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
      : 'border-dark-600 bg-dark-700/60 text-dark-100 hover:bg-dark-700';

  return (
    <button className={`${base} ${styles}`} onClick={onClick} disabled={disabled}>
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export default function BroadcastPanel() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [confirmState, setConfirmState] = useState({ open: false, action: null });

  const pollRef = useRef(null);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const data = await apiService.getTasks();
      setTasks(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch tasks', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  useEffect(() => {
    if (running) {
      pollRef.current = setInterval(fetchTasks, 2000);
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [running]);

  const groupedCounts = useMemo(() => {
    return tasks.reduce(
      (acc, t) => {
        const s = t.status || 'pending';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      },
      { pending: 0, in_progress: 0, completed: 0, failed: 0 }
    );
  }, [tasks]);

  const openConfirm = (action) => setConfirmState({ open: true, action });
  const closeConfirm = () => setConfirmState({ open: false, action: null });

  const clearCompleted = async () => {
    await apiService.clearTasksByStatus('completed');
    await fetchTasks();
  };

  const clearFailed = async () => {
    await apiService.clearTasksByStatus('failed');
    await fetchTasks();
  };

  const clearInProgress = async () => {
    await apiService.clearTasksByStatus('in_progress');
    await fetchTasks();
  };

  const confirmConfig = {
    clearCompleted: {
      title: 'Clear completed tasks?',
      description: 'This will remove all completed tasks from the list.',
      run: clearCompleted,
    },
    clearFailed: {
      title: 'Clear failed tasks?',
      description: 'This will remove all failed tasks from the list.',
      run: clearFailed,
    },
    clearInProgress: {
      title: 'Clear in-progress tasks?',
      description: 'This will remove all tasks currently in progress from the list.',
      run: clearInProgress,
    },
  };

  const currentConfirm = confirmState.action ? confirmConfig[confirmState.action] : null;

  const handleCreate = async () => {
    if (!newPlugin.name.trim() || !newPlugin.instructions.trim()) return;
    try {
      await api.createPlugin(newPlugin);
      setNewPlugin({ name: '', description: '', category: 'coding', icon: '🔧', instructions: '', mcpServerIds: [] });
      setShowCreate(false);
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to create plugin:', err); }
  };

  const toggleMcpInEdit = (mcpId) => {
    setEditForm(f => ({
      ...f,
      mcpServerIds: f.mcpServerIds.includes(mcpId)
        ? f.mcpServerIds.filter(id => id !== mcpId)
        : [...f.mcpServerIds, mcpId]
    }));
  };

  const toggleMcpInCreate = (mcpId) => {
    setNewPlugin(p => ({
      ...p,
      mcpServerIds: p.mcpServerIds.includes(mcpId)
        ? p.mcpServerIds.filter(id => id !== mcpId)
        : [...p.mcpServerIds, mcpId]
    }));
  };

  // ── MCP handlers ──────────────────────────────────────────────────

  const [showMcpCreate, setShowMcpCreate] = useState(false);
  const [newMcp, setNewMcp] = useState({ name: '', url: '', description: '', icon: '🔌', apiKey: '' });
  const [editingMcp, setEditingMcp] = useState(null);
  const [editMcpForm, setEditMcpForm] = useState({ name: '', url: '', description: '', icon: '', apiKey: '' });
  const [connectingMcp, setConnectingMcp] = useState(null);

  const handleCreateMcp = async () => {
    if (!newMcp.name.trim() || !newMcp.url.trim()) return;
    try {
      await api.createMcpServer(newMcp);
      setNewMcp({ name: '', url: '', description: '', icon: '🔌', apiKey: '' });
      setShowMcpCreate(false);
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to create MCP server:', err); }
  };

  const startMcpEdit = (server) => {
    setEditingMcp(server.id);
    setEditMcpForm({ name: server.name, url: server.url, description: server.description || '', icon: server.icon || '🔌', apiKey: '' });
    // apiKey starts empty in edit form — user types new key to change, leave blank to keep existing
  };

  const saveMcpEdit = async () => {
    if (!editingMcp || !editMcpForm.name.trim() || !editMcpForm.url.trim()) return;
    try {
      const payload = { ...editMcpForm };
      // Only send apiKey if user typed a new one (blank = keep existing)
      if (!payload.apiKey) delete payload.apiKey;
      await api.updateMcpServer(editingMcp, payload);
      setEditingMcp(null);
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to update MCP server:', err); }
  };

  const handleDeleteMcp = async (id) => {
    try {
      await api.deleteMcpServer(id);
      if (editingMcp === id) setEditingMcp(null);
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to delete MCP server:', err); }
  };

  const handleConnectMcp = async (id) => {
    setConnectingMcp(id);
    try {
      await api.connectMcpServer(id);
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to connect MCP server:', err); }
    finally { setConnectingMcp(null); }
  };

  // ── Actions handlers ────────────────────────────────────────────────

  const handleClearAllChats = useCallback(async () => {
    if (!agents.length) return;
    try {
      await Promise.all(agents.map(a => api.clearHistory(a.id)));
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to clear chats:', err); }
  }, [agents, onRefresh]);

  const handleClearAllActionLogs = useCallback(async () => {
    if (!agents.length) return;
    try {
      await Promise.all(agents.map(a => api.clearActionLogs(a.id)));
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to clear action logs:', err); }
  }, [agents, onRefresh]);

  const handleClearAllInProgressTasks = useCallback(async () => {
    if (!agents.length) return;
    try {
      await Promise.all(agents.map(a => api.clearTasksByStatus?.(a.id, 'in_progress')));
      if (onRefresh) onRefresh();
    } catch (err) { console.error('Failed to clear in-progress tasks:', err); }
  }, [agents, onRefresh]);

  const handleStopAll = useCallback(() => {
    if (!socket) return;
    agents.filter(a => a.status === 'busy').forEach(a => socket.emit('agent:stop', { agentId: a.id }));
  }, [agents, socket]);

  const currentProject = agents.length > 0 ? agents[0].project : null;
  const busyCount = agents.filter(a => a.status === 'busy').length;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-900/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-dark-100 text-sm">Control Panel</h3>
        <div className="flex items-center gap-2">
          <ActionButton icon={RefreshCw} label="Refresh" onClick={fetchTasks} disabled={loading} />
          {!running ? (
            <ActionButton icon={Play} label="Start" onClick={() => setRunning(true)} />
          ) : (
            <ActionButton icon={Square} label="Stop" onClick={() => setRunning(false)} />
          )}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {Object.entries(groupedCounts).map(([status, count]) => {
          const Icon = STATUS_ICONS[status] || Clock3;
          const spin = status === 'in_progress' ? 'animate-spin' : '';
          return (
            <div key={status} className={`rounded-lg border px-3 py-2 text-xs ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
              <div className="flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${spin}`} />
                <span className="capitalize">{status.replace('_', ' ')}</span>
              </div>
              <div className="mt-1 text-base font-semibold">{count}</div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <h4 className="text-xs uppercase tracking-wide text-dark-400">Actions</h4>
        <div className="flex flex-wrap gap-2">
          <ActionButton icon={Trash2} label="Clear Completed" variant="danger" onClick={() => openConfirm('clearCompleted')} />
          <ActionButton icon={Trash2} label="Clear Failed" variant="danger" onClick={() => openConfirm('clearFailed')} />
          <ActionButton icon={Trash2} label="Clear In Progress" variant="danger" onClick={() => openConfirm('clearInProgress')} />
        </div>
      </div>

      <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-dark-700">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-dark-800">
            <tr className="text-dark-300">
              <th className="px-3 py-2 font-medium">Task</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const status = task.status || 'pending';
              const Icon = STATUS_ICONS[status] || Clock3;
              return (
                <tr key={task.id} className="border-t border-dark-700/80">
                  <td className="px-3 py-2 text-dark-100">{task.title || task.id}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>
                      <Icon className={`h-3 w-3 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
                      {status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {tasks.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-dark-400">
                  <div className="inline-flex items-center gap-2">
                    <Radio className="h-4 w-4" />
                    No tasks
                  </div>
                  <input type="text" value={newMcp.url} onChange={(e) => setNewMcp(s => ({ ...s, url: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-emerald-500 font-mono" placeholder="http://host:port/path" />
                  <input type="text" value={newMcp.description} onChange={(e) => setNewMcp(s => ({ ...s, description: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-emerald-500" placeholder="Short description" />
                  <input type="password" value={newMcp.apiKey} onChange={(e) => setNewMcp(s => ({ ...s, apiKey: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-emerald-500 font-mono" placeholder="API Key (optional)" autoComplete="off" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowMcpCreate(false)} className="px-3 py-1.5 text-dark-400 hover:text-dark-200 text-sm">Cancel</button>
                    <button onClick={handleCreateMcp} disabled={!newMcp.name.trim() || !newMcp.url.trim()} className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-40">Create</button>
                  </div>
                </div>
              )}

              {/* Create plugin form */}
              {showCreate && (
                <div className="p-3 bg-dark-800/50 rounded-lg border border-indigo-500/30 space-y-2 flex-shrink-0 animate-fadeIn">
                  <div className="flex gap-2">
                    <input type="text" value={newPlugin.icon} onChange={(e) => setNewPlugin(s => ({ ...s, icon: e.target.value }))} className="w-12 px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-center focus:outline-none focus:border-indigo-500" placeholder="🔧" />
                    <input type="text" value={newPlugin.name} onChange={(e) => setNewPlugin(s => ({ ...s, name: e.target.value }))} className="flex-1 px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500" placeholder="Plugin name" />
                    <select value={newPlugin.category} onChange={(e) => setNewPlugin(s => ({ ...s, category: e.target.value }))} className="px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-indigo-500">
                      <option value="coding">coding</option>
                      <option value="devops">devops</option>
                      <option value="writing">writing</option>
                      <option value="security">security</option>
                      <option value="analysis">analysis</option>
                      <option value="general">general</option>
                    </select>
                  </div>
                  <input type="text" value={newPlugin.description} onChange={(e) => setNewPlugin(s => ({ ...s, description: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500" placeholder="Short description" />
                  <textarea value={newPlugin.instructions} onChange={(e) => setNewPlugin(s => ({ ...s, instructions: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500 font-mono resize-none" placeholder="Plugin instructions (injected into agent prompt)..." rows={4} />
                  {/* MCP server association */}
                  {mcpServers.length > 0 && (
                    <div>
                      <p className="text-xs text-dark-400 mb-1.5 flex items-center gap-1"><Plug className="w-3 h-3" /> Associated MCP Servers</p>
                      <div className="space-y-1">
                        {mcpServers.map(server => (
                          <label key={server.id} className="flex items-center gap-2 px-2 py-1.5 bg-dark-800/30 rounded border border-dark-700/30 cursor-pointer hover:border-dark-600 transition-colors">
                            <input type="checkbox" checked={newPlugin.mcpServerIds.includes(server.id)} onChange={() => toggleMcpInCreate(server.id)} className="rounded border-dark-600 bg-dark-800 text-emerald-500 focus:ring-emerald-500/30" />
                            <span className="text-xs flex-shrink-0">{server.icon || '🔌'}</span>
                            <span className="text-xs text-dark-300">{server.name}</span>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[server.status] || statusColors.disconnected}`} />
                            <span className="text-[10px] text-dark-500 ml-auto">{server.tools?.length || 0} tools</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-dark-400 hover:text-dark-200 text-sm">Cancel</button>
                    <button onClick={handleCreate} disabled={!newPlugin.name.trim() || !newPlugin.instructions.trim()} className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-40">Create</button>
                  </div>
                </div>
              )}

              {/* Plugins list (scrollable) */}
              <div className="flex-1 overflow-auto min-h-0 space-y-1.5">
                {skills.map(plugin => (
                  <div key={plugin.id}>
                    {editingPlugin === plugin.id ? (
                      <div className="p-3 bg-dark-800/50 rounded-lg border border-indigo-500/30 space-y-2 animate-fadeIn">
                        <div className="flex gap-2">
                          <input type="text" value={editForm.icon} onChange={(e) => setEditForm(f => ({ ...f, icon: e.target.value }))} className="w-12 px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-center focus:outline-none focus:border-indigo-500" />
                          <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className="flex-1 px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500" />
                          <select value={editForm.category} onChange={(e) => setEditForm(f => ({ ...f, category: e.target.value }))} className="px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-indigo-500">
                            <option value="coding">coding</option>
                            <option value="devops">devops</option>
                            <option value="writing">writing</option>
                            <option value="security">security</option>
                            <option value="analysis">analysis</option>
                            <option value="general">general</option>
                          </select>
                        </div>
                        <input type="text" value={editForm.description} onChange={(e) => setEditForm(f => ({ ...f, description: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500" placeholder="Short description" />
                        <textarea value={editForm.instructions} onChange={(e) => setEditForm(f => ({ ...f, instructions: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500 font-mono resize-none" placeholder="Plugin instructions..." rows={5} />
                        {/* MCP server association */}
                        {mcpServers.length > 0 && (
                          <div>
                            <p className="text-xs text-dark-400 mb-1.5 flex items-center gap-1"><Plug className="w-3 h-3" /> Associated MCP Servers</p>
                            <div className="space-y-1">
                              {mcpServers.map(server => (
                                <label key={server.id} className="flex items-center gap-2 px-2 py-1.5 bg-dark-800/30 rounded border border-dark-700/30 cursor-pointer hover:border-dark-600 transition-colors">
                                  <input type="checkbox" checked={editForm.mcpServerIds.includes(server.id)} onChange={() => toggleMcpInEdit(server.id)} className="rounded border-dark-600 bg-dark-800 text-emerald-500 focus:ring-emerald-500/30" />
                                  <span className="text-xs flex-shrink-0">{server.icon || '🔌'}</span>
                                  <span className="text-xs text-dark-300">{server.name}</span>
                                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[server.status] || statusColors.disconnected}`} />
                                  <span className="text-[10px] text-dark-500 ml-auto">{server.tools?.length || 0} tools</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2 justify-end">
                          <button onClick={cancelEdit} className="px-3 py-1.5 text-dark-400 hover:text-dark-200 text-sm">Cancel</button>
                          <button onClick={saveEdit} disabled={!editForm.name.trim() || !editForm.instructions.trim()} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-40">
                            <Check className="w-3.5 h-3.5" /> Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-2.5 bg-dark-800/30 rounded-lg border border-dark-700/30 hover:border-dark-600 transition-colors group">
                        <span className="text-base flex-shrink-0">{plugin.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-dark-200">{plugin.name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getCategoryClass(plugin.category)}`}>
                              {plugin.category}
                            </span>
                            {plugin.builtin && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-dark-700 text-dark-400 border border-dark-600">builtin</span>
                            )}
                            {(plugin.mcpServerIds || []).length > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                                {plugin.mcpServerIds.length} MCP
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-dark-500 truncate">{plugin.description}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => startEdit(plugin)} className="p-1.5 text-dark-400 hover:text-indigo-400 rounded-md hover:bg-dark-700 transition-colors" title="Edit plugin">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => handleDelete(plugin.id)} className="p-1.5 text-dark-400 hover:text-red-400 rounded-md hover:bg-dark-700 transition-colors" title="Delete plugin">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {skills.length === 0 && (
                  <p className="text-center text-dark-500 text-xs py-8">No plugins created yet</p>
                )}

                {/* MCP Servers section */}
                {mcpServers.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-dark-700/50">
                    <p className="text-xs font-medium text-dark-400 mb-2 flex items-center gap-1.5">
                      <Plug className="w-3.5 h-3.5 text-emerald-400" />
                      MCP Servers ({mcpServers.length})
                    </p>
                    <div className="space-y-1.5">
                      {mcpServers.map(server => (
                        <div key={server.id}>
                          {editingMcp === server.id ? (
                            <div className="p-3 bg-dark-800/50 rounded-lg border border-emerald-500/30 space-y-2 animate-fadeIn">
                              <div className="flex gap-2">
                                <input type="text" value={editMcpForm.icon} onChange={(e) => setEditMcpForm(f => ({ ...f, icon: e.target.value }))} className="w-12 px-2 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-center focus:outline-none focus:border-emerald-500" />
                                <input type="text" value={editMcpForm.name} onChange={(e) => setEditMcpForm(f => ({ ...f, name: e.target.value }))} className="flex-1 px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-emerald-500" />
                              </div>
                              <input type="text" value={editMcpForm.url} onChange={(e) => setEditMcpForm(f => ({ ...f, url: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 font-mono focus:outline-none focus:border-emerald-500" placeholder="http://host:port/path" />
                              <input type="text" value={editMcpForm.description} onChange={(e) => setEditMcpForm(f => ({ ...f, description: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-emerald-500" placeholder="Short description" />
                              <input type="password" value={editMcpForm.apiKey} onChange={(e) => setEditMcpForm(f => ({ ...f, apiKey: e.target.value }))} className="w-full px-3 py-1.5 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-emerald-500 font-mono" placeholder={server.hasApiKey ? 'Leave blank to keep, or type new key' : 'API Key (optional)'} autoComplete="off" />
                              <div className="flex gap-2 justify-end">
                                <button onClick={() => setEditingMcp(null)} className="px-3 py-1.5 text-dark-400 hover:text-dark-200 text-sm">Cancel</button>
                                <button onClick={saveMcpEdit} disabled={!editMcpForm.name.trim() || !editMcpForm.url.trim()} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm disabled:opacity-40">
                                  <Check className="w-3.5 h-3.5" /> Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="p-2 bg-dark-800/20 rounded-lg border border-dark-700/20 hover:border-dark-600 transition-colors group">
                              <div className="flex items-center gap-2">
                                <span className="text-sm flex-shrink-0">{server.icon || '🔌'}</span>
                                <span className="text-xs font-medium text-dark-300">{server.name}</span>
                                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusColors[server.status] || statusColors.disconnected}`} />
                                <span className="text-[10px] text-dark-500">{server.status}</span>
                                <span className="text-[10px] text-dark-500 ml-auto">{server.tools?.length || 0} tools</span>
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleConnectMcp(server.id)} disabled={connectingMcp === server.id} className="p-1 text-dark-400 hover:text-emerald-400 rounded transition-colors" title="Reconnect">
                                    <RefreshCw className={`w-3 h-3 ${connectingMcp === server.id ? 'animate-spin' : ''}`} />
                                  </button>
                                  <button onClick={() => startMcpEdit(server)} className="p-1 text-dark-400 hover:text-emerald-400 rounded transition-colors" title="Edit">
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button onClick={() => handleDeleteMcp(server.id)} className="p-1 text-dark-400 hover:text-red-400 rounded transition-colors" title="Delete">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── ACTIONS TAB ────────────────────────────────────── */}
          {tab === 'actions' && (
            <div className="flex-1 p-5 space-y-3 overflow-auto">
              <p className="text-xs text-dark-400 mb-1">Bulk actions applied to all {agents.length} agents</p>

              <div className="space-y-2">
                {/* Clear All Chats */}
                <div className="p-4 bg-dark-800/30 rounded-xl border border-dark-700/30 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <MessageSquareOff className="w-4 h-4 text-dark-300" />
                      <span className="text-sm font-medium text-dark-200">Clear All Chats</span>
                    </div>
                    <p className="text-xs text-dark-500">Delete conversation history for every agent</p>
                  </div>
                  <ConfirmButton
                    onConfirm={handleClearAllChats}
                    disabled={agents.length === 0}
                    icon={MessageSquareOff}
                    label="Clear"
                    confirmLabel="Confirm?"
                    className="flex items-center gap-1.5 px-4 py-2 bg-dark-700 text-dark-300 hover:text-dark-100 hover:bg-dark-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 flex-shrink-0"
                    confirmClassName="flex items-center gap-1.5 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors text-sm font-medium flex-shrink-0 animate-pulse"
                  />
                </div>

                {/* Clear All Action Logs */}
                <div className="p-4 bg-dark-800/30 rounded-xl border border-dark-700/30 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <ScrollText className="w-4 h-4 text-dark-300" />
                      <span className="text-sm font-medium text-dark-200">Clear All Logs</span>
                    </div>
                    <p className="text-xs text-dark-500">Delete action logs for every agent</p>
                  </div>
                  <ConfirmButton
                    onConfirm={handleClearAllActionLogs}
                    disabled={agents.length === 0}
                    icon={ScrollText}
                    label="Clear"
                    confirmLabel="Confirm?"
                    className="flex items-center gap-1.5 px-4 py-2 bg-dark-700 text-dark-300 hover:text-dark-100 hover:bg-dark-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 flex-shrink-0"
                    confirmClassName="flex items-center gap-1.5 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors text-sm font-medium flex-shrink-0 animate-pulse"
                  />
                </div>

                {/* Clear In-Progress Tasks */}
                <div className="p-4 bg-dark-800/30 rounded-xl border border-dark-700/30 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <ListX className="w-4 h-4 text-dark-300" />
                      <span className="text-sm font-medium text-dark-200">Clear In-Progress Tasks</span>
                    </div>
                    <p className="text-xs text-dark-500">Remove in-progress tasks for every agent</p>
                  </div>
                  <ConfirmButton
                    onConfirm={handleClearAllInProgressTasks}
                    disabled={agents.length === 0}
                    icon={ListX}
                    label="Clear"
                    confirmLabel="Confirm?"
                    className="flex items-center gap-1.5 px-4 py-2 bg-dark-700 text-dark-300 hover:text-dark-100 hover:bg-dark-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 flex-shrink-0"
                    confirmClassName="flex items-center gap-1.5 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors text-sm font-medium flex-shrink-0 animate-pulse"
                  />
                </div>

                {/* Stop All Agents */}
                <div className="p-4 bg-dark-800/30 rounded-xl border border-dark-700/30 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <StopCircle className="w-4 h-4 text-dark-300" />
                      <span className="text-sm font-medium text-dark-200">Stop All Agents</span>
                    </div>
                    <p className="text-xs text-dark-500">
                      {busyCount > 0
                        ? `Interrupt ${busyCount} running agent${busyCount > 1 ? 's' : ''}`
                        : 'No agents currently running'}
                    </p>
                  </div>
                  <ConfirmButton
                    onConfirm={handleStopAll}
                    disabled={busyCount === 0 || !socket}
                    icon={StopCircle}
                    label="Stop All"
                    confirmLabel="Confirm?"
                    className="flex items-center gap-1.5 px-4 py-2 bg-dark-700 text-dark-300 hover:text-dark-100 hover:bg-dark-600 rounded-lg transition-colors text-sm font-medium disabled:opacity-40 flex-shrink-0"
                    confirmClassName="flex items-center gap-1.5 px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors text-sm font-medium flex-shrink-0 animate-pulse"
                  />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      <ConfirmDialog
        open={confirmState.open}
        title={currentConfirm?.title || ''}
        description={currentConfirm?.description || ''}
        confirmLabel="Clear"
        cancelLabel="Cancel"
        onCancel={closeConfirm}
        onConfirm={async () => {
          if (currentConfirm?.run) {
            await currentConfirm.run();
          }
          closeConfirm();
        }}
      />
    </div>
  );
}