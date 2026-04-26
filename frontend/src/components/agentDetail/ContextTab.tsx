import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, Trash2, FileText, ArrowRightLeft, AlertCircle, BarChart3 } from 'lucide-react';
import { api } from '../../api';

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.8);
}

export default function ContextTab({ agent, agents, socket, onRefresh }) {
  // RAG state
  const [showAdd, setShowAdd] = useState(false);
  const [docName, setDocName] = useState('');
  const [docContent, setDocContent] = useState('');

  // Handoff state
  const [targetId, setTargetId] = useState('');
  const [context, setContext] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const otherAgents = agents.filter(a => a.id !== agent.id && a.enabled !== false);

  // --- Stats ---
  const stats = useMemo(() => {
    const docs = agent.ragDocuments || [];
    const history = agent.conversationHistory || [];

    const docsChars = docs.reduce((sum, d) => sum + (d.content?.length || 0), 0);
    const docsTokens = estimateTokens('x'.repeat(docsChars));

    const historyChars = history.reduce((sum, m) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
      return sum + content.length;
    }, 0);
    const historyTokens = estimateTokens('x'.repeat(historyChars));

    const systemPromptEstimate = estimateTokens('x'.repeat(agent.systemPrompt?.length || 0));

    return {
      docsCount: docs.length,
      docsChars,
      docsTokens,
      historyMessages: history.length,
      historyChars,
      historyTokens,
      systemPromptTokens: systemPromptEstimate,
      totalTokens: docsTokens + historyTokens + systemPromptEstimate,
    };
  }, [agent.ragDocuments, agent.conversationHistory, agent.systemPrompt]);

  // --- RAG handlers ---
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
      setDocContent(ev.target?.result as string);
      setShowAdd(true);
    };
    reader.readAsText(file);
  };

  // --- Handoff handler ---
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
    } catch (err: any) {
      setResult({ success: false, error: err.message });
      setSending(false);
    }
  };

  const formatNumber = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

  return (
    <div className="p-4 space-y-6">
      {/* Context Stats */}
      <div>
        <h3 className="font-medium text-dark-200 text-sm flex items-center gap-2 mb-3">
          <BarChart3 className="w-4 h-4 text-indigo-400" />
          Context Stats
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-2.5 bg-dark-800/50 rounded-lg border border-dark-700/50 text-center">
            <p className="text-lg font-bold text-dark-100">{formatNumber(stats.totalTokens)}</p>
            <p className="text-[10px] text-dark-500 uppercase tracking-wider">Total tokens</p>
          </div>
          <div className="p-2.5 bg-dark-800/50 rounded-lg border border-dark-700/50 text-center">
            <p className="text-lg font-bold text-indigo-400">{formatNumber(stats.docsTokens)}</p>
            <p className="text-[10px] text-dark-500 uppercase tracking-wider">Documents ({stats.docsCount})</p>
          </div>
          <div className="p-2.5 bg-dark-800/50 rounded-lg border border-dark-700/50 text-center">
            <p className="text-lg font-bold text-emerald-400">{formatNumber(stats.historyTokens)}</p>
            <p className="text-[10px] text-dark-500 uppercase tracking-wider">Chat ({stats.historyMessages} msgs)</p>
          </div>
          <div className="p-2.5 bg-dark-800/50 rounded-lg border border-dark-700/50 text-center">
            <p className="text-lg font-bold text-amber-400">{formatNumber(stats.systemPromptTokens)}</p>
            <p className="text-[10px] text-dark-500 uppercase tracking-wider">System prompt</p>
          </div>
        </div>
      </div>

      {/* RAG Documents */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-dark-200 text-sm flex items-center gap-2">
            <FileText className="w-4 h-4 text-indigo-400" />
            Documents
            <span className="text-dark-400 font-normal">({agent.ragDocuments?.length || 0})</span>
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
          <div className="p-3 bg-dark-800/50 rounded-lg border border-dark-700/50 space-y-3 animate-fadeIn mb-3">
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
              <p className="text-[10px] text-dark-500 mt-1">
                {doc.content.length} chars · ~{formatNumber(estimateTokens(doc.content))} tokens · Added {new Date(doc.addedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>

        {(!agent.ragDocuments || agent.ragDocuments.length === 0) && !showAdd && (
          <div className="text-center py-6">
            <FileText className="w-7 h-7 mx-auto mb-2 text-dark-500 opacity-30" />
            <p className="text-dark-500 text-sm">No documents attached</p>
            <p className="text-dark-600 text-xs mt-1">Add reference documents for context-aware responses</p>
          </div>
        )}
      </div>

      {/* Handoff */}
      <div>
        <h3 className="font-medium text-dark-200 text-sm flex items-center gap-2 mb-3">
          <ArrowRightLeft className="w-4 h-4 text-indigo-400" />
          Handoff Conversation
        </h3>
        <p className="text-xs text-dark-400 mb-3">
          Transfer the conversation context from <strong>{agent.name}</strong> to another agent.
        </p>

        {otherAgents.length === 0 ? (
          <div className="text-center py-6">
            <ArrowRightLeft className="w-7 h-7 mx-auto mb-2 text-dark-500 opacity-30" />
            <p className="text-dark-500 text-sm">No other agents available for handoff</p>
          </div>
        ) : (
          <div className="space-y-3">
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
          </div>
        )}
      </div>
    </div>
  );
}
