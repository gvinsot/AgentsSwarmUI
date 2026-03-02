import { readCollection, writeCollection, nextId } from './store.js';
import { getMcpServers, createMcpServer } from './mcpServers.js';

const COLLECTION = 'plugins';

function normalizePlugin(input = {}) {
  const mcpServerIds = Array.isArray(input.mcpServerIds)
    ? [...new Set(input.mcpServerIds.map(String).filter(Boolean))]
    : [];
  const mcpServers = Array.isArray(input.mcpServers) ? input.mcpServers : [];

  return {
    name: String(input.name || '').trim(),
    description: String(input.description || '').trim(),
    content: String(input.content || ''),
    mcpServerIds,
    mcpServers
  };
}

export function getPlugins() {
  return readCollection(COLLECTION, []);
}

export function getPluginById(id) {
  return getPlugins().find(p => p.id === String(id)) || null;
}

export function createPlugin(input) {
  const data = normalizePlugin(input);
  if (!data.name) throw new Error('Plugin name is required');

  const existingMcp = getMcpServers();
  const existingByName = new Map(existingMcp.map(s => [s.name.toLowerCase(), s]));

  const ensuredIds = new Set(data.mcpServerIds);

  for (const mcp of data.mcpServers) {
    const name = String(mcp?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let server = existingByName.get(key);
    if (!server) {
      server = createMcpServer({
        name,
        command: mcp.command || '',
        args: Array.isArray(mcp.args) ? mcp.args : [],
        env: mcp.env && typeof mcp.env === 'object' ? mcp.env : {}
      });
      existingByName.set(key, server);
    }
    ensuredIds.add(server.id);
  }

  const plugins = getPlugins();
  const plugin = {
    id: nextId(plugins),
    ...data,
    mcpServerIds: [...ensuredIds],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  plugins.push(plugin);
  writeCollection(COLLECTION, plugins);
  return plugin;
}

export function updatePlugin(id, patch) {
  const plugins = getPlugins();
  const idx = plugins.findIndex(p => p.id === String(id));
  if (idx === -1) return null;

  const current = plugins[idx];
  const next = normalizePlugin({ ...current, ...patch });

  plugins[idx] = {
    ...current,
    ...next,
    updatedAt: new Date().toISOString()
  };
  writeCollection(COLLECTION, plugins);
  return plugins[idx];
}

export function deletePlugin(id) {
  const plugins = getPlugins();
  const next = plugins.filter(p => p.id !== String(id));
  if (next.length === plugins.length) return false;
  writeCollection(COLLECTION, next);
  return true;
}

export function addMcpToPlugin(pluginId, mcpServerId) {
  const plugin = getPluginById(pluginId);
  if (!plugin) return null;
  const ids = new Set(plugin.mcpServerIds || []);
  ids.add(String(mcpServerId));
  return updatePlugin(pluginId, { mcpServerIds: [...ids] });
}

export function removeMcpFromPlugin(pluginId, mcpServerId) {
  const plugin = getPluginById(pluginId);
  if (!plugin) return null;
  const ids = (plugin.mcpServerIds || []).filter(id => id !== String(mcpServerId));
  return updatePlugin(pluginId, { mcpServerIds: ids });
}