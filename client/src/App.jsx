import { useEffect, useMemo, useRef, useState } from 'react';
import AgentTabs from './components/AgentTabs';
import VoiceChat from './components/VoiceChat';
import { createSession, fetchAgents } from './api';
import { connectSocket } from './socket';

export default function App() {
  const [agents, setAgents] = useState([]);
  const [activeAgentId, setActiveAgentId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [voiceConnected, setVoiceConnected] = useState(false);

  const socketRef = useRef(null);
  const voiceSessionRef = useRef({
    connected: false,
    currentAgentId: null,
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [agentsData, session] = await Promise.all([fetchAgents(), createSession()]);
      if (!mounted) return;
      setAgents(agentsData || []);
      setSessionId(session?.id || null);
      if (agentsData?.length) {
        setActiveAgentId(agentsData[0].id);
        voiceSessionRef.current.currentAgentId = agentsData[0].id;
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    const socket = connectSocket(sessionId);
    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) || null,
    [agents, activeAgentId]
  );

  const handleAgentChange = (nextAgentId) => {
    setActiveAgentId(nextAgentId);

    if (voiceSessionRef.current.connected && socketRef.current) {
      socketRef.current.emit('voice:agent-context', { agentId: nextAgentId });
      voiceSessionRef.current.currentAgentId = nextAgentId;
    }
  };

  const handleVoiceStatusChange = (connected) => {
    voiceSessionRef.current.connected = connected;
    setVoiceConnected(connected);

    if (connected && socketRef.current && activeAgentId) {
      socketRef.current.emit('voice:agent-context', { agentId: activeAgentId });
      voiceSessionRef.current.currentAgentId = activeAgentId;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 p-4">
        <h1 className="text-xl font-semibold">Agents Swarm UI</h1>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
        <AgentTabs
          agents={agents}
          activeAgentId={activeAgentId}
          onChange={handleAgentChange}
          voiceConnected={voiceConnected}
        />

        <VoiceChat
          sessionId={sessionId}
          agentId={activeAgent?.id || null}
          onConnectionChange={handleVoiceStatusChange}
          preserveSessionOnAgentChange
        />
      </main>
    </div>
  );
}