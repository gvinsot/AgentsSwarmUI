import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';

const MODE_LABELS = { execute: 'Execution', refine: 'Refine', decide: 'Decide', title: 'Title', set_type: 'Set Type' };
const MODE_COLORS = { execute: 'text-blue-300', refine: 'text-violet-300', decide: 'text-amber-300', title: 'text-teal-300', set_type: 'text-pink-300' };
const MODE_ICON_COLORS = { execute: 'text-blue-400', refine: 'text-violet-400', decide: 'text-amber-400', title: 'text-teal-400', set_type: 'text-pink-400' };

export default function ExecutionLogEntry({ entry, index }) {
  const [expanded, setExpanded] = useState(false);
  const messages = entry.messages || [];
  const duration = entry.startedAt && entry.at
    ? Math.round((new Date(entry.at) - new Date(entry.startedAt)) / 1000)
    : null;
  const durationLabel = duration != null
    ? duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}m${duration % 60}s`
    : null;

  const modeKey = entry.mode || 'execute';
  const modeLabel = MODE_LABELS[modeKey] || 'Execution';

  return (
    <div className="flex-1 min-w-0">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded(o => !o); }}
        className="flex items-center gap-1.5 text-xs group/exec hover:opacity-80 transition-opacity w-full"
      >
        <MessageSquare className={`w-2.5 h-2.5 ${MODE_ICON_COLORS[modeKey] || 'text-blue-400'} flex-shrink-0`} />
        <span className={`font-medium ${entry.success ? (MODE_COLORS[modeKey] || 'text-blue-300') : 'text-red-300'}`}>
          {modeLabel} {entry.success ? '✓' : '✗'}
        </span>
        <span className="text-dark-500 truncate">by {entry.by}</span>
        {durationLabel && (
          <span className="text-[10px] text-dark-500 font-mono">({durationLabel})</span>
        )}
        {messages.length > 0 && (
          <span className="text-[10px] text-dark-500">
            — {messages.length} msg{messages.length > 1 ? 's' : ''}
          </span>
        )}
        {expanded
          ? <ChevronDown className="w-3 h-3 text-dark-500 flex-shrink-0 ml-auto" />
          : <ChevronRight className="w-3 h-3 text-dark-500 flex-shrink-0 ml-auto" />
        }
      </button>
      {expanded && messages.length > 0 && (
        <div className="mt-2 space-y-2 max-h-80 overflow-y-auto scrollbar-thin-dark">
          {messages.map((m, mi) => (
            <div key={mi} className={`rounded-lg p-2.5 text-xs leading-relaxed ${
              m.role === 'user'
                ? 'bg-blue-500/10 border border-blue-500/20'
                : 'bg-dark-700/60 border border-dark-600/50'
            }`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                  m.role === 'user' ? 'text-blue-400' : 'text-emerald-400'
                }`}>
                  {m.role === 'user' ? '→ Prompt' : '← Agent'}
                </span>
                {m.timestamp && (
                  <span className="text-[10px] text-dark-500">
                    {new Date(m.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <pre className="whitespace-pre-wrap break-words text-dark-300 font-sans">
                {m.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
