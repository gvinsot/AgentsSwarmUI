import { useState, useRef, useEffect } from 'react';
import {
  Trash2, Clock, AlertTriangle, User, GitCommit, Repeat, Loader2, Square,
  Flag, Sun, Play,
} from 'lucide-react';
import { SOURCE_META, TASK_TYPE_MAP, PRIORITY_MAP, isToday, timeAgo } from './taskConstants';

export default function TaskCard({ task, agents, onDelete, onStop, onResume, onOpen, showAgent, showCreator, showProject, showTaskType, onTouchDrop, onNavigateToAgent, onOpenCommits }) {
  const isError = task.status === 'error';
  const today = isToday(task.createdAt);
  const isDraggingRef = useRef(false);
  const touchDragRef = useRef(null);
  const cardRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const longPressArmedRef = useRef(false);
  const autoScrollRef = useRef(null);
  // Refs for native touch listeners (avoid stale closures)
  const onTouchDropRef = useRef(onTouchDrop);
  const taskRef = useRef(task);
  useEffect(() => { onTouchDropRef.current = onTouchDrop; }, [onTouchDrop]);
  useEffect(() => { taskRef.current = task; }, [task]);

  const sourceMeta = task.source ? (SOURCE_META[task.source.type] || SOURCE_META.api) : null;

  // Find which column contains a given viewport coordinate using bounding rects.
  // More reliable on mobile than elementFromPoint (no z-index / pointer-events issues).
  function getColumnAtPoint(x, y) {
    const cols = document.querySelectorAll('[data-column-id]');
    for (const col of cols) {
      const r = col.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return col;
      }
    }
    return null;
  }

  function highlightColumn(colEl) {
    document.querySelectorAll('[data-column-id]').forEach(c => c.classList.remove('touch-drag-over'));
    if (colEl) colEl.classList.add('touch-drag-over');
  }

  // Shared drop cleanup + execution (used by both touchend and touchcancel)
  function finalizeTouchDrop(touchX, touchY) {
    const t = taskRef.current;
    if (!touchDragRef.current) return;
    if (!touchDragRef.current.started) { isDraggingRef.current = false; touchDragRef.current = null; return; }

    // Remove ghost
    if (touchDragRef.current.ghost) touchDragRef.current.ghost.remove();
    highlightColumn(null);

    // Determine target column.
    // Prefer fresh touch coordinates at drop time (most accurate on touchend).
    // Fall back to lastColumnId stored during touchmove (used by touchcancel which has no coordinates).
    let dropColId = null;
    if (touchX != null && touchY != null) {
      const col = getColumnAtPoint(touchX, touchY);
      if (col) dropColId = col.getAttribute('data-column-id');
    }
    if (!dropColId) {
      dropColId = touchDragRef.current.lastColumnId || null;
    }

    if (dropColId) {
      onTouchDropRef.current(t.agentId, t.id, dropColId);
    }
    setTimeout(() => { isDraggingRef.current = false; }, 50);
    touchDragRef.current = null;
  }

  // Attach native touch listeners so preventDefault() works AND events fire
  // even when the browser's scroll container intercepts the gesture.
  // React synthetic onTouchEnd/onTouchCancel can be silently swallowed on mobile.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const handleTouchMove = (e) => {
      // If long-press timer is still pending, cancel it if user moves (they're scrolling)
      if (longPressTimerRef.current && !longPressArmedRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        return;
      }
      if (!touchDragRef.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchDragRef.current.startX;
      const dy = touch.clientY - touchDragRef.current.startY;

      // Prevent scrolling as soon as drag is armed — must happen BEFORE the 20px threshold
      // Otherwise the browser may interpret early movement as a scroll and fire touchcancel
      e.preventDefault();

      if (!touchDragRef.current.started) {
        if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return;
        touchDragRef.current.started = true;
        isDraggingRef.current = true;

        // Create ghost element
        const ghost = el.cloneNode(true);
        ghost.style.position = 'fixed';
        ghost.style.zIndex = '9999';
        ghost.style.pointerEvents = 'none';
        ghost.style.opacity = '0.85';
        ghost.style.width = el.offsetWidth + 'px';
        ghost.style.transform = 'rotate(2deg) scale(1.02)';
        ghost.style.boxShadow = '0 8px 32px rgba(0,0,0,0.4)';
        document.body.appendChild(ghost);
        touchDragRef.current.ghost = ghost;

        // Find and store the scroll container for auto-scroll
        touchDragRef.current.scrollContainer = el.closest('.overflow-auto');

        // Dim the original card
        el.style.opacity = '0.4';
      }

      // Move ghost
      if (touchDragRef.current.ghost) {
        touchDragRef.current.ghost.style.left = (touch.clientX - el.offsetWidth / 2) + 'px';
        touchDragRef.current.ghost.style.top = (touch.clientY - 30) + 'px';
      }

      // Auto-scroll the board when dragging near edges (critical for mobile — columns are wider than screen)
      const scrollEl = touchDragRef.current.scrollContainer;
      if (scrollEl) {
        const rect = scrollEl.getBoundingClientRect();
        const edgeZone = 60; // px from edge to trigger scroll
        const scrollSpeed = 12; // px per frame

        // Clear any existing auto-scroll
        if (autoScrollRef.current) {
          cancelAnimationFrame(autoScrollRef.current);
          autoScrollRef.current = null;
        }

        const touchX = touch.clientX;
        const touchY = touch.clientY;
        const startAutoScroll = (direction) => {
          const tick = () => {
            scrollEl.scrollLeft += direction * scrollSpeed;
            // Update column highlight during auto-scroll (finger is stationary but board scrolls)
            const col2 = getColumnAtPoint(touchX, touchY);
            if (col2 && touchDragRef.current) {
              highlightColumn(col2);
              touchDragRef.current.lastColumnId = col2.getAttribute('data-column-id');
            }
            autoScrollRef.current = requestAnimationFrame(tick);
          };
          autoScrollRef.current = requestAnimationFrame(tick);
        };

        if (touch.clientX > rect.right - edgeZone) {
          startAutoScroll(1); // scroll right
        } else if (touch.clientX < rect.left + edgeZone) {
          startAutoScroll(-1); // scroll left
        }
      }

      // Highlight the column under the touch point using bounding rects (reliable on mobile)
      const colUnder = getColumnAtPoint(touch.clientX, touch.clientY);
      highlightColumn(colUnder);
      if (colUnder) {
        touchDragRef.current.lastColumnId = colUnder.getAttribute('data-column-id');
      }
    };

    // Native touchend — fires reliably even when React synthetic events are swallowed
    const handleTouchEnd = (e) => {
      // Stop auto-scroll
      if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null; }
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      // Prevent browser from generating synthetic mouse/click events after touch drop
      if (touchDragRef.current?.started) e.preventDefault();
      if (cardRef.current) {
        cardRef.current.style.transform = '';
        cardRef.current.style.transition = '';
        cardRef.current.style.touchAction = '';
        cardRef.current.style.opacity = '';
      }
      longPressArmedRef.current = false;
      const touch = e.changedTouches?.[0];
      finalizeTouchDrop(touch?.clientX ?? null, touch?.clientY ?? null);
    };

    // Native touchcancel — mobile browsers fire this instead of touchend when they take over the gesture
    const handleTouchCancel = () => {
      if (autoScrollRef.current) { cancelAnimationFrame(autoScrollRef.current); autoScrollRef.current = null; }
      if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
      if (cardRef.current) {
        cardRef.current.style.transform = '';
        cardRef.current.style.transition = '';
        cardRef.current.style.touchAction = '';
        cardRef.current.style.opacity = '';
      }
      longPressArmedRef.current = false;
      // touchcancel has no reliable coordinates — rely solely on lastColumnId
      finalizeTouchDrop(null, null);
    };

    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: false });
    el.addEventListener('touchcancel', handleTouchCancel);
    return () => {
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      el.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, []);

  return (
    <div
      ref={cardRef}
      draggable={!task.actionRunning}
      onDragStart={(e) => {
        if (task.actionRunning) { e.preventDefault(); return; }
        isDraggingRef.current = true;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('application/json', JSON.stringify({ agentId: task.agentId, taskId: task.id }));
        setTimeout(() => e.target.classList.add('opacity-40'), 0);
      }}
      onDragEnd={(e) => {
        e.target.classList.remove('opacity-40');
        // Reset after a tick so click doesn't fire after drop
        setTimeout(() => { isDraggingRef.current = false; }, 50);
      }}
      onTouchStart={(e) => {
        if (task.actionRunning) return; // Block touch drag for running tasks
        const touch = e.touches[0];
        const startX = touch.clientX;
        const startY = touch.clientY;
        longPressArmedRef.current = false;
        // Wait 500ms before arming drag — prevents accidental drags while allowing scroll
        longPressTimerRef.current = setTimeout(() => {
          longPressArmedRef.current = true;
          touchDragRef.current = {
            startX,
            startY,
            started: false,
            ghost: null,
            lastColumnId: null,
          };
          // Visual feedback: subtle scale pulse to indicate drag is armed
          if (cardRef.current) {
            cardRef.current.style.transform = 'scale(0.97)';
            cardRef.current.style.transition = 'transform 0.15s ease';
            cardRef.current.style.touchAction = 'none'; // Prevent browser from hijacking touch
          }
        }, 500);
      }}
      onClick={() => { if (!isDraggingRef.current) onOpen(task); }}
      className={`group/card bg-dark-800 rounded-lg border p-3 cursor-pointer
        transition-all hover:shadow-lg hover:shadow-black/20
        ${isError
          ? 'border-red-500/40 bg-red-500/5 hover:border-red-500/60'
          : today
            ? 'border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60 ring-1 ring-amber-500/20'
            : 'border-dark-700 hover:border-dark-500'
        }`}
    >
      {/* Task text */}
      <p className={`text-sm leading-snug mb-2.5 ${isError ? 'text-red-300' : 'text-dark-200'}`}
        style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {task.title || task.text}
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
        {task.priority && PRIORITY_MAP[task.priority] && (
          <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ring-1 ${PRIORITY_MAP[task.priority].cls}`}>
            <Flag className="w-2.5 h-2.5" />
            {PRIORITY_MAP[task.priority].label}
          </span>
        )}
        {showProject && task.project && (
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20">
            {task.project}
          </span>
        )}
        {showTaskType && task.taskType && TASK_TYPE_MAP[task.taskType] && (() => {
          const tt = TASK_TYPE_MAP[task.taskType];
          const Icon = tt.icon;
          return (
            <span className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium ring-1 ${tt.cls}`}>
              <Icon className="w-2.5 h-2.5" />
              {tt.label}
            </span>
          );
        })()}
        {showCreator && sourceMeta && (
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ring-1 ${sourceMeta.cls}`}>
            {sourceMeta.label(task.source)}
          </span>
        )}
        {showAgent && task.assigneeName && (
          <span
            className={`flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20${task.assignee && onNavigateToAgent ? ' cursor-pointer hover:bg-cyan-500/20 transition-colors' : ''}`}
            onClick={task.assignee && onNavigateToAgent ? (e) => { e.stopPropagation(); onNavigateToAgent(task.assignee); } : undefined}
            title={task.assignee && onNavigateToAgent ? `Open ${task.assigneeName}'s chat` : undefined}
          >
            <User className="w-2.5 h-2.5" />
            {`${task.assigneeIcon || ''} ${task.assigneeName}`.trim()}
          </span>
        )}
        {task.commits && task.commits.length > 0 && (
          <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20 cursor-pointer hover:bg-amber-500/20 transition-colors" onClick={(e) => { e.stopPropagation(); onOpenCommits?.(task); }}>
            <GitCommit className="w-2.5 h-2.5" />
            {task.commits.length}
          </span>
        )}
        {task.recurrence?.enabled && (
          <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/20">
            <Repeat className="w-2.5 h-2.5" />
            {task.recurrence.period === 'custom' ? `${task.recurrence.intervalMinutes}m` : task.recurrence.period}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs text-dark-500">
          <Clock className="w-3 h-3" />
          {timeAgo(task.createdAt)}
          {today && (
            <span className="flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25">
              <Sun className="w-2.5 h-2.5" />
              Today
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {task.actionRunning && (
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
          )}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
            {task.actionRunning ? (
              <button
                onClick={(e) => { e.stopPropagation(); onStop(task); }}
                className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                title="Stop action"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <>
                {task.assignee && onResume && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onResume(task); }}
                    className="p-1.5 rounded text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                    title="Resume task"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(task); }}
                  className="p-1.5 rounded text-dark-500 hover:text-red-400 hover:bg-dark-700 transition-colors"
                  title="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
