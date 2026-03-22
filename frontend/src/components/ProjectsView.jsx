import { useState, useEffect, useMemo } from 'react';
import { FolderGit2, Users, ListTodo, Clock, ArrowRight, Search, ChevronDown, Activity, BarChart3, Bug, Sparkles } from 'lucide-react';
import { api } from '../api';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  if (hours < 24) return `${hours}h ${remainMin}m`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return `${days}d ${remainHours}h`;
}

export default function ProjectsView({ agents = [], onSelectProject }) {
  const [todos, setTodos] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [selectedProject, setSelectedProject] = useState(null);
  const [projectStats, setProjectStats] = useState(null);

  useEffect(() => {
    api.get('/agents/todos').then(res => setTodos(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedProject) {
      api.get(`/agents/todos/stats?project=${encodeURIComponent(selectedProject)}`).then(res => setProjectStats(res.data)).catch(() => setProjectStats(null));
    } else {
      setProjectStats(null);
    }
  }, [selectedProject]);

  // Derive projects from agents + todos
  const projects = useMemo(() => {
    const projectMap = new Map();

    for (const a of agents) {
      if (!a.project) continue;
      if (!projectMap.has(a.project)) {
        projectMap.set(a.project, { name: a.project, agents: [], todos: [], stats: {} });
      }
      projectMap.get(a.project).agents.push(a);
    }

    for (const t of todos) {
      if (!t.project) continue;
      if (!projectMap.has(t.project)) {
        projectMap.set(t.project, { name: t.project, agents: [], todos: [], stats: {} });
      }
      projectMap.get(t.project).todos.push(t);
    }

    for (const [, p] of projectMap) {
      const total = p.todos.length;
      const done = p.todos.filter(t => t.status === 'done').length;
      const inProgress = p.todos.filter(t => t.status === 'in_progress').length;
      const pending = p.todos.filter(t => t.status === 'pending').length;
      const backlog = p.todos.filter(t => t.status === 'backlog').length;
      const bugs = p.todos.filter(t => (t.type || 'bug') === 'bug').length;
      const features = p.todos.filter(t => t.type === 'feature').length;
      p.stats = { total, done, inProgress, pending, backlog, bugs, features, completion: total ? Math.round((done / total) * 100) : 0 };
    }

    let result = Array.from(projectMap.values());
    if (search) {
      result = result.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    }
    if (sortBy === 'name') result.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'tasks') result.sort((a, b) => b.stats.total - a.stats.total);
    else if (sortBy === 'completion') result.sort((a, b) => b.stats.completion - a.stats.completion);
    return result;
  }, [agents, todos, search, sortBy]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FolderGit2 size={20} className="text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Projects</h2>
          <span className="text-xs text-dark-400 bg-dark-700 px-2 py-0.5 rounded-full">{projects.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-dark-400" />
            <input
              type="text"
              placeholder="Search projects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-dark-700 border border-dark-600 rounded pl-7 pr-3 py-1.5 text-sm text-white w-48"
            />
          </div>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-dark-700 border border-dark-600 rounded px-2 py-1.5 text-sm text-white"
          >
            <option value="name">Sort: Name</option>
            <option value="tasks">Sort: Tasks</option>
            <option value="completion">Sort: Completion</option>
          </select>
        </div>
      </div>

      {/* Stats Panel */}
      {selectedProject && projectStats && (
        <div className="bg-dark-800 border border-purple-500/30 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <BarChart3 size={16} className="text-purple-400" />
              Statistics: {selectedProject}
            </h3>
            <button onClick={() => setSelectedProject(null)} className="text-xs text-dark-400 hover:text-white">Close</button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Type breakdown */}
            <div className="bg-dark-700/50 rounded-lg p-3">
              <div className="text-xs text-dark-400 mb-1">Type Breakdown</div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-orange-400">🐛</span>
                  <span className="text-sm text-white font-medium">{projectStats.byType?.bug || 0}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-emerald-400">✨</span>
                  <span className="text-sm text-white font-medium">{projectStats.byType?.feature || 0}</span>
                </div>
              </div>
            </div>

            {/* Resolution time */}
            <div className="bg-dark-700/50 rounded-lg p-3">
              <div className="text-xs text-dark-400 mb-1">Avg Resolution</div>
              <div className="text-sm text-white font-medium">{formatDuration(projectStats.resolution?.avg)}</div>
              <div className="text-xs text-dark-500">median: {formatDuration(projectStats.resolution?.median)}</div>
            </div>

            {/* Bug resolution */}
            <div className="bg-dark-700/50 rounded-lg p-3">
              <div className="text-xs text-dark-400 mb-1">🐛 Bug Resolution</div>
              <div className="text-sm text-white font-medium">{formatDuration(projectStats.resolutionByType?.bug?.avg)}</div>
              <div className="text-xs text-dark-500">{projectStats.resolutionByType?.bug?.count || 0} resolved</div>
            </div>

            {/* Feature resolution */}
            <div className="bg-dark-700/50 rounded-lg p-3">
              <div className="text-xs text-dark-400 mb-1">✨ Feature Resolution</div>
              <div className="text-sm text-white font-medium">{formatDuration(projectStats.resolutionByType?.feature?.avg)}</div>
              <div className="text-xs text-dark-500">{projectStats.resolutionByType?.feature?.count || 0} resolved</div>
            </div>
          </div>

          {/* State durations */}
          {projectStats.avgStateDurations && Object.keys(projectStats.avgStateDurations).length > 0 && (
            <div>
              <div className="text-xs text-dark-400 mb-2">Average Time in State</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(projectStats.avgStateDurations).map(([state, data]) => (
                  <div key={state} className="bg-dark-700/50 rounded px-3 py-1.5 text-xs">
                    <span className="text-dark-400">{state}:</span>{' '}
                    <span className="text-white font-medium">{formatDuration(data.avg)}</span>
                    <span className="text-dark-500 ml-1">({data.count}x)</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status distribution bar */}
          {projectStats.byStatus && (
            <div>
              <div className="text-xs text-dark-400 mb-2">Status Distribution</div>
              <div className="flex h-4 rounded-full overflow-hidden bg-dark-700">
                {projectStats.byStatus.done > 0 && <div className="bg-green-500" style={{ width: `${(projectStats.byStatus.done / projectStats.total) * 100}%` }} title={`Done: ${projectStats.byStatus.done}`} />}
                {projectStats.byStatus.in_progress > 0 && <div className="bg-yellow-500" style={{ width: `${(projectStats.byStatus.in_progress / projectStats.total) * 100}%` }} title={`In Progress: ${projectStats.byStatus.in_progress}`} />}
                {projectStats.byStatus.pending > 0 && <div className="bg-blue-500" style={{ width: `${(projectStats.byStatus.pending / projectStats.total) * 100}%` }} title={`Pending: ${projectStats.byStatus.pending}`} />}
                {projectStats.byStatus.backlog > 0 && <div className="bg-gray-500" style={{ width: `${(projectStats.byStatus.backlog / projectStats.total) * 100}%` }} title={`Backlog: ${projectStats.byStatus.backlog}`} />}
              </div>
              <div className="flex gap-3 mt-1 text-xs text-dark-400">
                {projectStats.byStatus.done > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Done: {projectStats.byStatus.done}</span>}
                {projectStats.byStatus.in_progress > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500" />Active: {projectStats.byStatus.in_progress}</span>}
                {projectStats.byStatus.pending > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Todo: {projectStats.byStatus.pending}</span>}
                {projectStats.byStatus.backlog > 0 && <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500" />Backlog: {projectStats.byStatus.backlog}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Project Cards */}
      {projects.length === 0 && (
        <div className="text-center py-12 text-dark-400">
          <FolderGit2 size={48} className="mx-auto mb-3 opacity-30" />
          <p>No projects found</p>
          <p className="text-xs mt-1">Projects are derived from agent assignments and task projects</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => (
          <div
            key={p.name}
            className="bg-dark-800 border border-dark-700 rounded-xl p-4 hover:border-purple-500/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white truncate" onClick={() => onSelectProject?.(p.name)}>{p.name}</h3>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedProject(selectedProject === p.name ? null : p.name); }}
                className={`p-1 rounded hover:bg-dark-600 ${selectedProject === p.name ? 'text-purple-400' : 'text-dark-400'}`}
                title="View statistics"
              >
                <BarChart3 size={14} />
              </button>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-dark-700 rounded-full h-1.5 mb-3">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${p.stats.completion}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Users size={12} className="text-blue-400" />
                <span className="text-dark-300">{p.agents.length} agents</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ListTodo size={12} className="text-purple-400" />
                <span className="text-dark-300">{p.stats.total} tasks</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-orange-400 text-xs">🐛</span>
                <span className="text-dark-300">{p.stats.bugs} bugs</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-emerald-400 text-xs">✨</span>
                <span className="text-dark-300">{p.stats.features} features</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity size={12} className="text-yellow-400" />
                <span className="text-dark-300">{p.stats.inProgress} active</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock size={12} className="text-green-400" />
                <span className="text-dark-300">{p.stats.completion}% done</span>
              </div>
            </div>

            {/* Agent avatars */}
            {p.agents.length > 0 && (
              <div className="flex items-center gap-1 mt-3 pt-3 border-t border-dark-700">
                {p.agents.slice(0, 5).map(a => (
                  <div
                    key={a.id || a.name}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      a.status === 'busy' ? 'bg-yellow-500/20 text-yellow-400' :
                      a.status === 'idle' ? 'bg-green-500/20 text-green-400' :
                      'bg-dark-600 text-dark-400'
                    }`}
                    title={`${a.name} (${a.status})`}
                  >
                    {(a.name || '?')[0]}
                  </div>
                ))}
                {p.agents.length > 5 && (
                  <span className="text-xs text-dark-400">+{p.agents.length - 5}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}