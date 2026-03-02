import { Mic, MicOff, PhoneOff, RefreshCw, Loader2, Volume2, VolumeX } from 'lucide-react';
import { useVoiceSession, STATUS, STATUS_LABELS } from '../contexts/VoiceSessionContext';

export default function VoiceChatTab({ agent }) {
  const voice = useVoiceSession();

  const isThisAgent = voice.isSessionForAgent(agent.id);
  const isOtherAgentActive = voice.isActive && !isThisAgent;

  // When this agent's session is active, use voice state; otherwise show disconnected
  const status = isThisAgent ? voice.status : STATUS.DISCONNECTED;
  const isActive = isThisAgent && voice.isActive;
  const error = isThisAgent ? voice.error : null;
  const delegationTarget = isThisAgent ? voice.delegationTarget : null;
  const events = isThisAgent ? voice.events : [];

  const handleConnect = () => {
    voice.connect(agent.id);
  };

  const handleSwitchSession = () => {
    voice.disconnect();
    // Small delay to allow cleanup before reconnecting
    setTimeout(() => voice.connect(agent.id), 150);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Main animation zone */}
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
        {/* Central orb animation */}
        <div className="relative">
          <div className={`
            w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300
            ${status === STATUS.LISTENING ? 'bg-emerald-500/20 ring-4 ring-emerald-500/40 animate-pulse' : ''}
            ${status === STATUS.SPEAKING ? 'bg-indigo-500/20 ring-4 ring-indigo-500/40' : ''}
            ${status === STATUS.DELEGATING ? 'bg-amber-500/20 ring-4 ring-amber-500/40 animate-pulse' : ''}
            ${status === STATUS.CONNECTING ? 'bg-dark-700 ring-2 ring-dark-500 animate-pulse' : ''}
            ${status === STATUS.CONNECTED ? 'bg-dark-700 ring-2 ring-dark-500' : ''}
            ${status === STATUS.DISCONNECTED ? 'bg-dark-800 ring-2 ring-dark-600' : ''}
            ${status === STATUS.ERROR ? 'bg-red-500/20 ring-2 ring-red-500/40' : ''}
          `}>
            {/* Animated rings when speaking/listening */}
            {status === STATUS.SPEAKING && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-indigo-500/30 animate-ping" />
                <div className="absolute -inset-3 rounded-full border border-indigo-500/20 animate-ping" style={{ animationDelay: '0.3s' }} />
                <div className="absolute -inset-6 rounded-full border border-indigo-500/10 animate-ping" style={{ animationDelay: '0.6s' }} />
              </>
            )}
            {status === STATUS.LISTENING && (
              <>
                <div className="absolute inset-0 rounded-full border-2 border-emerald-500/30 animate-ping" />
                <div className="absolute -inset-3 rounded-full border border-emerald-500/20 animate-ping" style={{ animationDelay: '0.3s' }} />
              </>
            )}

            {/* Center icon */}
            {status === STATUS.CONNECTING && <Loader2 className="w-10 h-10 text-dark-300 animate-spin" />}
            {status === STATUS.DISCONNECTED && <Mic className="w-10 h-10 text-dark-500" />}
            {status === STATUS.CONNECTED && <Mic className="w-10 h-10 text-dark-300" />}
            {status === STATUS.LISTENING && <Mic className="w-10 h-10 text-emerald-400" />}
            {status === STATUS.SPEAKING && (
              <div className="flex items-center gap-1">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-indigo-400 rounded-full animate-bounce"
                    style={{
                      height: `${12 + Math.random() * 20}px`,
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: '0.6s'
                    }}
                  />
                ))}
              </div>
            )}
            {status === STATUS.DELEGATING && <Loader2 className="w-10 h-10 text-amber-400 animate-spin" />}
            {status === STATUS.ERROR && <MicOff className="w-10 h-10 text-red-400" />}
          </div>
        </div>

        {/* Status label */}
        <div className="text-center">
          <p className={`text-lg font-medium ${
            status === STATUS.LISTENING ? 'text-emerald-400' :
            status === STATUS.SPEAKING ? 'text-indigo-400' :
            status === STATUS.DELEGATING ? 'text-amber-400' :
            status === STATUS.ERROR ? 'text-red-400' :
            'text-dark-300'
          }`}>
            {status === STATUS.DELEGATING
              ? `Delegating to ${delegationTarget}...`
              : STATUS_LABELS[status]}
          </p>
          {error && (
            <p className="text-red-400/70 text-sm mt-1">{error}</p>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {!isActive ? (
            <div className="flex flex-col items-center gap-3">
              {isOtherAgentActive ? (
                <>
                  <p className="text-dark-400 text-sm text-center">
                    A voice session is active on another agent.
                  </p>
                  <button
                    onClick={handleSwitchSession}
                    className="flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-full transition-colors font-medium"
                  >
                    <RefreshCw className="w-5 h-5" />
                    Switch Voice Session Here
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnect}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full transition-colors font-medium"
                >
                  <Mic className="w-5 h-5" />
                  Start Voice Session
                </button>
              )}
            </div>
          ) : (
            <>
              <button
                onClick={voice.toggleMute}
                className={`p-3 rounded-full transition-colors ${
                  voice.muted
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                }`}
                title={voice.muted ? 'Unmute' : 'Mute'}
              >
                {voice.muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                onClick={voice.toggleSpeaker}
                className={`p-3 rounded-full transition-colors ${
                  voice.speakerOff
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-dark-700 text-dark-300 hover:bg-dark-600'
                }`}
                title={voice.speakerOff ? 'Activer le haut-parleur' : 'Couper le haut-parleur'}
              >
                {voice.speakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>

              <button
                onClick={voice.reconnect}
                className="p-3 rounded-full bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors"
                title="Reconnect"
              >
                <RefreshCw className="w-5 h-5" />
              </button>

              <button
                onClick={voice.disconnect}
                className="p-3 rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                title="End session"
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Event timeline (scrollable) */}
      {events.length > 0 && (
        <div className="border-t border-dark-700 max-h-48 overflow-y-auto px-4 py-2">
          {events.map((evt, i) => (
            <div key={i} className="flex items-start gap-2 py-1 text-xs">
              <span className="text-dark-500 whitespace-nowrap">
                {evt.time.toLocaleTimeString()}
              </span>
              <span className={`
                ${evt.type === 'error' ? 'text-red-400' : ''}
                ${evt.type === 'delegation' ? 'text-amber-400' : ''}
                ${evt.type === 'delegation-result' ? 'text-emerald-400' : ''}
                ${evt.type === 'system' ? 'text-dark-400' : ''}
              `}>
                {evt.text}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
