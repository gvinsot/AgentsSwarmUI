import { useState, useRef, useEffect } from 'react';
import {
  X, Send, Trash2, Plus, Settings, MessageSquare,
  CheckSquare, FileText, ArrowRightLeft, RotateCcw,
  ChevronDown, ChevronRight, Edit3, Save, Clock, Zap, AlertCircle, FolderCode, StopCircle, Terminal, Users
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';

const TABS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'todos', label: 'Tasks', icon: CheckSquare },
  { id: 'rag', label: 'RAG', icon: FileText },
  { id: 'handoff', label: 'Handoff', icon: ArrowRightLeft },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function AgentDetail({ agent, agents, projects, thinking, streamBuffer, socket, onClose, onRefresh }) {
  const [activeTab, setActiveTab] = useState('chat');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState([]);
  const chatEndRef = useRef(null);

  // Load history when agent changes
  useEffect(() => {
    if (agent?.id) {
      api.getHistory(agent.id).then(setHistory).catch(() => setHistory([]));
    }
  }, [agent?.id, agent?.metrics?.totalMessages]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, streamBuffer, thinking]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    const msg = message.trim();
    setMessage('');
    setSending(true);

    // Use socket for streaming
    if (socket) {
      socket.emit('agent:chat', { agentId: agent.id, message: msg });
      // Optimistically add user message to history
      setHistory(prev => [...prev, { role: 'user', content: msg, timestamp: new Date().toISOString() }]);
    } else {
      try {
        const result = await api.chatAgent(agent.id, msg);
        setHistory(prev => [
          ...prev,
          { role: 'user', content: msg, timestamp: new Date().toISOString() },
          { role: 'assistant', content: result.response, timestamp: new Date().toISOString() }
        ]);
      } catch (err) {
        console.error(err);
      }
    }
    setSending(false);
  };

  const handleClearHistory = async () => {
    if (!confirm('Clear all conversation history?')) return;
    await api.clearHistory(agent.id);
    setHistory([]);
    onRefresh();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] animate-slideIn">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{agent.icon}</span>
          <div>
            <h2 className="font-bold text-dark-100">{agent.name}</h2>
            <div className="flex items-center gap-2 text-xs">
              <span className={`inline-flex items-center gap-1 ${
                agent.status === 'busy' ? 'text-amber-400' :
                agent.status === 'error' ? 'text-red-400' : 'text-emerald-400'
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  agent.status === 'busy' ? 'bg-amber-500 animate-pulse' :
                  agent.status === 'error' ? 'bg-red-500' : 'bg-emerald-500'
                }`} />
                {agent.status}
              </span>
              <span className="text-dark-500">·</span>
              <span className="text-dark-400">{agent.provider}/{agent.model}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'busy' && socket && (
            <button
              onClick={() => socket.emit('agent:stop', { agentId: agent.id })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-sm font-medium"
              title="Stop agent"
            >
              <StopCircle className="w-4 h-4" />
              Stop
            </button>
          )}
          <button onClick={onClose} className="p-2 text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-700 px-2 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-dark-400 hover:text-dark-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'chat' && (
          <ChatTab
            history={history}
            thinking={thinking}
            streamBuffer={streamBuffer}
            message={message}
            setMessage={setMessage}
            sending={sending || agent.status === 'busy'}
            onSend={handleSend}
            onClear={handleClearHistory}
            chatEndRef={chatEndRef}
            agentName={agent.name}
          />
        )}
        {activeTab === 'todos' && (
          <TodoTab agent={agent} onRefresh={onRefresh} />
        )}
        {activeTab === 'rag' && (
          <RagTab agent={agent} onRefresh={onRefresh} />
        )}
        {activeTab === 'handoff' && (
          <HandoffTab agent={agent} agents={agents} socket={socket} onRefresh={onRefresh} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab agent={agent} projects={projects} onRefresh={onRefresh} />
        )}
      </div>
    </div>
  );
}

