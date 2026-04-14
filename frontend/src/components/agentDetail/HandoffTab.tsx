import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ArrowRightLeft, AlertCircle } from 'lucide-react';
import { api } from '../../api';

export default function HandoffTab({ agent, agents, socket, onRefresh }) {
  const [targetId, setTargetId] = useState('');
  const [context, setContext] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const otherAgents = agents.filter(a => a.id !== agent.id && a.enabled !== false);

  const handleHandoff = async () => {
    if (!targetId || !context.trim()) return;
    setSending(true);
    setResult(null);

    try {
      if (socket) {
        socket.emit('agent:handoff', { fromId: agent.id, toId: targetId, context: context.trim() });
        socket.once('agent:handoff:complete', (data) => {
          setResult({ success: true, response: data.response });
          setSending(false);
        });
        socket.once('agent:handoff:error', (data) => {
          setResult({ success: false, error: data.error });
          setSending(false);
        });
      } else {
        const res = await api.handoff(agent.id, targetId, context.trim());
        setResult({ success: true, response: res.response });
        setSending(false);
      }
    } catch (err) {
      setResult({ success: false, error: err.message });
      setSending(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h3 className="font-medium text-dark-200 text-sm">Handoff Conversation</h3>
      <p className="text-xs text-dark-400">
        Transfer the conversation context from <strong>{agent.name}</strong> to another agent.
      </p>

      {otherAgents.length === 0 ? (
        <div className="text-center py-8">
          <ArrowRightLeft className="w-8 h-8 mx-auto mb-2 text-dark-500 opacity-30" />
          <p className="text-dark-500 text-sm">No other agents available for handoff</p>
        </div>
      ) : (
        <>
          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Target Agent</label>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select an agent...</option>
              {otherAgents.map(a => (
                <option key={a.id} value={a.id}>{a.icon} {a.name} ({a.role})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-dark-400 mb-1.5">Handoff Context</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Describe what the next agent should continue working on..."
              rows={4}
            />
          </div>

          <button
            onClick={handleHandoff}
            disabled={sending || !targetId || !context.trim()}
            className="w-full py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {sending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Handing off...
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-4 h-4" />
                Initiate Handoff
              </>
            )}
          </button>

          {result && (
            <div className={`p-3 rounded-lg border text-sm animate-fadeIn ${
              result.success
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}>
              {result.success ? (
                <div>
                  <p className="font-medium mb-1">Handoff successful!</p>
                  <div className="text-dark-300 markdown-content">
                    <ReactMarkdown>{result.response}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  {result.error}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
