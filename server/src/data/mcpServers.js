export const BUILTIN_MCP_SERVERS = [
  {
    id: 'mcp-swarm-manager',
    name: 'Swarm Manager',
    url: process.env.MCP_ENDPOINT || 'http://swarm-manager:8000/ai/mcp',
    description: 'Docker Swarm deployment — build, deploy, monitor stacks',
    icon: '🐝',
    apiKey: '',
    builtin: true,
    enabled: true,
  }
];
