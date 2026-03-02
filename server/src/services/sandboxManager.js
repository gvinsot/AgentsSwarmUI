import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Shared sandbox manager:
 * - Maintains a single shared Docker container
 * - Creates one Linux user per agent inside that container
 * - Executes tool commands as the corresponding agent user
 */
class SandboxManager {
  constructor() {
    this.sharedContainerName = process.env.SANDBOX_SHARED_CONTAINER_NAME || 'sandbox-shared';
    this.sharedImage = process.env.SANDBOX_IMAGE || 'agent-sandbox:latest';
    this.network = process.env.SANDBOX_NETWORK || 'bridge';
    this.baseWorkspace = process.env.SANDBOX_BASE_WORKSPACE || '/workspace';
    this.agentUsers = new Map(); // agentId -> { username, project }
  }

  // ─── Public API ───────────────────────────────────────────────────

  async ensureSandbox(agentId, project = null) {
    await this._ensureSharedContainerRunning();

    const existing = this.agentUsers.get(agentId);
    if (existing) {
      if (existing.project !== project) {
        await this._switchProject(agentId, project);
      }
      return;
    }

    const username = this._username(agentId);
    await this._ensureLinuxUser(username);
    await this._ensureAgentWorkspace(username);

    if (project) {
      await this._cloneProjectForUser(username, project);
    }

    this.agentUsers.set(agentId, { username, project });
    console.log(`📦 [Sandbox] Agent ${agentId} mapped to shared container user "${username}" (project: ${project || 'none'})`);
  }

  async switchProject(agentId, newProject) {
    await this._switchProject(agentId, newProject);
  }

  async destroySandbox(agentId) {
    const entry = this.agentUsers.get(agentId);
    if (!entry) return;

    const { username } = entry;
    try {
      await this._execAsRoot(`pkill -u ${this._sh(username)} || true`);
      await this._execAsRoot(`rm -rf ${this._userWorkspace(username)}/*`);
    } catch (err) {
      console.warn(`⚠️ [Sandbox] Failed cleanup for user ${username}: ${err.message}`);
    }

    this.agentUsers.delete(agentId);
    console.log(`🗑️  [Sandbox] Detached agent ${agentId} from shared sandbox user "${username}"`);
  }

  async destroyAll() {
    this.agentUsers.clear();
    await this._forceRemove(this.sharedContainerName);
    console.log('🗑️  [Sandbox] Destroyed shared sandbox container');
  }

  async cleanupOrphans() {
    // In shared mode, orphans are only the shared container itself.
    // If it exists but is stopped, remove it so it can be recreated cleanly.
    try {
      const { stdout } = await execAsync(
        `docker ps -a --filter "name=^/${this.sharedContainerName}$" --format "{{.Names}} {{.Status}}"`
      );
      const line = stdout.trim();
      if (!line) return;
      if (line.includes('Exited') || line.includes('Created')) {
        await this._forceRemove(this.sharedContainerName);
        console.log(`🧹 [Sandbox] Removed stale shared container ${this.sharedContainerName}`);
      }
    } catch (err) {
      console.warn(`⚠️ [Sandbox] cleanupOrphans failed: ${err.message}`);
    }
  }

