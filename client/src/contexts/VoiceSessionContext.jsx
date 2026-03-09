import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

const VoiceSessionContext = createContext(null);

const DEFAULT_TRANSCRIPTION_MODEL =
  import.meta.env.VITE_OPENAI_REALTIME_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

const DEFAULT_TURN_DETECTION = Object.freeze({
  type: 'semantic_vad',
  create_response: true,
  interrupt_response: true,
});

const DEFAULT_STATE = {
  status: 'disconnected',
  isMuted: false,
  currentTranscript: '',
  currentResponse: '',
  currentFunction: '',
  agentId: null,
};

function buildSessionUpdate(voice, transcriptionModel = DEFAULT_TRANSCRIPTION_MODEL) {
  return {
    type: 'session.update',
    session: {
      modalities: ['audio', 'text'],
      voice,
      input_audio_transcription: {
        model: transcriptionModel,
      },
      turn_detection: {
        ...DEFAULT_TURN_DETECTION,
      },
    },
  };
}

export function VoiceSessionProvider({ children, socket, agents }) {
  const [state, setState] = useState(DEFAULT_STATE);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const audioElRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const responseBufferRef = useRef('');
  const transcriptBufferRef = useRef('');
  const currentResponseIdRef = useRef(null);
  const currentItemIdRef = useRef(null);
  const activeAgentIdRef = useRef(null);

  const ensureAudioElement = useCallback(() => {
    if (audioElRef.current) return audioElRef.current;

    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    audio.muted = false;
    audio.volume = 1;
    audio.preload = 'auto';
    audio.style.display = 'none';
    audio.setAttribute('data-voice-output', 'true');
    document.body.appendChild(audio);

    audioElRef.current = audio;
    return audio;
  }, []);

  const playRemoteAudio = useCallback(async (stream) => {
    if (!stream) return;

    const audio = ensureAudioElement();

    if (audio.srcObject !== stream) {
      audio.srcObject = stream;
    }

    try {
      await audio.play();
    } catch (err) {
      console.error('Failed to autoplay remote voice audio:', err);
      setState(prev => ({
        ...prev,
        currentFunction: 'Audio reçu, mais le navigateur bloque la lecture. Vérifiez que l’onglet n’est pas muet.',
      }));
    }
  }, [ensureAudioElement]);

  const cleanupConnection = useCallback(() => {
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.getSenders().forEach(sender => sender.track?.stop?.());
      pcRef.current.close();
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => track.stop?.());
      remoteStreamRef.current = null;
    }

    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
    }

    responseBufferRef.current = '';
    transcriptBufferRef.current = '';
    currentResponseIdRef.current = null;
    currentItemIdRef.current = null;
    activeAgentIdRef.current = null;

    setState(DEFAULT_STATE);
  }, []);

  const sendToolResult = useCallback((event, output) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;

    dc.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: event.call_id,
        output: JSON.stringify(output),
      },
    }));

    dc.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  const handleToolCall = useCallback((event) => {
    if (!socket) return;
    const agentId = activeAgentIdRef.current;
    if (!agentId) return;

    let args = {};
    try {
      args = JSON.parse(event.arguments || '{}');
    } catch (err) {
      console.error('Failed to parse tool arguments:', err);
    }

    setState(prev => ({ ...prev, currentFunction: `${event.name}…` }));

    const emitResult = (channel, payload) => new Promise((resolve) => {
      socket.emit(channel, { agentId, ...payload });
      const resultEvent = `${channel}:result`;

      const onResult = (result) => {
        if (result.agentId !== agentId) return;
        socket.off(resultEvent, onResult);
        resolve(result);
      };

      socket.on(resultEvent, onResult);
    });

    switch (event.name) {
      case 'delegate': {
        emitResult('voice:delegate', {
          targetAgentName: args.agent_name,
          task: args.task,
        }).then((result) => {
          const output = result.error
            ? { success: false, error: result.error }
            : { success: true, result: result.result };
          setState(prev => ({
            ...prev,
            currentFunction: result.error
              ? `delegate failed: ${result.error}`
              : `delegated to ${args.agent_name}`,
          }));
          sendToolResult(event, output);
        });
        break;
      }

      case 'ask': {
        emitResult('voice:ask', {
          targetAgentName: args.agent_name,
          question: args.question,
        }).then((result) => {
          const output = result.error
            ? { success: false, error: result.error }
            : { success: true, result: result.result };
          setState(prev => ({
            ...prev,
            currentFunction: result.error
              ? `ask failed: ${result.error}`
              : `asked ${args.agent_name}`,
          }));
          sendToolResult(event, output);
        });
        break;
      }

      case 'assign_project':
      case 'get_project':
      case 'list_agents':
      case 'agent_status':
      case 'get_available_agent':
      case 'list_projects':
      case 'clear_context':
      case 'rollback':
      case 'stop_agent':
      case 'clear_all_chats':
      case 'clear_all_action_logs': {
        emitResult('voice:management', {
          functionName: event.name,
          arguments: args,
        }).then((result) => {
          const output = result.error
            ? { success: false, error: result.error }
            : { success: true, result: result.result };
          setState(prev => ({
            ...prev,
            currentFunction: result.error
              ? `${event.name} failed: ${result.error}`
              : `${event.name} complete`,
          }));
          sendToolResult(event, output);
        });
        break;
      }

      default:
        console.warn('Unhandled tool call:', event.name);
        sendToolResult(event, { success: false, error: `Unknown tool ${event.name}` });
    }
  }, [sendToolResult, socket]);

  const handleRealtimeEvent = useCallback((event) => {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        setState(prev => ({ ...prev, currentFunction: 'Listening…' }));
        break;

      case 'input_audio_buffer.speech_stopped':
        setState(prev => ({ ...prev, currentFunction: 'Processing speech…' }));
        break;

      case 'conversation.item.input_audio_transcription.completed':
        transcriptBufferRef.current = event.transcript || '';
        setState(prev => ({ ...prev, currentTranscript: transcriptBufferRef.current }));
        break;

      case 'conversation.item.input_audio_transcription.failed':
        setState(prev => ({
          ...prev,
          currentFunction: event.error?.message || 'Speech transcription failed.',
        }));
        break;

      case 'response.created':
        currentResponseIdRef.current = event.response?.id || null;
        responseBufferRef.current = '';
        setState(prev => ({ ...prev, currentResponse: '' }));
        break;

      case 'response.audio_transcript.delta':
        responseBufferRef.current += event.delta || '';
        setState(prev => ({ ...prev, currentResponse: responseBufferRef.current }));
        break;

      case 'response.audio_transcript.done':
        setState(prev => ({ ...prev, currentResponse: event.transcript || responseBufferRef.current }));
        break;

      case 'response.output_item.added':
        if (event.item?.type === 'function_call') {
          currentItemIdRef.current = event.item.id;
        }
        break;

      case 'response.function_call_arguments.done':
        handleToolCall(event);
        break;

      case 'output_audio_buffer.audio_started':
        setState(prev => ({ ...prev, currentFunction: 'Agent speaking…' }));
        break;

      case 'output_audio_buffer.audio_stopped':
        setState(prev => ({ ...prev, currentFunction: 'Response complete.' }));
        break;

      case 'response.done':
        currentResponseIdRef.current = null;
        currentItemIdRef.current = null;
        break;

      case 'error':
        console.error('Realtime error:', event);
        setState(prev => ({
          ...prev,
          status: 'error',
          currentFunction: event.error?.message || event.message || 'Realtime connection error.',
        }));
        break;

      default:
        break;
    }
  }, [handleToolCall]);

  const connect = useCallback(async (agentId) => {
    if (!agentId) return;

    cleanupConnection();
    setState({
      ...DEFAULT_STATE,
      status: 'connecting',
      agentId,
      currentFunction: 'Requesting microphone access…',
    });

    try {
      const { token, model, voice, transcriptionModel } = await api.getRealtimeToken(agentId);

      const audioEl = ensureAudioElement();
      audioEl.srcObject = null;

      const pc = new RTCPeerConnection();
      const remoteStream = new MediaStream();

      pcRef.current = pc;
      remoteStreamRef.current = remoteStream;
      activeAgentIdRef.current = agentId;

      pc.ontrack = (event) => {
        const stream = event.streams?.[0];

        if (stream) {
          stream.getTracks().forEach((track) => {
            if (!remoteStream.getTracks().some(existingTrack => existingTrack.id === track.id)) {
              remoteStream.addTrack(track);
            }
          });
        } else if (event.track && !remoteStream.getTracks().some(track => track.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }

        if (event.track) {
          event.track.onunmute = () => {
            playRemoteAudio(remoteStream).catch((err) => {
              console.error('Failed to play remote audio after unmute:', err);
            });
          };
        }

        playRemoteAudio(remoteStream).catch((err) => {
          console.error('Failed to attach remote audio stream:', err);
        });
      };

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      localStreamRef.current = localStream;

      const [microphoneTrack] = localStream.getAudioTracks();
      if (!microphoneTrack) {
        throw new Error('No microphone track is available.');
      }

      if (microphoneTrack.readyState !== 'live') {
        throw new Error('Microphone is not active.');
      }

      microphoneTrack.onended = () => {
        setState(prev => ({
          ...prev,
          status: 'error',
          currentFunction: 'Microphone disconnected.',
        }));
      };

      microphoneTrack.onmute = () => {
        setState(prev => ({
          ...prev,
          currentFunction: 'Microphone muted by browser.',
        }));
      };

      microphoneTrack.onunmute = () => {
        setState(prev => ({
          ...prev,
          currentFunction: prev.isMuted ? 'Microphone muted.' : 'Listening…',
        }));
      };

      pc.addTrack(microphoneTrack, localStream);

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      const applySessionUpdate = () => {
        if (dc.readyState !== 'open') return;

        setState(prev => ({
          ...prev,
          status: 'connected',
          agentId,
          currentFunction: prev.isMuted ? 'Microphone muted.' : 'Listening…',
        }));

        dc.send(JSON.stringify(buildSessionUpdate(voice, transcriptionModel)));
      };

      dc.onopen = applySessionUpdate;

      dc.onclose = () => {
        setState(prev => ({
          ...prev,
          status: prev.status === 'error' ? 'error' : 'disconnected',
        }));
      };

      dc.onerror = (event) => {
        console.error('Realtime data channel error:', event);
        setState(prev => ({
          ...prev,
          status: 'error',
          currentFunction: 'Realtime data channel error.',
        }));
      };

      dc.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data);
          handleRealtimeEvent(event);
        } catch (err) {
          console.error('Failed to parse Realtime event:', err);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && dc.readyState === 'open') {
          setState(prev => ({
            ...prev,
            status: 'connected',
          }));
        }

        if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'closed'
        ) {
          setState(prev => ({
            ...prev,
            status: pc.connectionState === 'failed' ? 'error' : 'disconnected',
            currentFunction:
              pc.connectionState === 'failed'
                ? 'Peer connection failed.'
                : prev.currentFunction,
          }));
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed') {
          setState(prev => ({
            ...prev,
            status: 'error',
            currentFunction: 'ICE connection failed.',
          }));
        }
      };

      setState(prev => ({
        ...prev,
        currentFunction: 'Microphone connected. Finishing realtime setup…',
      }));

      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      const realtimeBaseUrl = import.meta.env.VITE_OPENAI_REALTIME_URL || 'https://api.openai.com/v1/realtime';
      const sdpResponse = await fetch(`${realtimeBaseUrl}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/sdp',
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(`Realtime SDP exchange failed (${sdpResponse.status})`);
      }

      const answerSdp = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

      if (dc.readyState === 'open') {
        applySessionUpdate();
      }
    } catch (err) {
      console.error('Voice connection error:', err);
      cleanupConnection();
      setState(prev => ({
        ...prev,
        status: 'error',
        currentResponse: '',
        currentTranscript: '',
        currentFunction: err.message || 'Voice connection failed',
      }));
      throw err;
    }
  }, [cleanupConnection, ensureAudioElement, handleRealtimeEvent, playRemoteAudio]);

  const disconnect = useCallback(() => {
    cleanupConnection();
  }, [cleanupConnection]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    setState(prev => {
      const nextMuted = !prev.isMuted;
      stream.getAudioTracks().forEach(track => {
        track.enabled = !nextMuted;
      });

      return {
        ...prev,
        isMuted: nextMuted,
        currentFunction: nextMuted ? 'Microphone muted.' : 'Listening…',
      };
    });
  }, []);

  useEffect(() => {
    return () => {
      cleanupConnection();
      if (audioElRef.current) {
        audioElRef.current.remove();
        audioElRef.current = null;
      }
    };
  }, [cleanupConnection]);

  const value = useMemo(() => ({
    ...state,
    isConnected: state.status === 'connected',
    connect,
    disconnect,
    toggleMute,
  }), [connect, disconnect, state, toggleMute]);

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSession() {
  const context = useContext(VoiceSessionContext);
  if (!context) {
    throw new Error('useVoiceSession must be used within VoiceSessionProvider');
  }
  return context;
}