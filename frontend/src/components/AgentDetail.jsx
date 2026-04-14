import { useState, useRef, useEffect } from 'react';
import {
  X, MessageSquare, FileText, ArrowRightLeft, Settings,
  StopCircle, FolderCode, Activity, Wrench, ArrowLeft,
} from 'lucide-react';
import { api } from '../api';
import VoiceChatTab from './VoiceChatTab';
import ChatTab from './agentDetail/ChatTab';
import PluginsTab from './agentDetail/PluginsTab';
import RagTab from './agentDetail/RagTab';
import HandoffTab from './agentDetail/HandoffTab';
import ActionLogsTab from './agentDetail/ActionLogsTab';
import SettingsTab from './agentDetail/SettingsTab';

// Re-export cleanToolSyntax so existing imports (e.g. BroadcastPanel) keep working
export { cleanToolSyntax } from './agentDetail/cleanToolSyntax';

const TABS = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'rag', label: 'RAG', icon: FileText },
  { id: 'handoff', label: 'Handoff', icon: ArrowRightLeft },
  { id: 'plugins', label: 'Plugins', icon: Wrench },
  { id: 'logs', label: 'Action Logs', icon: Activity },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function AgentDetail({ agent, agents, projects, skills, thinking, streamBuffer, socket, onClose, onSelectAgent, onRefresh, onActiveTabChange, requestedTab, userRole, currentUser }) {
  const [activeTab, setActiveTab] = useState('chat');

  // Notify parent of active tab changes
  const handleTabChange = (tabId) => {
    setActiveTab(tabId);
    onActiveTabChange?.(tabId);
  };

  // Notify parent of initial tab on mount
  useEffect(() => {
    onActiveTabChange?.('chat');
  }, []);

  // Handle requested tab from parent (e.g., from voice indicator navigation)
  useEffect(() => {
    if (requestedTab && requestedTab !== activeTab) {
      setActiveTab(requestedTab);
      onActiveTabChange?.(requestedTab);
    }
  }, [requestedTab]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false); // Ref-based guard to prevent double-sends
  const [history, setHistory] = useState(agent?.conversationHistory || []);
  const chatEndRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [currentProject, setCurrentProject] = useState(agent?.project || '');
  const [projectSaving, setProjectSaving] = useState(false);

  useEffect(() => {
    setCurrentProject(agent?.project || '');
  }, [agent?.id, agent?.project]);

  const handleProjectChange = async (project) => {
    setCurrentProject(project);
    setProjectSaving(true);

    try {
      await api.updateAgent(agent.id, { project });
      onRefresh();
      // Trigger background indexing of the new project folder
      if (project) {
        api.indexProject(project).catch(() => {});
      }
    } catch (err) {
      console.error(err);
      setCurrentProject(agent?.project || '');
    } finally {
      setProjectSaving(false);
    }
  };

  // Sync history from agent object (pushed via socket) instead of fetching from API.
  // This eliminates the flash between stream end and API response.
  useEffect(() => {
    if (agent?.conversationHistory) {
      setHistory(agent.conversationHistory);
    }
  }, [agent?.id, agent?.conversationHistory?.length]);

  // Auto-scroll chat
  useEffect(() => {
    if (autoScroll) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [history, streamBuffer, thinking, autoScroll]);

  // Release send guard when agent finishes processing (stream ends)
  useEffect(() => {
    if (sendingRef.current && agent?.status !== 'busy') {
      sendingRef.current = false;
      setSending(false);
    }
  }, [agent?.status]);

  const handleSend = async () => {
    if (!message.trim() || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    const msg = message.trim();
    setMessage('');

    // Use socket for streaming
    if (socket) {
      // Generate a unique message ID to allow server-side deduplication
      const messageId = `${agent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Use volatile.emit to prevent socket.io from buffering/replaying this event on reconnect
      (socket.volatile || socket).emit('agent:chat', { agentId: agent.id, message: msg, messageId });
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
      // Only release guard immediately for REST API path (no streaming)
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm('Clear all conversation history?')) return;
    await api.clearHistory(agent.id);
    setHistory([]);
    onRefresh();
  };

  const handleTruncateHistory = async (afterIndex) => {
    if (!confirm('Restart from this message? Everything after it will be deleted.')) return;
    const newHistory = await api.truncateHistory(agent.id, afterIndex);
    setHistory(newHistory);
    onRefresh();
  };

  return (
    <div className="flex flex-col h-full animate-slideIn">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile back button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 -ml-1 text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors flex-shrink-0"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {/* Mobile agent + project switchers */}
          <div className="lg:hidden flex items-center gap-2 min-w-0 flex-1">
            <select
              value={agent.id}
              onChange={(e) => onSelectAgent?.(e.target.value)}
              className="min-w-0 flex-1 px-2 py-1 bg-dark-800 border border-dark-600 rounded-lg text-sm font-bold text-dark-100 focus:outline-none focus:border-indigo-500 truncate appearance-none"
              title="Active agent"
            >
              {agents.filter(a => a.enabled !== false).map(a => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <FolderCode className="w-3.5 h-3.5 text-dark-500 flex-shrink-0" />
              <select
                value={currentProject}
                onChange={(e) => handleProjectChange(e.target.value)}
                disabled={projectSaving}
                className="min-w-0 flex-1 px-2 py-1 bg-dark-800 border border-dark-600 rounded-lg text-sm text-dark-100 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
                title="Working project"
              >
                <option value="">No project</option>
                {projects?.map(p => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Desktop: agent icon + name */}
          <span className="text-2xl flex-shrink-0 hidden lg:inline">{agent.icon}</span>
          <div className="min-w-0 hidden lg:block">
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
              {agent.isVoice && (
                <>
                  <span className="text-dark-500">·</span>
                  <span className="text-amber-400 font-medium">Voice</span>
                </>
              )}
              <span className="text-dark-500">·</span>
              <span className="text-dark-400 truncate">{agent.provider}/{agent.model}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Project selector — auto-saves (hidden on mobile) */}
          <div className="hidden lg:flex items-center gap-1.5">
            <FolderCode className="w-3.5 h-3.5 text-dark-500 flex-shrink-0" />
            <select
              value={currentProject}
              onChange={(e) => handleProjectChange(e.target.value)}
              disabled={projectSaving}
              className="px-2 py-1 bg-dark-800 border border-dark-600 rounded-lg text-xs text-dark-200 focus:outline-none focus:border-indigo-500 max-w-[160px] disabled:opacity-60"
              title="Working project"
            >
              <option value="">No project</option>
              {projects?.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
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
          <button onClick={onClose} className="hidden lg:block p-2 text-dark-400 hover:text-dark-100 hover:bg-dark-700 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-dark-700 px-2 overflow-x-auto">
        {TABS.filter(tab => !(userRole === 'basic' && tab.id === 'settings')).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
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
          agent.isVoice ? (
            <VoiceChatTab agent={agent} />
          ) : (
            <ChatTab
              history={history}
              thinking={thinking}
              streamBuffer={streamBuffer}
              message={message}
              setMessage={setMessage}
              sending={sending || agent.status === 'busy'}
              isBusy={agent.status === 'busy'}
              onSend={handleSend}
              onStop={() => socket?.emit('agent:stop', { agentId: agent.id })}
              onClear={handleClearHistory}
              onTruncate={handleTruncateHistory}
              chatEndRef={chatEndRef}
              agentName={agent.name}
              autoScroll={autoScroll}
              onToggleAutoScroll={() => setAutoScroll(s => !s)}
            />
          )
        )}
        {activeTab === 'rag' && (
          <RagTab agent={agent} onRefresh={onRefresh} />
        )}
        {activeTab === 'handoff' && (
          <HandoffTab agent={agent} agents={agents} socket={socket} onRefresh={onRefresh} />
        )}
        {activeTab === 'plugins' && (
          <PluginsTab agent={agent} plugins={skills} onRefresh={onRefresh} />
        )}
        {activeTab === 'logs' && (
          <ActionLogsTab agent={agent} onRefresh={onRefresh} />
        )}
        {activeTab === 'settings' && (
          <SettingsTab agent={agent} projects={projects} currentProject={currentProject} onRefresh={onRefresh} userRole={userRole} currentUser={currentUser} />
        )}
      </div>
    </div>
  );
}
