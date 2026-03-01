import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Manages per-agent Docker sandbox containers.
 * Each agent gets its own isolated container where tool calls are executed
 * via `docker exec`. Projects are git-cloned into /workspace/<project>.
 */
export class SandboxManager {
  constructor() {
    /** @type {Map<string, { containerName: string, project: string | null }>} */
    this.sandboxes = new Map();
  }

  // ─── Container Lifecycle ──────────────────────────────────────────

  /**
   * Ensure a running sandbox container exists for this agent with the given
   * project cloned. Creates the container + clones on first call; re-clones
   * when the project changes; no-ops when already up-to-date.
   */
  async ensureSandbox(agentId, project, gitUrl) {
    const existing = this.sandboxes.get(agentId);

    // Already running with the correct project → nothing to do
    if (existing && existing.project === project) {
      // Verify container is still running
      if (await this._isRunning(existing.containerName)) return;
      // Container died — recreate
      this.sandboxes.delete(agentId);
    }

    // Different project → destroy old sandbox first
    if (existing && existing.project !== project) {
      await this.destroySandbox(agentId);
    }

    const containerName = this._containerName(agentId);

    // Create the container
    const image = process.env.SANDBOX_IMAGE || 'agentswarm-sandbox:latest';
    const sshMount = process.env.SSH_KEYS_HOST_PATH || '/home/gildas/.ssh';
    const gitName = process.env.GIT_USER_NAME || '';
    const gitEmail = process.env.GIT_USER_EMAIL || '';

    const runCmd = [
      'docker run -d',
      `--name ${containerName}`,
      '--network bridge',
      `--memory 2g --cpus 2`,
      `-v "${sshMount}:/root/.ssh:ro"`,
      `-v /var/run/docker.sock:/var/run/docker.sock`,
      `-e "GIT_USER_NAME=${gitName}"`,
      `-e "GIT_USER_EMAIL=${gitEmail}"`,
      image,
    ].join(' ');

    try {
      await execAsync(runCmd, { timeout: 30000 });
    } catch (err) {
      throw new Error(`Failed to create sandbox for agent ${agentId}: ${err.message}`);
    }

    // Configure git inside the container
    if (gitName) {
      await this._exec(containerName, `git config --global user.name "${gitName}"`);
    }
    if (gitEmail) {
      await this._exec(containerName, `git config --global user.email "${gitEmail}"`);
    }

    // Clone the project
    if (project && gitUrl) {
      try {
        await this._exec(containerName, `git clone "${gitUrl}" /workspace/${project}`, { timeout: 120000 });
      } catch (err) {
        // Destroy the container on clone failure
        await this._forceRemove(containerName);
        throw new Error(`Failed to clone project "${project}" into sandbox: ${err.message}`);
      }
    }

    this.sandboxes.set(agentId, { containerName, project });
    console.log(`📦 [Sandbox] Created ${containerName} for project "${project}"`);
  }

