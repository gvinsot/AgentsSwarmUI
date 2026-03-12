import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Search, Trash2, ArrowRightLeft, Clock, X, ChevronDown, AlertTriangle } from 'lucide-react';
import { api } from '../api';

// ── Column definitions ──────────────────────────────────────────────────────

const COLUMNS = [
  {
    id: 'todo',
    label: 'To Do',
    statuses: ['pending', 'error'],
    dropStatus: 'pending',
    dot: 'bg-slate-500',
    headerText: 'text-dark-300',
    countCls: 'bg-dark-700 text-dark-400',
    dropRing: 'ring-slate-500/40 bg-slate-500/5',
    headerActive: 'border-slate-500/60',
  },
  {
    id: 'inprogress',
    label: 'In Progress',
    statuses: ['in_progress'],
    dropStatus: 'in_progress',
    dot: 'bg-amber-400',
    headerText: 'text-amber-300',
    countCls: 'bg-amber-500/20 text-amber-300',
    dropRing: 'ring-amber-500/40 bg-amber-500/5',
    headerActive: 'border-amber-400/60',
  },
  {
    id: 'done',
    label: 'Done',
    statuses: ['done'],
    dropStatus: 'done',
    dot: 'bg-emerald-400',
    headerText: 'text-emerald-300',
    countCls: 'bg-emerald-500/20 text-emerald-300',
    dropRing: 'ring-emerald-500/40 bg-emerald-500/5',
    headerActive: 'border-emerald-400/60',
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const SOURCE_META = {
  user: { label: () => 'User', cls: 'text-blue-400 bg-blue-500/10 ring-blue-500/20' },
  agent: { label: (s) => s.name || 'Agent', cls: 'text-purple-400 bg-purple-500/10 ring-purple-500/20' },
  api: { label: () => 'API', cls: 'text-slate-400 bg-slate-500/10 ring-slate-500/20' },
  mcp: { label: () => 'MCP', cls: 'text-orange-400 bg-orange-500/10 ring-orange-500/20' },
};

// ── TaskCard ────────────────────────────────────────────────────────────────

function TaskCard({ task, agents, onDelete, onTransfer }) {
  const [transferOpen, setTransferOpen] = useState(false);
  const transferRef = useRef(null);
  const isError = task.status === 'error';

  useEffect(() => {
    if (!transferOpen) return;
    const handler = (e) => {
      if (transferRef.current && !transferRef.current.contains(e.target)) setTransferOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [transferOpen]);

  const sourceMeta = task.source ? (SOURCE_META[task.source.type] || SOURCE_META.api) : null;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ agentId: task.agentId, todoId: task.id }));
        // Ghost opacity via timeout trick
        setTimeout(() => e.target.classList.add('opacity-40'), 0);
      }}
      onDragEnd={(e) => e.target.classList.remove('opacity-40')}
      className={`group bg-dark-800 rounded-lg border p-3 cursor-grab active:cursor-grabbing
        transition-all hover:shadow-lg hover:shadow-black/20
        ${isError ? 'border-red-500/40 bg-red-500/5 hover:border-red-500/60' : 'border-dark-700 hover:border-dark-500'}`}
    >
      {/* Task text */}
      <p className={`text-sm leading-snug mb-2.5 ${isError ? 'text-red-300' : 'text-dark-200'}`}
        style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {task.text}
      </p>

      {isError && task.error && (
        <div className="flex items-start gap-1.5 mb-2 p-1.5 rounded bg-red-500/10 border border-red-500/20">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-400/80 leading-tight"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {task.error}
          </p>
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap gap-1 mb-2.5">
        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
          {task.agentName}
        </span>
        {task.project && (
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20">
            {task.project}
          </span>
        )}
        {sourceMeta && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ring-1 ${sourceMeta.cls}`}>
            {sourceMeta.label(task.source)}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-dark-500">
          <Clock className="w-3 h-3" />
          {timeAgo(task.createdAt)}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Transfer */}
          <div className="relative" ref={transferRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setTransferOpen(o => !o); }}
              className="p-1.5 rounded text-dark-500 hover:text-indigo-400 hover:bg-dark-700 transition-colors"
              title="Transfer to another agent"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
            {transferOpen && (
              <div className="absolute right-0 bottom-8 z-50 bg-dark-800 border border-dark-600 rounded-xl shadow-2xl shadow-black/40 py-1 min-w-[160px]">
                <div className="px-3 py-1.5 text-xs text-dark-400 font-semibold border-b border-dark-700 mb-1">
                  Transfer to
                </div>
                {agents.filter(a => a.id !== task.agentId && a.enabled !== false).map(a => (
                  <button
                    key={a.id}
                    onClick={(e) => { e.stopPropagation(); setTransferOpen(false); onTransfer(task, a.id); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-dark-200 hover:bg-dark-700 hover:text-white transition-colors flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: a.status === 'busy' ? '#f59e0b' : a.status === 'error' ? '#ef4444' : '#22c55e' }} />
                    {a.name}
                  </button>
                ))}
                {agents.filter(a => a.id !== task.agentId && a.enabled !== false).length === 0 && (
                  <p className="px-3 py-2 text-xs text-dark-500">No other agents</p>
                )}
              </div>
            )}
          </div>
          {/* Delete */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(task); }}
            className="p-1.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition-colors"
            title="Delete task"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── KanbanColumn ────────────────────────────────────────────────────────────

function KanbanColumn({ col, tasks, agents, onDelete, onTransfer, onDrop }) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex flex-col min-w-[300px] w-[300px] flex-shrink-0">
      {/* Column header */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl border border-b-2
        transition-colors mb-0
        ${dragOver
          ? `bg-dark-750 ${col.headerActive} border-b-2`
          : 'bg-dark-800/60 border-dark-700/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${col.dot}`} />
          <span className={`text-sm font-semibold ${col.headerText}`}>{col.label}</span>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.countCls}`}>
          {tasks.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        className={`flex-1 flex flex-col gap-2 p-2 rounded-b-xl border border-t-0 min-h-[120px]
          transition-all duration-150
          ${dragOver
            ? `ring-2 ring-inset ${col.dropRing} border-dark-600`
            : 'bg-dark-800/20 border-dark-700/30'
          }`}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onDrop(e, col); }}
      >
        {tasks.map(task => (
          <TaskCard
            key={`${task.agentId}-${task.id}`}
            task={task}
            agents={agents}
            onDelete={onDelete}
            onTransfer={onTransfer}
          />
        ))}
        {tasks.length === 0 && (
          <div className={`flex-1 flex items-center justify-center text-xs py-8
            transition-colors ${dragOver ? 'text-dark-400' : 'text-dark-700'}`}>
            {dragOver ? '↓ Drop here' : 'No tasks'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── TasksBoard ──────────────────────────────────────────────────────────────

export default function TasksBoard({ agents, onRefresh }) {
  const [projectFilter, setProjectFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState('');
  const [search, setSearch] = useState('');

  // Aggregate all todos from all agents
  const allTasks = useMemo(() =>
    agents.flatMap(a =>
      (a.todoList || []).map(t => ({ ...t, agentId: a.id, agentName: a.name }))
    ),
    [agents]
  );

  // Unique projects & agents for filters
  const allProjects = useMemo(() => {
    const ps = new Set(allTasks.map(t => t.project).filter(Boolean));
    return Array.from(ps).sort();
  }, [allTasks]);

  // Filtered tasks
  const filteredTasks = useMemo(() => {
    const q = search.toLowerCase();
    return allTasks.filter(t => {
      if (agentFilter && t.agentId !== agentFilter) return false;
      if (projectFilter && t.project !== projectFilter) return false;
      if (q && !t.text.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allTasks, agentFilter, projectFilter, search]);

  // Group by column
  const tasksByColumn = useMemo(() => {
    const groups = {};
    COLUMNS.forEach(col => {
      groups[col.id] = filteredTasks.filter(t => col.statuses.includes(t.status || 'pending'));
    });
    return groups;
  }, [filteredTasks]);

  const handleDelete = useCallback(async (task) => {
    await api.deleteTodo(task.agentId, task.id);
    onRefresh();
  }, [onRefresh]);

  const handleTransfer = useCallback(async (task, targetAgentId) => {
    await api.transferTodo(task.agentId, task.id, targetAgentId);
    onRefresh();
  }, [onRefresh]);

  const handleDrop = useCallback(async (e, col) => {
    try {
      const { agentId, todoId } = JSON.parse(e.dataTransfer.getData('application/json'));
      const task = allTasks.find(t => t.id === todoId && t.agentId === agentId);
      if (!task || col.statuses.includes(task.status || 'pending')) return;
      await api.setTodoStatus(agentId, todoId, col.dropStatus);
      onRefresh();
    } catch { /* invalid drag data */ }
  }, [allTasks, onRefresh]);

  const totalByStatus = useMemo(() => ({
    pending: allTasks.filter(t => t.status === 'pending' || !t.status).length,
    error: allTasks.filter(t => t.status === 'error').length,
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    done: allTasks.filter(t => t.status === 'done').length,
  }), [allTasks]);

  const activeFilters = [agentFilter, projectFilter, search].filter(Boolean).length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 border-b border-dark-700 bg-dark-900/30">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dark-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="pl-8 pr-7 py-1.5 w-48 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-200
              placeholder-dark-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-dark-400 hover:text-dark-200">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Agent filter */}
        <select
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-200
            focus:outline-none focus:border-indigo-500 transition-colors"
        >
          <option value="">All agents</option>
          {agents.filter(a => a.enabled !== false).map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>

        {/* Project filter */}
        {allProjects.length > 0 && (
          <select
            value={projectFilter}
            onChange={e => setProjectFilter(e.target.value)}
            className="px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-200
              focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">All projects</option>
            {allProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}

        {/* Clear filters */}
        {activeFilters > 0 && (
          <button
            onClick={() => { setAgentFilter(''); setProjectFilter(''); setSearch(''); }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-amber-400 bg-amber-500/10
              border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear filters ({activeFilters})
          </button>
        )}

        {/* Stats */}
        <div className="ml-auto flex items-center gap-3 text-xs text-dark-500">
          <span>{totalByStatus.pending + totalByStatus.error} pending</span>
          <span className="text-amber-400/70">{totalByStatus.in_progress} active</span>
          <span className="text-emerald-400/70">{totalByStatus.done} done</span>
          {totalByStatus.error > 0 && (
            <span className="text-red-400/70">{totalByStatus.error} errors</span>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-auto min-h-0">
        <div className="flex gap-4 p-6 h-full min-w-max">
          {COLUMNS.map(col => (
            <KanbanColumn
              key={col.id}
              col={col}
              tasks={tasksByColumn[col.id] || []}
              agents={agents}
              onDelete={handleDelete}
              onTransfer={handleTransfer}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
