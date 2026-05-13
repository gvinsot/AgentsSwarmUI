import { useState } from 'react';
import { X, Wrench } from 'lucide-react';
import { api } from '../../api';
import OneDriveConnect from '../OneDriveConnect';
import OutlookConnect from '../OutlookConnect';
import GmailConnect from '../GmailConnect';
import GoogleDriveConnect from '../GoogleDriveConnect';
import SlackConnect from '../SlackConnect';
import JiraConnect from '../JiraConnect';
import WordPressConnect from '../WordPressConnect';
import GitHubConnect from '../GitHubConnect';
import S3Connect from '../S3Connect';

// Map MCP server IDs to their dedicated OAuth/API-key connector widget.
// Returning null means the MCP doesn't need an interactive connector here
// (it's wired via global env vars or doesn't expose a setup UI).
const MCP_CONNECTOR_MAP: Record<string, any> = {
  'mcp-onedrive': OneDriveConnect,
  'mcp-gmail': GmailConnect,
  'mcp-outlook': OutlookConnect,
  'mcp-gdrive': GoogleDriveConnect,
  'mcp-slack': SlackConnect,
  'mcp-jira': JiraConnect,
  'mcp-wordpress': WordPressConnect,
  'mcp-github': GitHubConnect,
  'mcp-aws-s3': S3Connect,
};

function getPluginMcpIds(plugin: any): string[] {
  const ids = new Set<string>();
  for (const m of plugin.mcps || []) {
    if (m?.id) ids.add(m.id);
  }
  for (const id of plugin.mcpServerIds || []) {
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

export default function PluginsTab({ agent, plugins, onRefresh }) {
  const [categoryFilter, setCategoryFilter] = useState('all');

  const agentPluginIds = agent.skills || [];
  const assignedPlugins = plugins.filter(s => agentPluginIds.includes(s.id));
  const availablePlugins = plugins.filter(s => !agentPluginIds.includes(s.id));

  const categories = ['all', ...new Set(plugins.map(s => s.category).filter(Boolean))];
  const filteredAvailable = categoryFilter === 'all'
    ? availablePlugins
    : availablePlugins.filter(s => s.category === categoryFilter);

  const handleAssign = async (pluginId) => {
    await api.assignPlugin(agent.id, pluginId);
    onRefresh();
  };

  const handleRemove = async (pluginId) => {
    await api.removePlugin(agent.id, pluginId);
    onRefresh();
  };

  const categoryColors = {
    coding: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    devops: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    writing: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    security: 'bg-red-500/20 text-red-400 border-red-500/30',
    analysis: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    general: 'bg-dark-500/20 text-dark-300 border-dark-500/30',
  };

  const getCategoryClass = (cat) => categoryColors[cat] || categoryColors.general;

  return (
    <div className="p-4 space-y-5 overflow-auto">
      <div>
        <h3 className="font-medium text-dark-200 text-sm mb-3">
          Assigned Plugins
          <span className="ml-2 text-dark-400 font-normal">({assignedPlugins.length})</span>
        </h3>
        {assignedPlugins.length > 0 ? (
          <div className="space-y-2">
            {assignedPlugins.map(plugin => {
              const pluginMcps = (plugin.mcps || []).filter(m => m.id);
              const connectorMcpIds = getPluginMcpIds(plugin).filter(id => MCP_CONNECTOR_MAP[id]);
              return (
                <div key={plugin.id} className="bg-dark-800/50 rounded-lg border border-dark-700/50">
                  <div className="flex items-center gap-3 p-3 group">
                    <span className="text-lg flex-shrink-0">{plugin.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-dark-200">{plugin.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getCategoryClass(plugin.category)}`}>
                          {plugin.category}
                        </span>
                        {pluginMcps.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            {pluginMcps.length} MCP
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-dark-400 truncate">{plugin.description}</p>
                    </div>
                    <button
                      onClick={() => handleRemove(plugin.id)}
                      className="p-1 text-dark-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      title="Remove plugin"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {connectorMcpIds.length > 0 && (
                    <div className="px-3 pb-3 space-y-2">
                      {connectorMcpIds.map(mcpId => {
                        const Connector = MCP_CONNECTOR_MAP[mcpId];
                        return (
                          <Connector
                            key={mcpId}
                            agentId={agent.id}
                            onStatusChange={() => onRefresh?.()}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-4 border border-dashed border-dark-700 rounded-lg">
            <Wrench className="w-5 h-5 mx-auto mb-1 text-dark-500 opacity-40" />
            <p className="text-dark-500 text-xs">No plugins assigned</p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-dark-200 text-sm">
            Available Plugins
            <span className="ml-2 text-dark-400 font-normal">({filteredAvailable.length})</span>
          </h3>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors border ${
                categoryFilter === cat
                  ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                  : 'bg-dark-800 text-dark-400 border-dark-700 hover:text-dark-200'
              }`}
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>

        <div className="space-y-2 mt-3">
          {filteredAvailable.map(plugin => (
            <div key={plugin.id} className="flex items-center gap-3 p-3 bg-dark-800/30 rounded-lg border border-dark-700/30 hover:border-dark-600 transition-colors group">
              <span className="text-lg flex-shrink-0">{plugin.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-dark-300">{plugin.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${getCategoryClass(plugin.category)}`}>
                    {plugin.category}
                  </span>
                  {(plugin.mcps || []).length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                      {(plugin.mcps || []).length} MCP
                    </span>
                  )}
                  {plugin.userConfig && Object.keys(plugin.userConfig).length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-amber-500/20 text-amber-400 border-amber-500/30">
                      config utilisateur
                    </span>
                  )}
                </div>
                <p className="text-xs text-dark-500 truncate">{plugin.description}</p>
              </div>
              <button
                onClick={() => handleAssign(plugin.id)}
                className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-400 rounded-md text-xs font-medium transition-colors flex-shrink-0"
              >
                Add
              </button>
            </div>
          ))}
          {filteredAvailable.length === 0 && (
            <p className="text-center text-dark-500 text-xs py-4">
              {availablePlugins.length === 0 ? 'All plugins assigned' : 'No plugins in this category'}
            </p>
          )}
        </div>
      </div>

    </div>
  );
}