// ─── Chat Tab ──────────────────────────────────────────────────────────────
function ChatTab({ history, thinking, streamBuffer, message, setMessage, sending, onSend, onClear, chatEndRef, agentName }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {history.length === 0 && !streamBuffer && (
          <div className="text-center py-12 text-dark-500">
            <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Start a conversation with {agentName}</p>
          </div>
        )}

        {history.map((msg, i) => (
          <ChatMessage key={i} message={msg} />
        ))}

        {/* Streaming response */}
        {streamBuffer && (
          <div className="flex gap-3 animate-fadeIn">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0 text-xs text-white font-bold">
              AI
            </div>
            <div className="flex-1 bg-dark-800/50 rounded-xl p-3 border border-dark-700/50">
              <div className="markdown-content text-sm text-dark-200">
                <ReactMarkdown>{streamBuffer}</ReactMarkdown>
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
          <div className="flex-1 relative">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
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
          <button
            onClick={onSend}
            disabled={sending || !message.trim()}
            className="p-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isToolResult = message.type === 'tool-result'
    || (!message.type && isUser && message.content?.startsWith('[TOOL RESULTS]'));
  const isDelegationResult = message.type === 'delegation-result'
    || (!message.type && isUser && message.content?.startsWith('[DELEGATION RESULTS]'));
  const isSystemMessage = isToolResult || isDelegationResult;

  // Render tool/delegation results as a collapsible sub-element
  if (isSystemMessage) {
    return isToolResult
      ? <ToolResultMessage message={message} />
      : <DelegationResultMessage message={message} />;
  }

  return (
    <div className={`flex gap-3 ${isUser ? '' : ''}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold ${
        isUser
          ? 'bg-dark-700 text-dark-300'
          : 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white'
      }`}>
        {isUser ? 'You' : 'AI'}
      </div>
      <div className={`flex-1 rounded-xl p-3 ${
        isUser ? 'bg-dark-700/50 border border-dark-600/50' : 'bg-dark-800/50 border border-dark-700/50'
      }`}>
        <div className="markdown-content text-sm text-dark-200">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {message.timestamp && (
          <p className="text-[10px] text-dark-500 mt-2 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {new Date(message.timestamp).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}

// Parse legacy tool results from raw [TOOL RESULTS] message content
function parseLegacyToolResults(content) {
  const results = [];
  const pattern = /---\s*(\w+)\(([^)]*)\)\s*---\n([\s\S]*?)(?=\n---\s*\w+\(|$)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const output = m[3].trim();
    const isError = output.startsWith('ERROR:');
    results.push({
      tool: m[1],
      args: [m[2]],
      success: !isError,
      result: isError ? undefined : output,
      error: isError ? output.replace(/^ERROR:\s*/, '') : undefined
    });
  }
  return results;
}

// Parse legacy delegation results from raw [DELEGATION RESULTS] message content
function parseLegacyDelegationResults(content) {
  const results = [];
  const pattern = /---\s*Response from\s+(.+?)\s*---\n([\s\S]*?)(?=\n---\s*Response from|$)/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    results.push({ agentName: m[1].trim(), response: m[2].trim(), error: null });
  }
  return results;
}

// ─── Tool Result Collapsible Message ───────────────────────────────────────
function ToolResultMessage({ message }) {
  const [expanded, setExpanded] = useState(false);
  const results = message.toolResults?.length
    ? message.toolResults
    : parseLegacyToolResults(message.content || '');
  const successCount = results.filter(r => r.success).length;
  const errorCount = results.filter(r => !r.success).length;

  return (
    <div className="mx-2 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg bg-dark-800/70 border border-dark-700/50 hover:border-dark-600 transition-colors text-left group"
      >
        <Terminal className="w-4 h-4 text-amber-400 flex-shrink-0" />
        <span className="text-xs font-medium text-dark-300 flex-1">
          {results.length} tool call{results.length !== 1 ? 's' : ''} executed
          {successCount > 0 && <span className="text-emerald-400 ml-1.5">{successCount} passed</span>}
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
            <ToolResultItem key={i} result={r} />
          ))}
        </div>
      )}
    </div>
  );
}