  async runInSandbox(agentId, command, { cwd = null, timeout = 120000 } = {}) {
    const entry = this.agentUsers.get(agentId);
    if (!entry) {
      throw new Error(`Sandbox not initialized for agent ${agentId}`);
    }

    const { username, project } = entry;
    const effectiveCwd = cwd || (project ? `${this._userWorkspace(username)}/${project}` : this._userWorkspace(username));

    const escapedCmd = this._sh(command);
    const escapedCwd = this._sh(effectiveCwd);
    const user = this._sh(username);

    const dockerExec = [
      `docker exec`,
      `-u ${user}`,
      `${this.sharedContainerName}`,
      `/bin/bash -lc`,
      this._sh(`cd ${escapedCwd} && ${escapedCmd}`)
    ].join(' ');

    try {
      const { stdout, stderr } = await execAsync(dockerExec, { timeout, maxBuffer: 10 * 1024 * 1024 });
      return { stdout, stderr };
    } catch (err) {
      const message = err.stderr || err.stdout || err.message;
      throw new Error(message);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────

  async _switchProject(agentId, newProject) {
    const entry = this.agentUsers.get(agentId);
    if (!entry) {
      throw new Error(`Sandbox not initialized for agent ${agentId}`);
    }

    const { username } = entry;
    await this._execAsRoot(`rm -rf ${this._userWorkspace(username)}/*`);

    if (newProject) {
      await this._cloneProjectForUser(username, newProject);
    }

    entry.project = newProject;
    console.log(`📦 [Sandbox] User "${username}" switched to project "${newProject}"`);
  }

  async _ensureSharedContainerRunning() {
    if (await this._isRunning(this.sharedContainerName)) return;

    await this._forceRemove(this.sharedContainerName);

    const cmd = [
      'docker run -d',
      `--name ${this.sharedContainerName}`,
      '--restart unless-stopped',
      `--network ${this.network}`,
      '-v /projects:/projects',
      `${this.sharedImage}`,
      'tail -f /dev/null'
    ].join(' ');

    await execAsync(cmd);
    console.log(`📦 [Sandbox] Started shared sandbox container ${this.sharedContainerName}`);
  }

  async _ensureLinuxUser(username) {
    const userEsc = this._sh(username);
    const home = this._sh(`/home/${username}`);
    const workspace = this._sh(this._userWorkspace(username));

    await this._execAsRoot(
      `id -u ${userEsc} >/dev/null 2>&1 || useradd -m -d ${home} -s /bin/bash ${userEsc}`
    );
    await this._execAsRoot(`mkdir -p ${workspace}`);
    await this._execAsRoot(`chown -R ${userEsc}:${userEsc} ${workspace}`);
  }

  async _ensureAgentWorkspace(username) {
    const workspace = this._sh(this._userWorkspace(username));
    const userEsc = this._sh(username);
    await this._execAsRoot(`mkdir -p ${workspace} && chown -R ${userEsc}:${userEsc} ${workspace}`);
  }

  async _cloneProjectForUser(username, project) {
    const gitUrl = process.env.GITHUB_REPO_URL;
    if (!gitUrl) {
      throw new Error('GITHUB_REPO_URL is required to clone project into sandbox');
    }

    const userEsc = this._sh(username);
    const workspace = this._userWorkspace(username);
    const target = `${workspace}/${project}`;

    await this._execAsRoot(`rm -rf ${this._sh(target)}`);
    await this._execAsRoot(`mkdir -p ${this._sh(workspace)} && chown -R ${userEsc}:${userEsc} ${this._sh(workspace)}`);

    const cloneCmd = [
      'docker exec',
      `-u ${userEsc}`,
      this.sharedContainerName,
      '/bin/bash -lc',
      this._sh(`git clone "${gitUrl}" ${this._sh(target)}`)
    ].join(' ');

    await execAsync(cloneCmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });

    const gitName = process.env.GIT_USER_NAME;
    const gitEmail = process.env.GIT_USER_EMAIL;
    if (gitName) {
      await this._execAsUser(username, `git config --global user.name "${gitName}"`);
    }
    if (gitEmail) {
      await this._execAsUser(username, `git config --global user.email "${gitEmail}"`);
    }
  }

  async _execAsRoot(command, { timeout = 120000 } = {}) {
    const cmd = [
      'docker exec',
      this.sharedContainerName,
      '/bin/bash -lc',
      this._sh(command)
    ].join(' ');
    return execAsync(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
  }

  async _execAsUser(username, command, { timeout = 120000 } = {}) {
    const userEsc = this._sh(username);
    const cmd = [
      'docker exec',
      `-u ${userEsc}`,
      this.sharedContainerName,
      '/bin/bash -lc',
      this._sh(command)
    ].join(' ');
    return execAsync(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 });
  }

  async _isRunning(containerName) {
    try {
      const { stdout } = await execAsync(`docker inspect -f "{{.State.Running}}" ${containerName}`);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async _forceRemove(containerName) {
    try {
      await execAsync(`docker rm -f ${containerName}`);
    } catch {
      // ignore
    }
  }

  _containerName(agentId) {
    return `sandbox-${String(agentId).replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
  }

  _username(agentId) {
    const safe = String(agentId).toLowerCase().replace(/[^a-z0-9]/g, '');
    return `agent_${safe.slice(0, 24) || 'user'}`;
  }

  _userWorkspace(username) {
    return `${this.baseWorkspace}/${username}`;
  }

  _sh(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }
}

export const sandboxManager = new SandboxManager();