import React from 'react';
import { useVoiceSession } from '../hooks/useVoiceSession';
import { useAppContext } from '../context/AppContext';

export default function VoiceControls() {
  const { selectedAgentId } = useAppContext();
  const { state, error, connect, disconnect } = useVoiceSession({
    serverUrl: `${window.location.origin.replace(/^http/, 'ws')}/ws/voice`,
    activeAgentId: selectedAgentId,
  });

  return (
    <div className="voice-controls">
      <button onClick={connect} disabled={state === 'connecting' || state === 'connected'}>
        {state === 'connecting' ? 'Connecting…' : state === 'connected' ? 'Connected' : 'Connect Voice'}
      </button>
      <button onClick={disconnect} disabled={state !== 'connected'}>
        Disconnect
      </button>
      <span className={`voice-state voice-state-${state}`}>{state}</span>
      {error ? <div className="voice-error">{error}</div> : null}
    </div>
  );
}