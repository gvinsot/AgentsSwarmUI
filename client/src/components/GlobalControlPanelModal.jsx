import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function GlobalControlPanelModal({ isOpen, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plugins, setPlugins] = useState([]);
  const [mcpModules, setMcpModules] = useState([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        setLoading(true);
        setError('');
        const data = await api.plugins.getSettings();
        setPlugins(data?.settings?.plugins || []);
        setMcpModules(data?.settings?.mcpModules || []);
        setRevision(data?.settings?.revision || 0);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  const togglePlugin = (id) => {
    setPlugins((prev) => prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)));
  };

  const toggleModule = (pluginId, moduleId) => {
    setPlugins((prev) =>
      prev.map((p) => {
        if (p.id !== pluginId) return p;
        const current = Array.isArray(p.mcpModules) ? p.mcpModules : [];
        const has = current.includes(moduleId);
        return { ...p, mcpModules: has ? current.filter((m) => m !== moduleId) : [...current, moduleId] };
      })
    );
  };

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      const payload = { plugins, mcpModules, revision };
      const res = await api.plugins.saveSettings(payload);
      if (res?.settings?.revision) setRevision(res.settings.revision);
      onClose?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white w-[900px] max-h-[85vh] overflow-auto rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Global Plugins Control Panel</h2>
          <button onClick={onClose} className="px-3 py-1 border rounded">Close</button>
        </div>

        {loading && <div>Loading...</div>}
        {error && <div className="text-red-600 mb-3">{error}</div>}

        {!loading && (
          <div className="space-y-4">
            {plugins.map((plugin) => (
              <div key={plugin.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{plugin.name}</div>
                    <div className="text-sm text-gray-600">{plugin.description}</div>
                  </div>
                  <label className="flex items-center gap-2">
                    <span className="text-sm">Enabled</span>
                    <input
                      type="checkbox"
                      checked={!!plugin.enabled}
                      onChange={() => togglePlugin(plugin.id)}
                    />
                  </label>
                </div>

                <div className="mt-3">
                  <div className="text-sm font-medium mb-2">MCP Modules</div>
                  <div className="grid grid-cols-2 gap-2">
                    {mcpModules.map((m) => {
                      const selected = (plugin.mcpModules || []).includes(m.id);
                      return (
                        <label key={m.id} className="flex items-center gap-2 text-sm border rounded px-2 py-1">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleModule(plugin.id, m.id)}
                          />
                          <span>{m.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 border rounded">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-black text-white rounded">
            {saving ? 'Saving...' : 'Save all'}
          </button>
        </div>
      </div>
    </div>
  );
}