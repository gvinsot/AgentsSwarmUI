// ─── Execution module: unified API for code execution backends ──────────────
//
// This module provides a single, consistent API for executing code regardless
// of the underlying backend (Docker sandbox or Coder Service / Claude Code).
//
// Usage:
//   import { ExecutionManager } from './services/execution/index.js';
//   const executionManager = new ExecutionManager({ resolveProvider: ... });
//   await executionManager.ensureProject(agentId, project, gitUrl);
//   await executionManager.exec(agentId, 'npm test');

export { ExecutionProvider } from './executionProvider.js';
export { SandboxExecutionProvider } from './sandboxExecutionProvider.js';
export { CoderExecutionProvider } from './coderExecutionProvider.js';
export { ExecutionManager } from './executionManager.js';
