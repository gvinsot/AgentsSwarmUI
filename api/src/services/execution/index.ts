// ─── Execution module: unified API for runner-service backends ─────────────
//
// All execution backends (claude-code, openclaw, hermes, opencode, sandbox)
// are served by the same generic runner-service over HTTP. This module
// exposes a single ExecutionManager that routes per-agent calls to the
// right runner-service URL based on the agent's runner / llmConfig.

export { ExecutionProvider } from './executionProvider.js';
export { RunnerExecutionProvider } from './runnerExecutionProvider.js';
export { ExecutionManager } from './executionManager.js';
