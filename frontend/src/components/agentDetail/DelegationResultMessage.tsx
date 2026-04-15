import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';

// Parse legacy delegation results from raw [DELEGATION RESULTS] message content
export function parseLegacyDelegationResults(content) {
  const results = [];
  const pattern = /---\s*Response from\s+(.+?)\s*---\n([\s\S]*?)(?=\n---\s*Response from|$)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    results.push({ agentName: m[1].trim(), response: m[2].trim(), error: null });
  }
  return results;
}

function DelegationResultItem({ result }) {
  const [showDetail, setShowDetail] = useState(false);
  const output = result.response || result.error;

  return (
    <div className="text-xs">
      <button
        onClick={() => setShowDetail(!showDetail)}
        className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 transition-colors w-full text-left"
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${result.error ? 'bg-red-500' : 'bg-emerald-500'}`} />
        <span className="text-dark-300 font-medium">{result.agentName}</span>
        {result.task && <span className="text-dark-500 truncate max-w-[200px]">— {result.task.slice(0, 80)}</span>}
        {output && (showDetail
          ? <ChevronDown className="w-3 h-3 ml-auto flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" />
        )}
      </button>
      {showDetail && output && (
        <div className="mt-1 ml-3 p-2 rounded bg-dark-900/80 border border-dark-700/50 text-[11px] text-dark-400 overflow-x-auto max-h-48 overflow-y-auto">
          <ReactMarkdown>{typeof output === 'string' ? output.slice(0, 5000) : JSON.stringify(output, null, 2)}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

// ─── Delegation Result Collapsible Message ─────────────────────────────────
export default function DelegationResultMessage({ message }) {
  const [expanded, setExpanded] = useState(false);
  const results = message.delegationResults?.length
    ? message.delegationResults
    : parseLegacyDelegationResults(message.content || '');
  const successCount = results.filter(r => r.response && !r.error).length;
  const errorCount = results.filter(r => r.error).length;

  return (
    <div className="mx-2 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-dark-800/70 border border-dark-700/50 hover:border-dark-600 transition-colors text-left group"
      >
        <Users className="w-4 h-4 text-indigo-400 flex-shrink-0" />
        <span className="text-xs font-medium text-dark-300 flex-1">
          {results.length} delegation{results.length !== 1 ? 's' : ''} completed
          {successCount > 0 && <span className="text-emerald-400 ml-1.5">{successCount} succeeded</span>}
          {errorCount > 0 && <span className="text-red-400 ml-1.5">{errorCount} failed</span>}
        </span>
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-dark-500 group-hover:text-dark-300 transition-colors" />
          : <ChevronRight className="w-3.5 h-3.5 text-dark-500 group-hover:text-dark-300 transition-colors" />
        }
      </button>
      {expanded && (
        <div className="mt-1 ml-3 border-l-2 border-dark-700 pl-3 space-y-2 py-1">
          {results.map((r, i) => (
            <DelegationResultItem key={i} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}
