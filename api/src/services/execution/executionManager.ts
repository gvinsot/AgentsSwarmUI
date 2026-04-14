// ─── ExecutionManager: unified facade routing agents to execution providers ──
//
// The rest of the codebase interacts with ExecutionManager exclusively.
// It delegates to SandboxExecutionProvider or CoderExecutionProvider based on
// a per-agent resolver function (typically checking llmConfig.managesContext).
//
// The API surface mirrors ExecutionProvider exactly, so consumers don't need
// to know which backend is active for a given agent.

import { SandboxExecutionProvider } from './sandboxExecutionProvider.js';
import { CoderExecutionProvider } from './coderExecutionProvider.js';
import { ExecutionProvider } from './executionProvider.js';

type ProviderType = 'coder' | 'sandbox';

interface ExecutionManagerOptions {
  resolveProvider?: (agentId: string) => ProviderType;
  coderOptions?: { baseUrl?: string; apiKey?: string };
}

interface BindAgentMeta {
  ownerId?: string;
}

export class ExecutionManager {
  sandbox: SandboxExecutionProvider;
  coder: CoderExecutionProvider;
  _resolveProvider: (agentId: string) => ProviderType;
  _agentProviders: Map<string, ProviderType>;

  /**
   * @param options
   *
   * resolveProvider is called to decide which backend an agent should use.
   * It receives the agentId and must return 'coder' or 'sandbox'.
   */
  constructor(options: ExecutionManagerOptions = {}) {
    this.sandbox = new SandboxExecutionProvider();
    this.coder = new CoderExecutionProvider(options.coderOptions || {});
    this._resolveProvider = options.resolveProvider || (() => 'sandbox');
    // Track which provider each agent was last routed to
    this._agentProviders = new Map(); // agentId -> 'sandbox' | 'coder'
  }

  // ── Provider resolution ───────────────────────────────────────────────

  /**
   * Get the correct provider for an agent.
   * Once an agent is assigned to a provider via ensureProject, that binding
   * is cached and reused. The resolver is only called when the agent has
   * no current binding.
   */
  _providerFor(agentId: string): ExecutionProvider {
    // If already bound, reuse
    const bound = this._agentProviders.get(agentId);
    if (bound) {
      return bound === 'coder' ? this.coder : this.sandbox;
    }
    // Resolve and bind
    const choice = this._resolveProvider(agentId);
    this._agentProviders.set(agentId, choice);
    return choice === 'coder' ? this.coder : this.sandbox;
  }

  /**
   * Explicitly bind an agent to a specific provider.
   * Called by agentManager when it knows the llmConfig for an agent.
   *
   * @param agentId
   * @param providerType
   * @param meta - optional metadata (e.g. ownerId for coder-service)
   */
  bindAgent(agentId: string, providerType: ProviderType, meta: BindAgentMeta = {}): void {
    const previous = this._agentProviders.get(agentId);
    if (previous && previous !== providerType) {
      console.log(`🔄 [Execution] Agent ${agentId.slice(0, 8)} switching provider: ${previous} → ${providerType}`);
      // Clean up old provider
      const oldProvider = previous === 'coder' ? this.coder : this.sandbox;
      oldProvider.destroySandbox(agentId).catch(() => {});
    }
    this._agentProviders.set(agentId, providerType);
    // Forward owner info to coder provider for X-Owner-Id header
    if (providerType === 'coder' && meta.ownerId) {
      this.coder.setOwner(agentId, meta.ownerId);
    }
  }

  /**
   * Get the provider type currently bound to an agent.
   */
  getProviderType(agentId: string): ProviderType | undefined {
    return this._agentProviders.get(agentId);
  }

  // ── ExecutionProvider interface (delegated) ───────────────────────────

  async ensureProject(agentId: string, project: string | null = null, gitUrl: string | null = null): Promise<void> {
    return this._providerFor(agentId).ensureProject(agentId, project, gitUrl);
  }

  async switchProject(agentId: string, newProject: string, gitUrl: string | null = null): Promise<void> {
    return this._providerFor(agentId).switchProject(agentId, newProject, gitUrl);
  }

  async destroySandbox(agentId: string): Promise<void> {
    const provider = this._providerFor(agentId);
    await provider.destroySandbox(agentId);
    this._agentProviders.delete(agentId);
  }

  async destroyAll(): Promise<void> {
    await Promise.all([
      this.sandbox.destroyAll(),
      this.coder.destroyAll(),
    ]);
    this._agentProviders.clear();
  }

  hasEnvironment(agentId: string): boolean {
    return this._providerFor(agentId).hasEnvironment(agentId);
  }

  getProject(agentId: string): string | null {
    return this._providerFor(agentId).getProject(agentId);
  }

  getFileTree(agentId: string): string | null {
    return this._providerFor(agentId).getFileTree(agentId);
  }

  async refreshFileTree(agentId: string): Promise<void> {
    return this._providerFor(agentId).refreshFileTree(agentId);
  }

  async readFile(agentId: string, filePath: string): Promise<string> {
    return this._providerFor(agentId).readFile(agentId, filePath);
  }

  async writeFile(agentId: string, filePath: string, content: string): Promise<any> {
    return this._providerFor(agentId).writeFile(agentId, filePath, content);
  }

  async appendFile(agentId: string, filePath: string, content: string): Promise<any> {
    return this._providerFor(agentId).appendFile(agentId, filePath, content);
  }

  async listDir(agentId: string, dirPath: string): Promise<string> {
    return this._providerFor(agentId).listDir(agentId, dirPath);
  }

  async searchFiles(agentId: string, pattern: string, query: string): Promise<string> {
    return this._providerFor(agentId).searchFiles(agentId, pattern, query);
  }

  async exec(agentId: string, command: string, options: { cwd?: string; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
    return this._providerFor(agentId).exec(agentId, command, options);
  }

  // ── Backward compatibility aliases ────────────────────────────────────
  // Allow drop-in replacement where code still calls sandboxManager methods.

  /** @deprecated Use ensureProject() */
  async ensureSandbox(agentId: string, project: string | null = null, gitUrl: string | null = null): Promise<void> {
    return this.ensureProject(agentId, project, gitUrl);
  }

  /** @deprecated Use hasEnvironment() */
  hasSandbox(agentId: string): boolean {
    return this.hasEnvironment(agentId);
  }

  /** @deprecated Use getProject() */
  getSandboxProject(agentId: string): string | null {
    return this.getProject(agentId);
  }

  async cleanupOrphans(): Promise<void> {
    await this.sandbox.cleanupOrphans();
  }
}
