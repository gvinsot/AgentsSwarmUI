// ─── Agent Lifecycle: barrel re-export ───────────────────────────────────────
// Split into focused modules for LLM-friendliness:
//   crud.js          — create, update, delete, updateAllProjects, resetInstructionsByRole
//   getters.js       — getAll, getAllForUser, getById, getLastMessages, etc.
//   status.js        — getAgentStatus, getAllStatuses, getSwarmStatus, setStatus, stopAgent
//   taskStats.js     — _collectTasks, getTaskStats, getTaskTimeSeries, getAgentTimeSeries
//   broadcast.js     — broadcastMessage, handoff
//   actionLogs.js    — addActionLog, clearActionLogs, _saveExecutionLog
//   agentFeatures.js — RAG documents, Skills, MCP servers
//   conversation.js  — clearHistory, truncateHistory, voice instructions, context switching

import { crudMethods } from './crud.js';
import { gettersMethods } from './getters.js';
import { statusMethods } from './status.js';
import { taskStatsMethods } from './taskStats.js';
import { broadcastMethods } from './broadcast.js';
import { actionLogsMethods } from './actionLogs.js';
import { agentFeaturesMethods } from './agentFeatures.js';
import { conversationMethods } from './conversation.js';

export const lifecycleMethods = {
  ...crudMethods,
  ...gettersMethods,
  ...statusMethods,
  ...taskStatsMethods,
  ...broadcastMethods,
  ...actionLogsMethods,
  ...agentFeaturesMethods,
  ...conversationMethods,
};