function ToolResultItem({ result }) {
  const [showOutput, setShowOutput] = useState(false);
  const argSummary = (result.args || []).map(a => typeof a === 'string' && a.length > 60 ? a.slice(0, 60) + '...' : a).join(', ');
  const output = result.success ? result.result : result.error;

  return (
    <div className="text-xs">
      <button
        onClick={() => setShowOutput(!showOutput)}
        className="flex items-center gap-1.5 text-dark-400 hover:text-dark-200 transition-colors w-full text-left"
      >
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${result.success ? 'bg-emerald-500' : 'bg-red-500'}`} />
        <code className="text-dark-300 font-mono">@{result.tool}({argSummary})</code>
        {output && (showOutput
          ? <ChevronDown className="w-3 h-3 ml-auto flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 ml-auto flex-shrink-0" />
        )}
      </button>
      {showOutput && output && (
        <pre className="mt-1 ml-3 p-2 rounded bg-dark-900/80 border border-dark-700/50 text-[11px] text-dark-400 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
          {typeof output === 'string' ? output.slice(0, 3000) : JSON.stringify(output, null, 2).slice(0, 3000)}
        </pre>
      )}
    </div>
  );
}

// ─── Delegation Result Collapsible Message ─────────────────────────────────
function DelegationResultMessage({ message }) {
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

// ─── Todo Tab ──────────────────────────────────────────────────────────────
function TodoTab({ agent, onRefresh }) {
  const [newTodo, setNewTodo] = useState('');

  const handleAdd = async () => {
    if (!newTodo.trim()) return;
    await api.addTodo(agent.id, newTodo.trim());
    setNewTodo('');
    onRefresh();
  };

  const handleToggle = async (todoId) => {
    await api.toggleTodo(agent.id, todoId);
    onRefresh();
  };

  const handleDelete = async (todoId) => {
    await api.deleteTodo(agent.id, todoId);
    onRefresh();
  };

  const done = agent.todoList?.filter(t => t.done).length || 0;
  const total = agent.todoList?.length || 0;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-dark-200 text-sm">Task List</h3>
        {total > 0 && (
          <span className="text-xs text-dark-400">
            {done}/{total} completed
          </span>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="w-full bg-dark-700 rounded-full h-1.5">
          <div
            className="bg-indigo-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      )}

      {/* Add todo */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newTodo}
          onChange={(e) => setNewTodo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="flex-1 px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500"
          placeholder="Add a new task..."
        />
        <button
          onClick={handleAdd}
          disabled={!newTodo.trim()}
          className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-40 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Todo list */}
      <div className="space-y-2">
        {(agent.todoList || []).map(todo => (
          <div key={todo.id} className="flex items-center gap-3 px-3 py-2 bg-dark-800/50 rounded-lg border border-dark-700/50 group">
            <button
              onClick={() => handleToggle(todo.id)}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                todo.done
                  ? 'bg-indigo-500 border-indigo-500 text-white'
                  : 'border-dark-500 hover:border-indigo-400'
              }`}
            >
              {todo.done && <span className="text-xs">✓</span>}
            </button>
            <span className={`flex-1 text-sm ${todo.done ? 'line-through text-dark-500' : 'text-dark-200'}`}>
              {todo.text}
            </span>
            <button
              onClick={() => handleDelete(todo.id)}
              className="p-1 text-dark-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {total === 0 && (
        <p className="text-center text-dark-500 text-sm py-8">No tasks yet</p>
      )}
    </div>
  );
}

