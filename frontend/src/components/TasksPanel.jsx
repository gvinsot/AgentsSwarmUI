import { useState, useMemo, useCallback, useEffect } from 'react';
import { Plus, Search, CheckSquare, Clock, AlertCircle, Loader, Trash2, Edit3, Save, X, ChevronDown, ChevronRight, ArrowRight, Zap, Users, LayoutGrid } from 'lucide-react';
import { api } from '../api';

const STATUS_META = {
  backlog:     { label: 'Backlog',     color: 'text-dark-400',   bg: 'bg-dark-700',      ring: 'ring-dark-600' },
  pending:     { label: 'Pending',     color: 'text-blue-400',   bg: 'bg-blue-500/10',   ring: 'ring-blue-500/30' },
  in_progress: { label: 'In Progress', color: 'text-amber-400',  bg: 'bg-amber-500/10',  ring: 'ring-amber-500/30' },
  done:        { label: 'Done',        color: 'text-emerald-400',bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30' },
  error:       { label: 'Error',       color: 'text-red-400',    bg: 'bg-red-500/10',     ring: 'ring-red-500/30' },
};

const SOURCE_META = {
  agent: { label: s => `Agent: ${s.name || ''}`, color: 'text-violet-400', bg: 'bg-violet-500/10 ring-violet-500/20' },
  user:  { label: () => 'User',                  color: 'text-blue-400',   bg: 'bg-blue-500/10 ring-blue-500/20' },
  api:   { label: () => 'API',                   color: 'text-slate-400',  bg: 'bg-slate-500/10 ring-slate-500/20' },
  mcp:   { label: () => 'MCP',                   color: 'text-orange-400', bg: 'bg-orange-500/10 ring-orange-500/20' },
};

export default function TasksPanel({ agent, agents, socket, onRefresh }) {
  const internalTasks = agent.todoList || [];
  const [boardTasks, setBoardTasks] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState(null);
  const [editText, setEditText] = useState('');
  const [expandedTask, setExpandedTask] = useState(null);
  const [delegateTarget, setDelegateTarget] = useState('');

  // Fetch board tasks assigned to this agent
  const loadBoardTasks = useCallback(async () => {
    try {
      const data = await api.getTasksByAssignee(agent.id);
      setBoardTasks(data || []);
    } catch {
      setBoardTasks([]);
    }
  }, [agent.id]);

  useEffect(() => { loadBoardTasks(); }, [loadBoardTasks]);

  // Merge internal tasks + board tasks, deduplicating by id
  const allTasks = useMemo(() => {
    const seen = new Set();
    const merged = [];

    // Board tasks first (primary source)
    for (const bt of boardTasks) {
      if (!seen.has(bt.id)) {
        seen.add(bt.id);
        merged.push({
          ...bt,
          text: bt.title || bt.text || 'Untitled',
          status: bt.status || (bt.columnName?.toLowerCase().replace(/\s+/g, '_')) || 'pending',
          _source: 'board',
        });
      }
    }

    // Then internal tasks
    for (const it of internalTasks) {
      if (!seen.has(it.id)) {
        seen.add(it.id);
        merged.push({ ...it, _source: 'internal' });
      }
    }

    return merged;
  }, [internalTasks, boardTasks]);

  const filteredTasks = useMemo(() => {
    let t = allTasks;
    if (statusFilter !== 'all') t = t.filter(task => task.status === statusFilter);
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      t = t.filter(task =>
        task.text?.toLowerCase().includes(q) ||
        task.title?.toLowerCase().includes(q) ||
        task.project?.toLowerCase().includes(q) ||
        task.boardName?.toLowerCase().includes(q)
      );
    }
    return t;
  }, [allTasks, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => ({
    all: allTasks.length,
    backlog: allTasks.filter(t => t.status === 'backlog').length,
    pending: allTasks.filter(t => t.status === 'pending' || !t.status).length,
    in_progress: allTasks.filter(t => t.status === 'in_progress').length,
    error: allTasks.filter(t => t.status === 'error').length,
    done: allTasks.filter(t => t.status === 'done').length,
  }), [allTasks]);

  const handleAdd = async () => {
    if (!newTaskText.trim()) return;
    setAddingTask(true);
    try {
      await api.addTask(agent.id, newTaskText.trim(), agent.project || null);
      setNewTaskText('');
      onRefresh();
    } finally {
      setAddingTask(false);
    }
  };

  const handleToggle = async (task) => {
    if (task._source === 'board' && task.boardId) {
      const newStatus = task.status === 'done' ? 'pending' : 'done';
      await api.updateBoard(task.boardId, {
        workflow: undefined, // will be handled by PATCH
      }).catch(() => {});
      // For board tasks, use the board patch endpoint
      try {
        const board = await api.getBoard(task.boardId);
        if (board?.workflow?.columns) {
          // Find and update the task status in the board
          for (const col of board.workflow.columns) {
            const t = col.tasks?.find(bt => bt.id === task.id);
            if (t) {
              t.status = newStatus;
              break;
            }
          }
          await api.updateBoardWorkflow(task.boardId, board.workflow);
        }
      } catch {}
      loadBoardTasks();
    } else {
      const newStatus = task.status === 'done' ? 'pending' : 'done';
      await api.updateTask(agent.id, task.id, newStatus);
      onRefresh();
    }
  };

  const handleDelete = async (task) => {
    if (task._source === 'board' && task.boardId) {
      try {
        const board = await api.getBoard(task.boardId);
        if (board?.workflow?.columns) {
          for (const col of board.workflow.columns) {
            const idx = col.tasks?.findIndex(bt => bt.id === task.id);
            if (idx !== -1) {
              col.tasks.splice(idx, 1);
              break;
            }
          }
          await api.updateBoardWorkflow(task.boardId, board.workflow);
        }
      } catch {}
      loadBoardTasks();
    } else {
      await api.deleteTask(agent.id, task.id);
      onRefresh();
    }
  };

  const handleEditSave = async () => {
    if (!editText.trim() || !editingTask) return;
    const task = allTasks.find(t => t.id === editingTask);
    if (task?._source === 'board' && task.boardId) {
      try {
        const board = await api.getBoard(task.boardId);
        if (board?.workflow?.columns) {
          for (const col of board.workflow.columns) {
            const t = col.tasks?.find(bt => bt.id === task.id);
            if (t) {
              t.title = editText.trim();
              break;
            }
          }
          await api.updateBoardWorkflow(task.boardId, board.workflow);
        }
      } catch {}
      loadBoardTasks();
    } else {
      await api.patchTask(agent.id, editingTask, { text: editText.trim() });
      onRefresh();
    }
    setEditingTask(null); setEditText('');
  };

  const handleDelegate = async (taskId) => {
    if (!delegateTarget) return;
    const target = agents?.find(a => a.id === delegateTarget);
    if (!target) return;
    const task = allTasks.find(t => t.id === taskId);
    if (!task) return;
    await api.addTask(target.id, task.text || task.title, task.project || null, { type: 'agent', name: agent.name });
    if (task._source === 'internal') {
      await api.deleteTask(agent.id, taskId);
    }
    setDelegateTarget('');
    onRefresh();
    loadBoardTasks();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-dark-700 space-y-2">
        {/* Add task */}
        <div className="flex gap-2">
          <input value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Add a new task..." className="flex-1 bg-dark-800 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-dark-100 placeholder-dark-500 focus:border-blue-500 focus:outline-none" />
          <button onClick={handleAdd} disabled={addingTask || !newTaskText.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-medium flex items-center gap-1">
            {addingTask ? <Loader className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-1 flex-wrap">
          {Object.entries({ all: 'All', backlog: 'Backlog', pending: 'Pending', in_progress: 'In Progress', error: 'Error', done: 'Done' }).map(([key, label]) => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${statusFilter === key ? 'bg-blue-600 text-white' : 'bg-dark-700 text-dark-400 hover:text-dark-200'}`}>
              {label} {statusCounts[key] > 0 && <span className="ml-0.5 opacity-70">({statusCounts[key]})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      {filteredTasks.map(task => {
        const status = task.status || 'pending';
        const meta = STATUS_META[status] || STATUS_META.pending;
        const isExpanded = expandedTask === task.id;
        const sourceMeta = task.source?.type ? SOURCE_META[task.source.type] : null;
        const displayText = task.text || task.title || 'Untitled';

        return (
          <div key={task.id} className="px-3 py-2 border-b border-dark-800 hover:bg-dark-800/50 group">
            <div className="flex items-start gap-2">
              {/* Status toggle */}
              <button onClick={() => handleToggle(task)} className="mt-0.5 flex-shrink-0">
                {status === 'done'
                  ? <CheckSquare className="w-4 h-4 text-emerald-400" />
                  : status === 'in_progress'
                    ? <Clock className="w-4 h-4 text-amber-400" />
                    : status === 'error'
                      ? <AlertCircle className="w-4 h-4 text-red-400" />
                      : <div className="w-4 h-4 border border-dark-500 rounded" />
                }
              </button>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {editingTask === task.id ? (
                  <div className="flex gap-1">
                    <input value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleEditSave()}
                      className="flex-1 bg-dark-700 border border-dark-500 rounded px-2 py-0.5 text-xs text-dark-100" autoFocus />
                    <button onClick={handleEditSave} className="p-0.5 text-emerald-400 hover:text-emerald-300"><Save className="w-3 h-3" /></button>
                    <button onClick={() => setEditingTask(null)} className="p-0.5 text-dark-400 hover:text-dark-200"><X className="w-3 h-3" /></button>
                  </div>
                ) : (
                  <button onClick={() => setExpandedTask(isExpanded ? null : task.id)}
                    className={`text-xs text-left w-full ${status === 'done' ? 'text-dark-500 line-through' : 'text-dark-200'}`}>
                    {displayText}
                  </button>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ring-1 ${meta.bg} ${meta.ring} ${meta.color}`}>{meta.label}</span>
                  {task._source === 'board' && task.boardName && (
                    <span className="text-[10px] px-1 py-0.5 rounded ring-1 bg-indigo-500/10 ring-indigo-500/20 text-indigo-400 flex items-center gap-0.5">
                      <LayoutGrid className="w-2.5 h-2.5" /> {task.boardName}{task.columnName ? ` / ${task.columnName}` : ''}
                    </span>
                  )}
                  {task.project && <span className="text-[10px] text-dark-500 truncate max-w-[120px]">{task.project}</span>}
                  {sourceMeta && (
                    <span className={`text-[10px] px-1 py-0.5 rounded ring-1 ${sourceMeta.bg} ${sourceMeta.color}`}>
                      {sourceMeta.label(task.source)}
                    </span>
                  )}
                  {task.createdAt && <span className="text-[10px] text-dark-600">{new Date(task.createdAt).toLocaleDateString()}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => { setEditingTask(task.id); setEditText(displayText); }} className="p-1 text-dark-400 hover:text-dark-200">
                  <Edit3 className="w-3 h-3" />
                </button>
                <button onClick={() => handleDelete(task)} className="p-1 text-dark-400 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="ml-6 mt-2 space-y-2 text-xs">
                {task.description && (
                  <p className="text-dark-400">{task.description}</p>
                )}
                {/* Delegate */}
                <div className="flex items-center gap-2">
                  <Users className="w-3 h-3 text-dark-500" />
                  <span className="text-dark-400">Delegate to:</span>
                  <select value={delegateTarget} onChange={e => setDelegateTarget(e.target.value)}
                    className="bg-dark-700 border border-dark-600 rounded px-2 py-0.5 text-xs text-dark-200">
                    <option value="">Select agent...</option>
                    {agents?.filter(a => a.id !== agent.id && a.enabled !== false).map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                  <button onClick={() => handleDelegate(expandedTask)} disabled={!delegateTarget}
                    className="px-2 py-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-xs">Go</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {filteredTasks.length === 0 && (
        <div className="text-center py-8 text-dark-500">
          <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">{statusFilter === 'all' ? 'No tasks yet' : `No ${statusFilter} tasks`}</p>
        </div>
      )}
    </div>
  );
}
