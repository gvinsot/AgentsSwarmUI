import { useCallback, useEffect, useRef, useState } from 'react';

type VoiceSessionState = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseVoiceSessionOptions {
  serverUrl: string;
  activeAgentId?: string | null;
}

interface VoiceSessionApi {
  state: VoiceSessionState;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendAgentContextUpdate: (agentId: string | null | undefined) => void;
}

export function useVoiceSession({ serverUrl, activeAgentId }: UseVoiceSessionOptions): VoiceSessionApi {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<VoiceSessionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const connectedRef = useRef(false);
  const latestAgentRef = useRef<string | null | undefined>(activeAgentId);

  useEffect(() => {
    latestAgentRef.current = activeAgentId;
  }, [activeAgentId]);

  const sendAgentContextUpdate = useCallback((agentId: string | null | undefined) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: 'voice.agent_context',
        agentId: agentId ?? null,
      })
    );
  }, []);

  const connect = useCallback(async () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setState('connecting');
    setError(null);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        connectedRef.current = true;
        setState('connected');
        sendAgentContextUpdate(latestAgentRef.current);
        resolve();
      };

      ws.onerror = () => {
        setState('error');
        setError('Voice connection failed');
        reject(new Error('Voice connection failed'));
      };

      ws.onclose = () => {
        connectedRef.current = false;
        setState('disconnected');
      };
    });
  }, [serverUrl, sendAgentContextUpdate]);

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      ws.close();
      wsRef.current = null;
    }
    connectedRef.current = false;
    setState('disconnected');
  }, []);

  useEffect(() => {
    if (state === 'connected') {
      sendAgentContextUpdate(activeAgentId);
    }
  }, [activeAgentId, state, sendAgentContextUpdate]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    state,
    error,
    connect,
    disconnect,
    sendAgentContextUpdate,
  };
}