// ─── RAG Tab ───────────────────────────────────────────────────────────────
function RagTab({ agent, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false);
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');

  const handleAdd = async () => {
    if (!docName.trim() || !docContent.trim()) return;
    await api.addRagDoc(agent.id, docName.trim(), docContent.trim());
    setDocName('');
    setDocContent('');
    setShowAdd(false);
    onRefresh();
  };

  const handleDelete = async (docId) => {
    if (!confirm('Remove this document?')) return;
    await api.deleteRagDoc(agent.id, docId);
    onRefresh();
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setDocName(file.name);
      setDocContent(ev.target.result);
      setShowAdd(true);
    };
    reader.readAsText(file);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-dark-200 text-sm">
          RAG Documents
          <span className="ml-2 text-dark-400 font-normal">({agent.ragDocuments?.length || 0})</span>
        </h3>
        <div className="flex gap-2">
          <label className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-200 rounded-lg text-xs cursor-pointer transition-colors">
            Upload File
            <input type="file" className="hidden" accept=".txt,.md,.json,.csv,.xml,.yaml,.yml" onChange={handleFileUpload} />
          </label>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="p-3 bg-dark-800/50 rounded-lg border border-dark-700/50 space-y-3 animate-fadeIn">
          <input
            type="text"
            value={docName}
            onChange={(e) => setDocName(e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500"
            placeholder="Document name"
          />
          <textarea
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-indigo-500 font-mono resize-none"
            placeholder="Document content..."
            rows={6}
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-dark-400 hover:text-dark-200 text-sm">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!docName.trim() || !docContent.trim()}
              className="px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm disabled:opacity-40"
            >
              Add Document
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {(agent.ragDocuments || []).map(doc => (
          <div key={doc.id} className="p-3 bg-dark-800/50 rounded-lg border border-dark-700/50 group">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-medium text-dark-200">{doc.name}</span>
              </div>
              <button
                onClick={() => handleDelete(doc.id)}
                className="p-1 text-dark-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-dark-400 font-mono line-clamp-3">{doc.content}</p>
            <p className="text-[10px] text-dark-500 mt-1">{doc.content.length} chars · Added {new Date(doc.addedAt).toLocaleDateString()}</p>
          </div>
        ))}
      </div>

      {(!agent.ragDocuments || agent.ragDocuments.length === 0) && !showAdd && (
        <div className="text-center py-8">
          <FileText className="w-8 h-8 mx-auto mb-2 text-dark-500 opacity-30" />
          <p className="text-dark-500 text-sm">No documents attached</p>
          <p className="text-dark-600 text-xs mt-1">Add reference documents for context-aware responses</p>
        </div>
      )}
    </div>
  );
}

// ─── Handoff Tab ───────────────────────────────────────────────────────────
function HandoffTab({ agent, agents, socket, onRefresh }) {
  const [targetId, setTargetId] = useState('');
  const [context, setContext] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const otherAgents = agents.filter(a => a.id !== agent.id);

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

// ─── Settings Tab ──────────────────────────────────────────────────────────
function SettingsTab({ agent, projects, onRefresh }) {
  const [form, setForm] = useState({
    name: agent.name,
    role: agent.role,
    description: agent.description,
    instructions: agent.instructions,
    temperature: agent.temperature,
    maxTokens: agent.maxTokens,
    provider: agent.provider,
    model: agent.model,
    endpoint: agent.endpoint || '',
    icon: agent.icon,
    color: agent.color,
    project: agent.project || '',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form when switching agents
  useEffect(() => {
    setForm({
      name: agent.name,
      role: agent.role,
      description: agent.description,
      instructions: agent.instructions,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens,
      provider: agent.provider,
      model: agent.model,
      endpoint: agent.endpoint || '',
      icon: agent.icon,
      color: agent.color,
      project: agent.project || '',
    });
    setSaved(false);
  }, [agent.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.updateAgent(agent.id, form);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete agent "${agent.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteAgent(agent.id);
      onRefresh();
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  const updateField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-dark-400 mb-1.5">Name</label>
          <input
            type="text" value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Role</label>
          <input
            type="text" value={form.role}
            onChange={(e) => updateField('role', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Icon</label>
          <input
            type="text" value={form.icon}
            onChange={(e) => updateField('icon', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
            maxLength={4}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-dark-400 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => updateField('description', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 resize-none"
            rows={2}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-dark-400 mb-1.5">System Instructions</label>
          <textarea
            value={form.instructions}
            onChange={(e) => updateField('instructions', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 font-mono resize-none"
            rows={6}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-dark-400 mb-1.5 flex items-center gap-1.5">
            <FolderCode className="w-3.5 h-3.5" /> Working Project
          </label>
          <select
            value={form.project}
            onChange={(e) => updateField('project', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
          >
            <option value="">No project selected</option>
            {projects?.map(p => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Provider</label>
          <select
            value={form.provider}
            onChange={(e) => updateField('provider', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
          >
            <option value="ollama">Ollama</option>
            <option value="claude">Claude</option>
            <option value="openai">OpenAI</option>
            <option value="vllm">vLLM (Custom Server)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Model</label>
          <input
            type="text" value={form.model}
            onChange={(e) => updateField('model', e.target.value)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
          />
        </div>
        {form.provider === 'ollama' && (
          <div className="col-span-2">
            <label className="block text-xs text-dark-400 mb-1.5">Endpoint URL</label>
            <input
              type="text" value={form.endpoint}
              onChange={(e) => updateField('endpoint', e.target.value)}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
              placeholder="https://..."
            />
          </div>
        )}
        {form.provider === 'vllm' && (
          <>
            <div className="col-span-2">
              <label className="block text-xs text-dark-400 mb-1.5">Server URL *</label>
              <input
                type="text" value={form.endpoint}
                onChange={(e) => updateField('endpoint', e.target.value)}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                placeholder="http://localhost:8000"
              />
              <p className="text-[11px] text-dark-500 mt-1">Base URL of your vLLM server (OpenAI-compatible API)</p>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-dark-400 mb-1.5">API Key (optional)</label>
              <input
                type="password" value={form.apiKey || ''}
                onChange={(e) => updateField('apiKey', e.target.value)}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 font-mono text-xs"
                placeholder="token-..."
              />
              <p className="text-[11px] text-dark-500 mt-1">Leave blank if your vLLM server doesn't require authentication</p>
            </div>
          </>
        )}
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Temperature: {form.temperature}</label>
          <input
            type="range" min="0" max="1" step="0.1" value={form.temperature}
            onChange={(e) => updateField('temperature', parseFloat(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Max Tokens</label>
          <input
            type="number" value={form.maxTokens}
            onChange={(e) => updateField('maxTokens', parseInt(e.target.value) || 4096)}
            className="w-full px-3 py-2 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs text-dark-400 mb-1.5">Color</label>
          <input
            type="color" value={form.color}
            onChange={(e) => updateField('color', e.target.value)}
            className="h-9 w-full rounded-lg border border-dark-600 cursor-pointer bg-dark-800"
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="p-3 bg-dark-800/50 rounded-lg border border-dark-700/50">
        <h4 className="text-xs font-medium text-dark-300 mb-2">Metrics</h4>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <p className="text-dark-500">Messages</p>
            <p className="font-mono text-dark-200">{agent.metrics?.totalMessages || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Tokens In</p>
            <p className="font-mono text-dark-200">{agent.metrics?.totalTokensIn || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Tokens Out</p>
            <p className="font-mono text-dark-200">{agent.metrics?.totalTokensOut || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Errors</p>
            <p className="font-mono text-dark-200">{agent.metrics?.errors || 0}</p>
          </div>
          <div>
            <p className="text-dark-500">Last Active</p>
            <p className="font-mono text-dark-200 text-[10px]">
              {agent.metrics?.lastActiveAt ? new Date(agent.metrics.lastActiveAt).toLocaleTimeString() : 'Never'}
            </p>
          </div>
          <div>
            <p className="text-dark-500">Created</p>
            <p className="font-mono text-dark-200 text-[10px]">
              {new Date(agent.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : saved ? (
            <>
              <span className="text-emerald-300">✓</span> Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Save Changes
            </>
          )}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
