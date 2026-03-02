import React from 'react';
import { useAppContext } from '../context/AppContext';

interface Agent {
  id: string;
  name: string;
}

export default function AgentSelector({ agents }: { agents: Agent[] }) {
  const { selectedAgentId, setSelectedAgentId } = useAppContext();

  return (
    <select
      value={selectedAgentId ?? ''}
      onChange={(e) => setSelectedAgentId(e.target.value || null)}
      aria-label="Select agent"
    >
      <option value="">Default agent</option>
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  );
}