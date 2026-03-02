import { useEffect, useRef, useState } from 'react';

export default function VoiceChat({
  sessionId,
  agentId,
  onConnectionChange,
  preserveSessionOnAgentChange = false,
}) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const lastAgentRef = useRef(agentId);

  useEffect(() => {
    lastAgentRef.current = agentId;
  }, [agentId]);

  const connect = () => {
    if (!sessionId) return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws/voice?sessionId=${sessionId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      onConnectionChange?.(true);
      ws.send(JSON.stringify({ type: 'voice.agent_context', agentId: lastAgentRef.current ?? null }));
    };

    ws.onclose = () => {
      setConnected(false);
      onConnectionChange?.(false);
    };
  };

  const disconnect = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  useEffect(() => {
    if (!connected || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'voice.agent_context', agentId: agentId ?? null }));
  }, [agentId, connected]);

  useEffect(() => {
    return () => {
      if (!preserveSessionOnAgentChange && wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [preserveSessionOnAgentChange]);

  return (
    <div className="rounded-lg border border-slate-800 p-4">
      <div className="mb-3 text-sm text-slate-300">Voice: {connected ? 'connected' : 'disconnected'}</div>
      <div className="flex gap-2">
        <button className="rounded bg-emerald-600 px-3 py-2 text-sm" onClick={connect} disabled={connected}>
          Connect
        </button>
        <button className="rounded bg-rose-600 px-3 py-2 text-sm" onClick={disconnect} disabled={!connected}>
          Disconnect
        </button>
      </div>
    </div>
  );
}