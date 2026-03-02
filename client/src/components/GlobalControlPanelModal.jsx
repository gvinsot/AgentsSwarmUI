import { useMemo, useState } from 'react';
import { api } from '../api';

export default function GlobalControlPanelModal({
  isOpen,
  onClose,
  plugins = [],
  mcpServers = [],
  onRefresh,
  showToast
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedMcpIds, setSelectedMcpIds] = useState([]);

  const mcpById = useMemo(() => new Map(mcpServers.map(m => [m.id, m])), [mcpServers]);

  if (!isOpen) return null;

  const toggleMcp = (id) => {
    setSelectedMcpIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const createPlugin = async () => {
    try {
      await api.createPlugin({ name, description, mcpServerIds: selectedMcpIds });
      setName('');
      setDescription('');
      setSelectedMcpIds([]);
      await onRefresh?.();
      showToast?.('Plugin created', 'success', 2500);
    } catch (e) {
      showToast?.(`Failed to create plugin: ${e.message}`, 'error', 7000);
    }
  };

  const removePlugin = async (id) => {
    try {
      await api.deletePlugin(id);
      await onRefresh?.();
      showToast?.('Plugin removed', 'success', 2500);
    } catch (e) {
      showToast?.(`Failed to remove plugin: ${e.message}`, 'error', 7000);
    }
  };

  const attach = async (pluginId, mcpId) => {
    try {
      await api.attachMcpToPlugin(pluginId, mcpId);
      await onRefresh?.();
    } catch (e) {
      showToast?.(`Attach failed: ${e.message}`, 'error', 7000);
    }
  };

  const detach = async (pluginId, mcpId) => {
    try {
      await api.detachMcpFromPlugin(pluginId, mcpId);
      await onRefresh?.();
    } catch (e) {
      showToast?.(`Detach failed: ${e.message}`, 'error', 7000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-dark-900 border border-dark-700 rounded-xl p-4 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Global Plugins & MCP Management</h2>
          <button className="px-3 py-1 rounded bg-dark-800" onClick={onClose}>Close</button>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <section className="space-y-3">
            <h3 className="font-medium">Create Plugin</h3>
            <input
              className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2"
              placeholder="Plugin name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <textarea
              className="w-full bg-dark-800 border border-dark-700 rounded px-3 py-2"
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="space-y-1">
              <div className="text-sm opacity-80">Associate MCPs</div>
              {mcpServers.map(mcp => (
                <label key={mcp.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedMcpIds.includes(mcp.id)}
                    onChange={() => toggleMcp(mcp.id)}
                  />
                  <span>{mcp.name}</span>
                </label>
              ))}
            </div>
            <button className="px-3 py-2 rounded bg-indigo-600 hover:bg-indigo-500" onClick={createPlugin}>
              Add Plugin
            </button>
          </section>

          <section className="space-y-3">
            <h3 className="font-medium">Existing Plugins</h3>
            <div className="space-y-3">
              {plugins.map(plugin => (
                <div key={plugin.id} className="border border-dark-700 rounded p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium">{plugin.name}</div>
                      <div className="text-xs opacity-70">{plugin.description}</div>
                    </div>
                    <button className="px-2 py-1 rounded bg-red-700/70" onClick={() => removePlugin(plugin.id)}>
                      Remove
                    </button>
                  </div>

                  <div className="mt-2 text-xs opacity-80">Associated MCPs:</div>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {(plugin.mcpServerIds || []).map(id => (
                      <button
                        key={id}
                        className="px-2 py-1 rounded bg-dark-800 border border-dark-700 text-xs"
                        onClick={() => detach(plugin.id, id)}
                        title="Click to detach"
                      >
                        {mcpById.get(id)?.name || id} ×
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    {mcpServers
                      .filter(m => !(plugin.mcpServerIds || []).includes(m.id))
                      .map(m => (
                        <button
                          key={m.id}
                          className="px-2 py-1 rounded bg-emerald-700/40 text-xs"
                          onClick={() => attach(plugin.id, m.id)}
                        >
                          + {m.name}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}