  /**
   * Switch the sandbox to a different project: clean workspace + git clone.
   */
  async switchProject(agentId, newProject, gitUrl) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) return; // Will be created lazily on next ensureSandbox

    const { containerName } = entry;

    // Clean workspace
    await this._exec(containerName, 'rm -rf /workspace/*');

    // Clone new project
    if (newProject && gitUrl) {
      await this._exec(containerName, `git clone "${gitUrl}" /workspace/${newProject}`, { timeout: 120000 });
    }

    entry.project = newProject;
    console.log(`📦 [Sandbox] ${containerName} switched to project "${newProject}"`);
  }

  /**
   * Destroy the sandbox container for an agent.
   */
  async destroySandbox(agentId) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) return;
    await this._forceRemove(entry.containerName);
    this.sandboxes.delete(agentId);
    console.log(`🗑️  [Sandbox] Destroyed ${entry.containerName}`);
  }

  /**
   * Destroy ALL sandbox containers (server shutdown).
   */
  async destroyAll() {
    const promises = [];
    for (const [agentId] of this.sandboxes) {
      promises.push(this.destroySandbox(agentId));
    }
    await Promise.allSettled(promises);
    // Also clean any orphans in case map is out of sync
    await this.cleanupOrphans();
  }

  /**
   * Remove orphaned sandbox containers from a previous crash.
   * Called once at server startup.
   */
  async cleanupOrphans() {
    try {
      const { stdout } = await execAsync(
        'docker ps -a --filter "name=sandbox-" --format "{{.Names}}"',
        { timeout: 10000 }
      );
      const containers = stdout.trim().split('\n').filter(Boolean);
      for (const name of containers) {
        // Only remove containers that aren't tracked
        const isTracked = Array.from(this.sandboxes.values()).some(e => e.containerName === name);
        if (!isTracked) {
          await this._forceRemove(name);
          console.log(`🧹 [Sandbox] Cleaned orphan container ${name}`);
        }
      }
    } catch {
      // Docker may not be available — ignore
    }
  }

  // ─── Tool Execution ───────────────────────────────────────────────

  /**
   * Execute a shell command inside the agent's sandbox.
   */
  async exec(agentId, command, options = {}) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);

    const { containerName, project } = entry;
    const cwd = options.cwd || (project ? `/workspace/${project}` : '/workspace');
    const timeout = options.timeout || 30000;

    return this._exec(containerName, command, { cwd, timeout });
  }

  /**
   * Read a file from the agent's sandbox.
   */
  async readFile(agentId, filePath) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);
    const fullPath = `/workspace/${entry.project}/${filePath}`;
    const { stdout } = await this._exec(entry.containerName, `cat "${fullPath}"`, { timeout: 10000 });
    return stdout;
  }

  /**
   * Write a file inside the agent's sandbox.
   * Uses stdin piping to avoid shell escaping issues.
   */
  async writeFile(agentId, filePath, content) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);
    const fullPath = `/workspace/${entry.project}/${filePath}`;
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

    // Create directories + write via stdin to avoid escaping issues
    await this._exec(entry.containerName, `mkdir -p "${dirPath}"`);

    return new Promise((resolve, reject) => {
      const proc = exec(
        `docker exec -i ${entry.containerName} sh -c 'cat > "${fullPath}"'`,
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`Write failed: ${err.message}`));
          else resolve({ stdout, stderr });
        }
      );
      proc.stdin.write(content);
      proc.stdin.end();
    });
  }

  /**
   * Append content to a file inside the agent's sandbox.
   */
  async appendFile(agentId, filePath, content) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);
    const fullPath = `/workspace/${entry.project}/${filePath}`;
    const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'));

    await this._exec(entry.containerName, `mkdir -p "${dirPath}"`);

    return new Promise((resolve, reject) => {
      const proc = exec(
        `docker exec -i ${entry.containerName} sh -c 'cat >> "${fullPath}"'`,
        { timeout: 30000, maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) reject(new Error(`Append failed: ${err.message}`));
          else resolve({ stdout, stderr });
        }
      );
      proc.stdin.write(content);
      proc.stdin.end();
    });
  }

  /**
   * List a directory inside the agent's sandbox.
   */
  async listDir(agentId, dirPath) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);
    const fullPath = `/workspace/${entry.project}/${dirPath}`;
    const { stdout } = await this._exec(
      entry.containerName,
      `ls -la "${fullPath}" | grep -v '^\\.\\.' | head -200`,
      { timeout: 10000 }
    );
    return stdout;
  }

  /**
   * Search for text in files inside the agent's sandbox.
   */
  async searchFiles(agentId, pattern, query) {
    const entry = this.sandboxes.get(agentId);
    if (!entry) throw new Error(`No sandbox running for agent ${agentId}`);
    const basePath = `/workspace/${entry.project}`;

    // Phase 1: find matching files
    const { stdout: files } = await this._exec(
      entry.containerName,
      `grep -r -l -i --include "${pattern}" -- "${query}" "${basePath}/" 2>/dev/null | head -20`,
      { timeout: 15000 }
    ).catch(() => ({ stdout: '' }));

    if (!files.trim()) return '';

    // Phase 2: get matching lines with context
    const { stdout: matches } = await this._exec(
      entry.containerName,
      `grep -r -n -i --include "${pattern}" -- "${query}" "${basePath}/" 2>/dev/null | head -50`,
      { timeout: 15000 }
    ).catch(() => ({ stdout: '' }));

    return matches;
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  /**
   * Check if sandbox is active for this agent.
   */
  hasSandbox(agentId) {
    return this.sandboxes.has(agentId);
  }

  /**
   * Get the project currently loaded in a sandbox.
   */
  getSandboxProject(agentId) {
    return this.sandboxes.get(agentId)?.project || null;
  }

  /** Deterministic container name from agent ID */
  _containerName(agentId) {
    return `sandbox-${agentId.replace(/-/g, '').slice(0, 12)}`;
  }

  /** Execute a command in a named container */
  async _exec(containerName, command, options = {}) {
    const cwd = options.cwd ? `-w "${options.cwd}"` : '';
    const timeout = options.timeout || 30000;

    const dockerCmd = `docker exec ${cwd} ${containerName} /bin/bash -c ${JSON.stringify(command)}`;
    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });
    return { stdout, stderr };
  }

  /** Check if a container is running */
  async _isRunning(containerName) {
    try {
      const { stdout } = await execAsync(
        `docker inspect --format="{{.State.Running}}" ${containerName}`,
        { timeout: 5000 }
      );
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Force-remove a container */
  async _forceRemove(containerName) {
    try {
      await execAsync(`docker rm -f ${containerName}`, { timeout: 15000 });
    } catch {
      // Already gone — ignore
    }
  }
}
