import {
  MessageSquare, Send, RotateCcw, StopCircle, ArrowDownToLine,
} from 'lucide-react';
import ChatMessage from './ChatMessage';
import { RichAssistantContent } from './ChatMessage';

export default function ChatTab({ history, thinking, streamBuffer, message, setMessage, sending, isBusy, onSend, onStop, onClear, onTruncate, chatEndRef, agentName, autoScroll, onToggleAutoScroll }) {
  // When streamBuffer is active, the last assistant message in history may be
  // a duplicate (agent:updated can arrive before the buffer is cleared).
  // Hide it to prevent a brief "doubled text" flash.
  const displayHistory = (streamBuffer && history.length > 0 && history[history.length - 1].role === 'assistant')
    ? history.slice(0, -1)
    : history;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {displayHistory.length === 0 && !streamBuffer && (
          <div className="text-center py-12 text-dark-500">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Start a conversation with {agentName}</p>
          </div>
        )}

        {displayHistory.map((msg, i) => (
          <ChatMessage key={i} message={msg} index={i} isLast={i === displayHistory.length - 1} onTruncate={onTruncate} />
        ))}

        {/* Thinking indicator (shown during reasoning before/alongside text) */}
        {thinking && !streamBuffer && (
          <div className="flex gap-3 animate-fadeIn">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0 text-xs text-white font-bold">
              AI
            </div>
            <div className="flex-1 bg-dark-800/50 rounded-xl p-3 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                <span className="text-xs text-amber-400 font-medium">Thinking...</span>
              </div>
              <div className="text-xs text-dark-400 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto">
                {thinking.slice(-500)}
              </div>
            </div>
          </div>
        )}

        {/* Streaming response */}
        {streamBuffer && (
          <div className="flex gap-3 animate-fadeIn">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-xs text-white font-bold">
              AI
            </div>
            <div className="flex-1 bg-dark-800/50 rounded-xl p-3 border border-dark-700/50">
              {thinking && (
                <details className="mb-2">
                  <summary className="text-xs text-amber-400 cursor-pointer hover:text-amber-300 flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Thinking...
                  </summary>
                  <div className="mt-1 text-xs text-dark-400 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto border-l-2 border-amber-500/30 pl-2">
                    {thinking.slice(-500)}
                  </div>
                </details>
              )}
              <div className="markdown-content text-sm text-dark-200">
                <RichAssistantContent text={streamBuffer} />
              </div>
              <div className="flex items-center gap-1 mt-2">
                <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" />
                <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1 h-1 rounded-full bg-indigo-500 animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-dark-700 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            className="p-2 text-dark-500 hover:text-red-400 hover:bg-dark-700 rounded-lg transition-colors flex-shrink-0"
            title="Clear history"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={onToggleAutoScroll}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${autoScroll ? 'text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20' : 'text-dark-500 hover:text-dark-300 hover:bg-dark-700'}`}
            title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
          >
            <ArrowDownToLine className="w-4 h-4" />
          </button>
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !sending) {
                  e.preventDefault();
                  onSend();
                }
              }}
              className="w-full px-4 py-2.5 bg-dark-800 border border-dark-600 rounded-xl text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500 resize-none"
              placeholder="Type a message... (Shift+Enter for new line)"
              rows={1}
              disabled={sending}
            />
          </div>
          {isBusy ? (
            <button
              onClick={onStop}
              className="p-2.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-xl transition-colors flex-shrink-0"
              title="Stop agent"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={sending || !message.trim()}
              className="p-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
