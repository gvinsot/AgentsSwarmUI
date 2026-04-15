import { useState, useRef, useCallback } from 'react';
import { Trash2, Edit3, Plus } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import TaskCard from './TaskCard';

export default function KanbanColumn({ col, tasks, agents, onDelete, onStop, onResume, onDrop, onOpen, onClearAll, onAddTask, onEditInstructions, hasInstructions, showAgent, showCreator, showProject, showTaskType, onTouchDrop, onNavigateToAgent, onOpenCommits }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [dragOver, setDragOver] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [dropIndex, setDropIndex] = useState(-1);
  const dropZoneRef = useRef(null);

  // Compute which index the dragged item should be inserted at
  const computeDropIndex = useCallback((e) => {
    const container = dropZoneRef.current;
    if (!container) return tasks.length;
    const cards = container.querySelectorAll('[data-task-id]');
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (e.clientY < midY) return i;
    }
    return tasks.length; // drop at end
  }, [tasks.length]);

  return (
    <div className="flex flex-col min-w-[300px] w-[300px] max-h-[2500px] flex-shrink-0 group"
      data-column-id={col.id}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {/* Column header */}
      <div className={`flex items-center justify-between px-3 py-2.5 rounded-t-xl border border-b-2
        transition-colors mb-0 flex-shrink-0
        ${dragOver
          ? `bg-dark-750 ${col.headerActive} border-b-2`
          : 'bg-dark-800/60 border-dark-700/50'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${col.dot}`} />
          <span className={`text-sm font-semibold ${isLight ? col.headerTextLight : col.headerText}`}>{col.label}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {hasInstructions && (
            <button
              onClick={() => onEditInstructions(col.id)}
              className="p-1 rounded text-dark-500 hover:text-blue-400 hover:bg-dark-700 transition-colors"
              title="Edit agent instructions for this column"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
          {onClearAll && tasks.length > 0 && (
            <button
              onClick={onClearAll}
              className="p-1 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition-colors"
              title="Delete all done tasks"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isLight ? col.countClsLight : col.countCls}`}>
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Drop zone */}
      <div
        ref={dropZoneRef}
        className={`flex flex-col gap-2 p-2 rounded-b-xl border border-t-0
          transition-all duration-150 flex-1 min-h-0 overflow-y-auto
          ${dragOver
            ? `ring-2 ring-inset ${col.dropRing} border-dark-600`
            : 'bg-dark-800/20 border-dark-700/30'
          }`}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
          setDropIndex(computeDropIndex(e));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) {
            setDragOver(false);
            setDropIndex(-1);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          const idx = computeDropIndex(e);
          setDragOver(false);
          setDropIndex(-1);
          onDrop(e, col, idx);
        }}
      >
        {tasks.map((task, i) => (
          <div key={`${task.agentId}-${task.id}`} data-task-id={task.id}>
            {dragOver && dropIndex === i && (
              <div className="h-1 rounded-full bg-indigo-500/60 mx-2 mb-1 transition-all" />
            )}
            <TaskCard
              task={task}
              agents={agents}
              onDelete={onDelete}
              onStop={onStop}
              onResume={onResume}
              onOpen={onOpen}
              showAgent={showAgent}
              showCreator={showCreator}
              showProject={showProject}
              showTaskType={showTaskType}
              onTouchDrop={onTouchDrop}
              onNavigateToAgent={onNavigateToAgent}
              onOpenCommits={onOpenCommits}
            />
          </div>
        ))}
        {dragOver && dropIndex >= tasks.length && (
          <div className="h-1 rounded-full bg-indigo-500/60 mx-2 transition-all" />
        )}
        {tasks.length === 0 && (
          <div className={`flex items-center justify-center text-xs py-4
            transition-colors ${dragOver ? 'text-dark-400' : 'text-dark-700'}`}>
            {dragOver ? '↓ Drop here' : 'No tasks'}
          </div>
        )}
        {onAddTask && (
          <button
            onClick={onAddTask}
            className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs
              transition-all duration-150 flex-shrink-0
              text-dark-400 hover:text-indigo-400 hover:bg-dark-700/50"
          >
            <Plus className="w-3 h-3" /> Add task
          </button>
        )}
      </div>
    </div>
  );
}
