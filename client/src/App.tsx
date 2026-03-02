import React from 'react';
import { AppProvider } from './context/AppContext';
import AgentSelector from './components/AgentSelector';
import VoiceControls from './components/VoiceControls';

const agents = [
  { id: 'agent-1', name: 'Agent 1' },
  { id: 'agent-2', name: 'Agent 2' },
];

export default function App() {
  return (
    <AppProvider>
      <main>
        <h1>Agents Swarm UI</h1>
        <AgentSelector agents={agents} />
        <VoiceControls />
      </main>
    </AppProvider>
  );
}