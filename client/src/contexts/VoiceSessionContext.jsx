import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { api } from '../api';

export const STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  LISTENING: 'listening',
  SPEAKING: 'speaking',
  DELEGATING: 'delegating',
  ERROR: 'error',
};

export const STATUS_LABELS = {
  [STATUS.DISCONNECTED]: 'Disconnected',
  [STATUS.CONNECTING]: 'Connecting...',
  [STATUS.CONNECTED]: 'Connected — ready',
  [STATUS.LISTENING]: 'Listening...',
  [STATUS.SPEAKING]: 'Speaking...',
  [STATUS.DELEGATING]: 'Delegating...',
  [STATUS.ERROR]: 'Error',
};

// Management function names (non-async, quick operations)
const MANAGEMENT_FUNCTIONS = new Set([
  'assign_project', 'get_project', 'list_agents', 'agent_status',
  'get_available_agent', 'list_projects', 'clear_context', 'rollback',
  'stop_agent', 'clear_all_chats', 'clear_all_action_logs'
]);

const VoiceSessionContext = createContext(null);

export function VoiceSessionProvider({ socket, agents, children }) {
  const [status, setStatus] = useState(STATUS.DISCONNECTED);
  const [activeAgentId, setActiveAgentId] = useState(null);
  const [muted, setMuted] = useState(false);
  const [speakerOff, setSpeakerOff] = useState(false);
  const [error, setError] = useState(null);
  const [delegationTarget, setDelegationTarget] = useState(null);
  const [events, setEvents] = useState([]);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const audioRef = useRef(null);
  const localStreamRef = useRef(null);
  // Keep latest socket in a ref so callbacks always see the current value
  const socketRef = useRef(socket);
  // Keep latest activeAgentId in a ref for use inside callbacks
  const activeAgentIdRef = useRef(activeAgentId);

  useEffect(() => { socketRef.current = socket; }, [socket]);
  useEffect(() => { activeAgentIdRef.current = activeAgentId; }, [activeAgentId]);

  // ── Event timeline ─────────────────────────────────────────────────
  const addEvent = useCallback((type, text) => {
    setEvents(prev => [...prev, { type, text, time: new Date() }]);
  }, []);

  // ── Cleanup resources (internal) ───────────────────────────────────
  const cleanup = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  // ── Request microphone permission ──────────────────────────────────
  const requestMicPermission = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone access requires a secure connection (HTTPS).');
    }

    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permStatus = await navigator.permissions.query({ name: 'microphone' });
        if (permStatus.state === 'denied') {
          throw new Error(
            'Microphone access is blocked. Please open your browser settings and allow microphone access for this site, then try again.'
          );
        }
      } catch (permErr) {
        if (permErr.message.includes('blocked') || permErr.message.includes('settings')) {
          throw permErr;
        }
      }
    }

    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }, []);

  // ── Send function call output back to the Realtime model ──────────
  const sendFunctionOutput = useCallback((callId, output) => {
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: (output || '').slice(0, 4000)
        }
      }));
      dcRef.current.send(JSON.stringify({ type: 'response.create' }));
    }
  }, []);

  // ── Handle delegation function calls ───────────────────────────────
  const handleDelegation = useCallback((callId, agentName, task) => {
    setStatus(STATUS.DELEGATING);
    setDelegationTarget(agentName);
    addEvent('delegation', `Delegating to ${agentName}: ${task}`);

    const sock = socketRef.current;
    const agentId = activeAgentIdRef.current;
    if (sock) {
      sock.emit('voice:delegate', { agentId, targetAgentName: agentName, task });

      const handler = (data) => {
        if (data.agentId !== agentId) return;
        sock.off('voice:delegate:result', handler);
        setDelegationTarget(null);
        setStatus(STATUS.CONNECTED);
        const resultText = data.error ? `Error from ${agentName}: ${data.error}` : data.result || 'Task completed (no details)';
        addEvent('delegation-result', `${agentName}: ${resultText.slice(0, 200)}`);
        sendFunctionOutput(callId, resultText);
      };
      sock.on('voice:delegate:result', handler);
    }
  }, [addEvent, sendFunctionOutput]);

  // ── Handle ask function calls ──────────────────────────────────────
  const handleAsk = useCallback((callId, agentName, question) => {
    setStatus(STATUS.DELEGATING);
    setDelegationTarget(agentName);
    addEvent('ask', `Asking ${agentName}: ${question}`);

    const sock = socketRef.current;
    const agentId = activeAgentIdRef.current;
    if (sock) {
      sock.emit('voice:ask', { agentId, targetAgentName: agentName, question });

      const handler = (data) => {
        if (data.agentId !== agentId) return;
        sock.off('voice:ask:result', handler);
        setDelegationTarget(null);
        setStatus(STATUS.CONNECTED);
        const resultText = data.error ? `Error from ${agentName}: ${data.error}` : data.result || 'No answer';
        addEvent('ask-result', `${agentName}: ${resultText.slice(0, 200)}`);
        sendFunctionOutput(callId, resultText);
      };
      sock.on('voice:ask:result', handler);
    }
  }, [addEvent, sendFunctionOutput]);

  // ── Handle management function calls (quick sync operations) ───────
  const handleManagement = useCallback((callId, functionName, args) => {
    addEvent('management', `${functionName}(${JSON.stringify(args)})`);

    const sock = socketRef.current;
    const agentId = activeAgentIdRef.current;
    if (sock) {
      sock.emit('voice:management', { agentId, functionName, args });

      const handler = (data) => {
        if (data.agentId !== agentId || data.functionName !== functionName) return;
        sock.off('voice:management:result', handler);
        const resultText = data.error ? `Error: ${data.error}` : data.result || 'Done';
        addEvent('management-result', `${functionName}: ${resultText.slice(0, 200)}`);
        sendFunctionOutput(callId, resultText);
      };
      sock.on('voice:management:result', handler);
    }
  }, [addEvent, sendFunctionOutput]);

  // ── Handle events from the Realtime data channel ───────────────────
  const handleRealtimeEvent = useCallback((event) => {
    const type = event.type;

    if (type === 'input_audio_buffer.speech_started') {
      setStatus(STATUS.LISTENING);
    } else if (type === 'input_audio_buffer.speech_stopped') {
      setStatus(STATUS.CONNECTED);
    } else if (type === 'response.audio.delta') {
      setStatus(STATUS.SPEAKING);
    } else if (type === 'response.audio.done') {
      setStatus(STATUS.CONNECTED);
    } else if (type === 'response.function_call_arguments.done') {
      try {
        const args = JSON.parse(event.arguments);
        if (event.name === 'delegate') {
          handleDelegation(event.call_id, args.agent_name, args.task);
        } else if (event.name === 'ask') {
          handleAsk(event.call_id, args.agent_name, args.question);
        } else if (MANAGEMENT_FUNCTIONS.has(event.name)) {
          handleManagement(event.call_id, event.name, args);
        } else {
          console.warn('Unknown function call:', event.name);
        }
      } catch (err) {
        console.error('Failed to parse function call args:', err);
      }
    } else if (type === 'error') {
      setError(event.error?.message || 'Unknown error');
      addEvent('error', event.error?.message || 'Unknown error');
    }
  }, [addEvent, handleDelegation, handleAsk, handleManagement]);

  // ── Connect to OpenAI Realtime via WebRTC ──────────────────────────
  const connect = useCallback(async (agentId) => {
    // If already connected to this agent, do nothing
    if (activeAgentIdRef.current === agentId && pcRef.current) return;

    // If connected to another agent, disconnect first
    if (pcRef.current) {
      cleanup();
      setStatus(STATUS.DISCONNECTED);
      setEvents([]);
      setError(null);
      setDelegationTarget(null);
    }

    setStatus(STATUS.CONNECTING);
    setError(null);
    setActiveAgentId(agentId);

    try {
      // 1. Request microphone permission
      let stream;
      try {
        stream = await requestMicPermission();
      } catch (micErr) {
        const msg = micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError'
          ? 'Microphone access denied. Please allow microphone permission in your browser settings and try again.'
          : micErr.message;
        throw new Error(msg);
      }
      localStreamRef.current = stream;

      // 2. Get ephemeral token from our server
      const tokenData = await api.getRealtimeToken(agentId);
      const { token } = tokenData;

      // 3. Create RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 4. Handle remote audio track (model's voice)
      pc.ontrack = (e) => {
        if (audioRef.current) {
          audioRef.current.srcObject = e.streams[0];
        }
      };

      // 5. Monitor connection state for network drops
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          cleanup();
          setStatus(STATUS.DISCONNECTED);
          setActiveAgentId(null);
          addEvent('system', 'Connection lost');
        }
      };

      // 6. Add local microphone track
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // 7. Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        setStatus(STATUS.CONNECTED);
        addEvent('system', 'Connected to voice agent');
      };

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          handleRealtimeEvent(event);
        } catch (err) {
          console.warn('Failed to parse realtime event:', err);
        }
      };

      dc.onclose = () => {
        setStatus(STATUS.DISCONNECTED);
        setActiveAgentId(null);
        addEvent('system', 'Disconnected');
      };

      // 8. Create offer and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 9. Send SDP offer to OpenAI and get answer
      const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!sdpResponse.ok) {
        throw new Error(`WebRTC SDP exchange failed: ${sdpResponse.status}`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err) {
      console.error('Voice connect error:', err);
      setError(err.message);
      setStatus(STATUS.ERROR);
      addEvent('error', err.message);
      cleanup();
      setActiveAgentId(null);
    }
  }, [cleanup, requestMicPermission, handleRealtimeEvent, addEvent]);

  // ── Disconnect (explicit user action) ──────────────────────────────
  const disconnect = useCallback(() => {
    cleanup();
    setStatus(STATUS.DISCONNECTED);
    setActiveAgentId(null);
    setError(null);
    setDelegationTarget(null);
    addEvent('system', 'Session ended');
  }, [cleanup, addEvent]);

  // ── Toggle mute ────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const newMuted = !muted;
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !newMuted;
      });
      setMuted(newMuted);
    }
  }, [muted]);

  // ── Toggle speaker ─────────────────────────────────────────────────
  const toggleSpeaker = useCallback(() => {
    if (audioRef.current) {
      const newSpeakerOff = !speakerOff;
      audioRef.current.muted = newSpeakerOff;
      setSpeakerOff(newSpeakerOff);
    }
  }, [speakerOff]);

  // ── Reconnect ──────────────────────────────────────────────────────
  const reconnect = useCallback(() => {
    const agentId = activeAgentIdRef.current;
    if (agentId) {
      cleanup();
      setStatus(STATUS.DISCONNECTED);
      setError(null);
      setDelegationTarget(null);
      setEvents([]);
      // Small delay to let cleanup finish
      setTimeout(() => connect(agentId), 100);
    }
  }, [cleanup, connect]);

  // ── Auto-disconnect if active agent is deleted or no longer voice ──
  useEffect(() => {
    if (!activeAgentId || !agents) return;
    const agent = agents.find(a => a.id === activeAgentId);
    if (!agent || !agent.isVoice) {
      disconnect();
    }
  }, [agents, activeAgentId, disconnect]);

  // ── Auto-disconnect on socket loss (logout) ────────────────────────
  useEffect(() => {
    if (!socket && activeAgentId) {
      cleanup();
      setStatus(STATUS.DISCONNECTED);
      setActiveAgentId(null);
      setError(null);
      setDelegationTarget(null);
    }
  }, [socket, activeAgentId, cleanup]);

  // ── Derived values ─────────────────────────────────────────────────
  const isActive = status !== STATUS.DISCONNECTED && status !== STATUS.ERROR;

  const isSessionForAgent = useCallback((agentId) => {
    return activeAgentId === agentId;
  }, [activeAgentId]);

  const value = useMemo(() => ({
    status,
    activeAgentId,
    muted,
    speakerOff,
    error,
    delegationTarget,
    events,
    connect,
    disconnect,
    toggleMute,
    toggleSpeaker,
    reconnect,
    isActive,
    isSessionForAgent,
  }), [
    status, activeAgentId, muted, speakerOff, error, delegationTarget, events,
    connect, disconnect, toggleMute, toggleSpeaker, reconnect,
    isActive, isSessionForAgent,
  ]);

  return (
    <VoiceSessionContext.Provider value={value}>
      <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession() {
  const ctx = useContext(VoiceSessionContext);
  if (!ctx) throw new Error('useVoiceSession must be used within VoiceSessionProvider');
  return ctx;
}
