import './database/connection.js';

// Re-export user functions and types
export {
  getUserByEmail,
  getUserByUsername,
  createUser,
  verifyPassword,
  getUserByGoogleId,
  createGoogleUser,
  linkGoogleId,
  getUserByGitHubId,
  createGitHubUser,
  linkGitHubId,
  getUserByGitHubId as getUserByGithubId,
  getUserByMicrosoftId,
  createMicrosoftUser,
  linkMicrosoftId,
  getAllUsers,
  getUserById,
  updateUserRole,
  updateUserPermissions,
  deleteUser,
  updateUserPassword,
  type UserRole,
  type User,
  type Permission,
  type User as UserModel,
  type Permission as PermissionModel,
} from './database/users.js';

// Re-export agent functions and types
export {
  getAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  type Agent,
} from './database/agents.js';

// Re-export task functions and types
export {
  getTasks,
  getTaskById,
  getTasksByAgentId,
  createTask,
  updateTask,
  deleteTask,
  reorderTasks,
  attachCommitToTask,
  getCommitsByTask,
  getTasksByCommit,
  setTaskParent,
  getTaskChildren,
  getTaskParent,
  type Task,
  type Commit,
} from './database/tasks.js';

// Re-export project functions and types
export {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  assignAgentToProject,
  unassignAgentFromProject,
  type Project,
} from './database/projects.js';

// Re-export board functions and types
export {
  getBoards,
  getBoardById,
  createBoard,
  updateBoard,
  deleteBoard,
  type Board,
} from './database/boards.js';

// Re-export board sharing functions and types
export {
  getBoardSharing,
  upsertBoardSharing,
  deleteBoardSharing,
  type BoardSharing,
} from './database/boardSharing.js';

// Re-export board repo / storage / plugin functions
export {
  getBoardRepos,
  upsertBoardRepo,
  deleteBoardRepo,
  type BoardRepo,
} from './database/boardRepos.js';

export {
  getBoardStorages,
  upsertBoardStorage,
  deleteBoardStorage,
  type BoardStorage,
} from './database/boardStorages.js';

export {
  getBoardMcpServers,
  upsertBoardMcpServer,
  deleteBoardMcpServer,
  type BoardMcpServer,
} from './database/mcpServers.js';

// Re-export skill functions and types
export {
  getSkills,
  type Skill,
} from './database/skills.js';

export {
  getAgentSkills,
  upsertAgentSkill,
  deleteAgentSkill,
  type AgentSkill,
} from './database/agentSkills.js';

// Re-export LLM config functions and types
export {
  getLlmConfigs,
  getLlmConfigById,
  createLlmConfig,
  updateLlmConfig,
  deleteLlmConfig,
  type LlmConfig,
} from './database/llmConfigs.js';

// Re-export OAuth token functions and types
export {
  getOauthToken,
  upsertOauthToken,
  deleteOauthToken,
  getOauthTokensForUser,
  type OauthToken,
} from './database/oauthTokens.js';

// Re-export settings functions
export {
  getSetting,
  setSetting,
  deleteSetting,
} from './database/settings.js';

// Re-export token usage functions and types
export {
  recordTokenUsage,
  getTokenUsageForUser,
  getTokenUsageForAgent,
  getTokenUsageBetween,
  type TokenUsageRecord,
} from './database/tokenUsage.js';

// Re-export encrypt migration helpers
export { runEncryptMigration } from './database/encryptMigration.js';