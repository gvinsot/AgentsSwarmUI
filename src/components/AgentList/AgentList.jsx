import React from 'react';
import PropTypes from 'prop-types';
import AgentListItem from './AgentListItem';

const AgentList = ({ agents }) => {
  // Sort agents with 'swarm manager' role first
  const sortedAgents = [...agents].sort((a, b) => {
    if (a.role === 'swarm manager' && b.role !== 'swarm manager') return -1;
    if (a.role !== 'swarm manager' && b.role === 'swarm manager') return 1;
    return 0;
  });

  return (
    <div className="agent-list">
      {sortedAgents.map(agent => (
        <AgentListItem key={agent.id} agent={agent} />
      ))}
    </div>
  );
};

AgentList.propTypes = {
  agents: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string.isRequired,
      role: PropTypes.string.isRequired,
    })
  ).isRequired,
};

export default AgentList;