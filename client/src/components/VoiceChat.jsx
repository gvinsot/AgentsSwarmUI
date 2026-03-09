import { Mic, MicOff, Loader2, Volume2, PhoneOff } from 'lucide-react';
import { useMemo } from 'react';
import { useVoiceSession } from '../contexts/VoiceSessionContext';

function statusColor(status) {
  switch (status) {
    case 'connected':
      return 'bg-green-500';
    case 'connecting':
      return 'bg-yellow-500 animate-pulse';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
}

export default function VoiceChat({ agent, showToast }) {
  const {
    status,
    isMuted,
    currentTranscript,
    currentResponse,
    currentFunction,
    connect,
    disconnect,
    toggleMute,
  } = useVoiceSession();

  const isVoiceAgent = agent?.isVoice;

  const statusLabel = useMemo(() => {
    if (!isVoiceAgent) return 'Not a voice agent';
    if (status === 'connected') return 'Connected';
    if (status === 'connecting') return 'Connecting...';
    if (status === 'error') return 'Connection failed';
    return 'Ready';
  }, [isVoiceAgent, status]);

  const handleConnect = async () => {
    if (!agent?.id) return;
    try {
      await connect(agent.id);
    } catch (err) {
      console.error('Voice connect failed:', err);
      showToast?.(err.message || 'Failed to connect voice', 'error');
    }
  };

  return (
    <div className=\"space-y-4\">
      <div className=\"rounded-xl border border-dark-700 bg-dark-800/60 p-4\">
        <div className=\"flex items-center justify-between gap-3\">
          <div>
            <div className=\"flex items-center gap-2\">
              <span className={`w-2.5 h-2.5 rounded-full ${statusColor(status)}`} />
              <span className=\"text-sm font-medium text-dark-100\">{statusLabel}</span>
            </div>
            <p className=\"mt-1 text-xs text-dark-400\">
              {isVoiceAgent
                ? 'Live Realtime speech-to-speech connection'
                : 'Enable a voice template to use realtime speech'}
            </p>
          </div>

          <div className=\"flex gap-2\">
            {status !== 'connected' ? (
              <button
                onClick={handleConnect}
                disabled={!isVoiceAgent || status === 'connecting'}
                className=\"inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white\"
              >
                {status === 'connecting' ? (
                  <>
                    <Loader2 className=\"w-4 h-4 animate-spin\" />
                    Connecting
                  </>
                ) : (
                  <>
                    <Mic className=\"w-4 h-4\" />
                    Start Voice
                  </>
                )}
              </button>
            ) : (
              <>
                <button
                  onClick={toggleMute}
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white ${
                    isMuted ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-slate-600 hover:bg-slate-500'
                  }`}
                >
                  {isMuted ? <MicOff className=\"w-4 h-4\" /> : <Mic className=\"w-4 h-4\" />}
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={disconnect}
                  className=\"inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white\"
                >
                  <PhoneOff className=\"w-4 h-4\" />
                  End
                </button>
              </>
            )}
          </div>
        </div>

        {status === 'connected' && (
          <div className=\"mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm\">
            <div className=\"rounded-lg bg-dark-900/60 border border-dark-700 p-3\">
              <div className=\"flex items-center gap-2 text-dark-300\">
                <Mic className=\"w-4 h-4\" />
                <span>You</span>
              </div>
              <p className=\"mt-2 text-dark-100 min-h-[2rem]\">
                {currentTranscript || 'Waiting for speech...'}
              </p>
            </div>
            <div className=\"rounded-lg bg-dark-900/60 border border-dark-700 p-3\">
              <div className=\"flex items-center gap-2 text-dark-300\">
                <Volume2 className=\"w-4 h-4\" />
                <span>Agent</span>
              </div>
              <p className=\"mt-2 text-dark-100 min-h-[2rem]\">
                {currentResponse || 'No response yet...'}
              </p>
            </div>
            <div className=\"rounded-lg bg-dark-900/60 border border-dark-700 p-3\">
              <div className=\"flex items-center gap-2 text-dark-300\">
                <Loader2 className=\"w-4 h-4\" />
                <span>Voice Status</span>
              </div>
              <p className=\"mt-2 text-dark-100 min-h-[2rem]\">
                {currentFunction || 'No activity yet...'}
              </p>
            </div>
          </div>
        )}

        <p className=\"mt-4 text-xs text-dark-500\">
          Tip: start voice from a button click, allow microphone access, and make sure the browser tab is not muted.
        </p>
      </div>
    </div>
  );
}