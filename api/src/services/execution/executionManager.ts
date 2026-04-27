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

type ProviderType = 'coder' | 'sandbox' | 'openclaw' | 'hermes' | 'opencode';

interface ExecutionManagerOptions {
  resolveProvider?: (agentId: string) => ProviderType;
  coderOptions?: { baseUrl?: string; apiKey?: string };
  openclawOptions?: { baseUrl?: string; apiKey?: string };
  hermesOptions?: { baseUrl?: string; apiKey?: string };
  opencodeOptions?: { baseUrl?: string; apiKey?: string };
}

interface BindAgentMeta {
  ownerId?: string;
}

export class ExecutionManager {
  sandbox: SandboxExecutionProvider;
  coder: CoderExecutionProvider;
  openclaw: CoderExecutionProvider;
  hermes: CoderExecutionProvider;
  opencode: CoderExecutionProvider;
  _resolveProvider: (agentId: string) => ProviderType;
  _agentProviders: Map<string, ProviderType>;

  constructor(options: ExecutionManagerOptions = {}) {
    this.sandbox = new SandboxExecutionProvider();
    this.coder = new CoderExecutionProvider(options.coderOptions || {});
    this.openclaw = new CoderExecutionProvider({
      baseUrl: options.openclawOptions?.baseUrl || process.env.OPENCLAW_SERVICE_URL || 'http://openclaw-service:8000',
      apiKey: options.openclawOptions?.apiKey || process.env.CODER_API_KEY || '',
    });
    this.hermes = new CoderExecutionProvider({
      baseUrl: options.hermesOptions?.baseUrl || process.env.HERMES_SERVICE_URL || 'http://hermes-service:8000',
      apiKey: options.hermesOptions?.apiKey || process.env.CODER_API_KEY || '',
    });
    this.opencode = new CoderExecutionProvider({
      baseUrl: options.opencodeOptions?.baseUrl || process.env.OPENCODE_SERVICE_URL || 'http://opencode-service:8000',
      apiKey: options.opencodeOptions?.apiKey || process.env.CODER_API_KEY || '',
    });
    this._resolveProvider = options.resolveProvider || (() => 'sandbox');
    this._agentProviders = new Map();
  }

  // ── Provider resolution ───────────────────────────────────────────────

  /**
   * Get the correct provider for an agent.
   * Once an agent is assigned to a provider via ensureProject, that binding
   * is cached and reused. The resolver is only called when the agent has
   * no current binding.
   */
  _providerFor(agentId: string): ExecutionProvider {
    const bound = this._agentProviders.get(agentId);
    if (bound) {
      return this._getProvider(bound);
    }
    const choice = this._resolveProvider(agentId);
    this._agentProviders.set(agentId, choice);
    return this._getProvider(choice);
  }

  _getProvider(type: ProviderType): ExecutionProvider {
    switch (type) {
      case 'coder': return this.coder;
      case 'openclaw': return this.openclaw;
      case 'hermes': return this.hermes;
      case 'opencode': return this.opencode;
      default: return this.sandbox;
    }
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
      const oldProvider = this._getProvider(previous);
      oldProvider.destroySandbox(agentId).catch(() => {});
    }
    this._agentProviders.set(agentId, providerType);
    if (providerType !== 'sandbox' && meta.ownerId) {
      (this._getProvider(providerType) as CoderExecutionProvider).setOwner(agentId, meta.ownerId);
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
      this.openclaw.destroyAll(),
      this.hermes.destroyAll(),
      this.opencode.destroyAll(),
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
