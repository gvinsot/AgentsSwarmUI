import { useState, useRef, useEffect } from 'react';
import { X, Radio, Send, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function BroadcastPanel({ agents, socket, onClose }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [responses, setResponses] = useState([]);
  const [history, setHistory] = useState([]);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [responses, history]);

  useEffect(() => {
    if (!socket) return;

    const handleComplete = (data) => {
      setResponses(data.results || []);
      setSending(false);
    };

    const handleError = (data) => {
      console.error('Broadcast error:', data.error);
      setSending(false);
    };

    socket.on('broadcast:complete', handleComplete);
    socket.on('broadcast:error', handleError);

    return () => {
      socket.off('broadcast:complete', handleComplete);
      socket.off('broadcast:error', handleError);
    };
  }, [socket]);

  const handleBroadcast = () => {
    if (!message.trim() || sending || !socket) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);
    setResponses([]);

    // Store in history
    setHistory(prev => [...prev, { type: 'broadcast', message: msg, timestamp: new Date().toISOString() }]);

    socket.emit('broadcast:message', { message: msg });
  };

  return (
    <div className="border-b border-dark-700 bg-dark-900/50 animate-fadeIn">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-amber-400" />
            <h3 className="font-semibold text-dark-100 text-sm">Global Broadcast</h3>
            <span className="text-xs text-dark-400">(tmux-style — sends to all {agents.length} agents)</span>
          </div>
          <button onClick={onClose} className="p-1.5 text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input area */}
        <div className="flex gap-2 mb-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleBroadcast();
              }
            }}
            className="flex-1 px-4 py-2.5 bg-dark-800 border border-amber-500/30 rounded-xl text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-amber-500 resize-none"
            placeholder="Type a message to broadcast to all agents..."
            rows={2}
            disabled={sending}
          />
          <button
            onClick={handleBroadcast}
            disabled={sending || !message.trim() || agents.length === 0}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-dark-900 font-medium rounded-xl disabled:opacity-40 transition-colors flex items-center gap-2 self-end"
          >
            {sending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="hidden sm:inline">Broadcasting...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Broadcast</span>
              </>
            )}
          </button>
        </div>

        {/* Responses */}
        {responses.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-auto">
            <p className="text-xs text-dark-400 font-medium">Responses:</p>
            {responses.map((r, i) => (
              <div key={i} className={`p-3 rounded-lg border text-sm ${
                r.error
                  ? 'bg-red-500/5 border-red-500/20'
                  : 'bg-dark-800/50 border-dark-700/50'
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-dark-200">{r.agentName}</span>
                  {r.error && <span className="text-xs text-red-400">Error</span>}
                </div>
                {r.error ? (
                  <p className="text-xs text-red-400">{r.error}</p>
                ) : (
                  <div className="markdown-content text-xs text-dark-300">
                    <ReactMarkdown>{r.response}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Status */}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            Broadcasting to {agents.length} agents... Waiting for responses...
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
