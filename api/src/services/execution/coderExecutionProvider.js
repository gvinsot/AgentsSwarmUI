// ─── CoderExecutionProvider: Claude Code / coder-service HTTP backend ───────
//
// Implements the ExecutionProvider interface by calling the coder-service
// FastAPI endpoints (exec-shell, projects/ensure, etc.) over HTTP.
// This provider is used for agents whose LLM config has managesContext=true.

import { ExecutionProvider } from './executionProvider.js';

export class CoderExecutionProvider extends ExecutionProvider {
  /**
   * @param {{ baseUrl?: string, apiKey?: string }} options
   */
  constructor(options = {}) {
    super();
    this.baseUrl = options.baseUrl || process.env.CODER_SERVICE_URL || 'http://coder-service:8000';
    this.apiKey = options.apiKey || process.env.CODER_API_KEY || '';
    this._agents = new Map(); // agentId -> { project, ready }
    this._fileTreeCache = new Map(); // agentId -> { project, tree, timestamp }
    this.ownerIds = new Map(); // agentId -> ownerId
  }

  /**
   * Associate an owner ID with an agent so all HTTP requests include X-Owner-Id.
   * Called by agentManager when it knows the owner for a coder agent.
   */
  setOwner(agentId, ownerId) {
    if (ownerId) this.ownerIds.set(agentId, ownerId);
  }

  // ── ExecutionProvider interface ───────────────────────────────────────

  async ensureProject(agentId, project = null, gitUrl = null) {
    console.log(`🤖 [Coder] ensureProject(agent=${agentId.slice(0, 8)}, project=${project || 'none'}, gitUrl=${gitUrl ? 'yes' : 'no'})`);

    if (!project || !gitUrl) {
      this._agents.set(agentId, { project: null, ready: true });
      return;
    }

    try {
      const res = await fetch(`${this.baseUrl}/projects/ensure`, {
        method: 'POST',
        headers: this._headers(agentId),
        body: JSON.stringify({ project, git_url: gitUrl }),
      });
      const data = await res.json();
      if (data.status === 'error') {
        throw new Error(data.error || 'Project ensure failed');
      }
      this._agents.set(agentId, { project, ready: true });
      console.log(`🤖 [Coder] Project "${project}" ready for agent ${agentId.slice(0, 8)}`);

      // Generate file tree after project setup
      await this.refreshFileTree(agentId);
    } catch (err) {
      console.error(`🤖 [Coder] ensureProject failed: ${err.message}`);
      throw err;
    }
  }

  async switchProject(agentId, newProject, gitUrl = null) {
    this._fileTreeCache.delete(agentId);
    await this.ensureProject(agentId, newProject, gitUrl);
  }

  async destroySandbox(agentId) {
    this._agents.delete(agentId);
    this._fileTreeCache.delete(agentId);
    this.ownerIds.delete(agentId);
    console.log(`🗑️  [Coder] Cleared state for agent ${agentId.slice(0, 8)}`);
  }

  async destroyAll() {
    this._agents.clear();
    this._fileTreeCache.clear();
    this.ownerIds.clear();
    console.log('🗑️  [Coder] Cleared all agent states');
  }

  hasEnvironment(agentId) {
    return this._agents.has(agentId);
  }

  getProject(agentId) {
    return this._agents.get(agentId)?.project || null;
  }

  getFileTree(agentId) {
    const cached = this._fileTreeCache.get(agentId);
    if (!cached) return null;
    const entry = this._agents.get(agentId);
    if (!entry || entry.project !== cached.project) return null;
    return cached.tree;
  }

  async refreshFileTree(agentId) {
    const entry = this._agents.get(agentId);
    if (!entry || !entry.project) return;

    try {
      const { stdout } = await this._execShell(agentId, 'ls -1F . | head -100', 10);
      const lines = stdout.trim().split('\n').filter(l => l);
      if (lines.length === 0) {
        this._fileTreeCache.set(agentId, { project: entry.project, tree: null, timestamp: Date.now() });
        return;
      }
      const tree = lines.join('\n');
      this._fileTreeCache.set(agentId, { project: entry.project, tree, timestamp: Date.now() });
      console.log(`🌳 [Coder] File tree cached for agent ${agentId.slice(0, 8)} (${lines.length} entries)`);
    } catch (err) {
      console.warn(`⚠️  [Coder] Failed to generate file tree for ${agentId.slice(0, 8)}: ${err.message}`);
    }
  }

  // ── File operations ───────────────────────────────────────────────────

  async readFile(agentId, filePath) {
    const { stdout } = await this._execShell(agentId, `cat ${this._sh(filePath)}`, 10);
    return stdout;
  }

  async writeFile(agentId, filePath, content) {
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dirPath) {
      await this._execShell(agentId, `mkdir -p ${this._sh(dirPath)}`, 10);
    }
    // Use base64 to safely transfer file contents with arbitrary characters
    const b64 = Buffer.from(content).toString('base64');
    await this._execShell(agentId, `echo '${b64}' | base64 -d > ${this._sh(filePath)}`, 30);
  }

  async appendFile(agentId, filePath, content) {
    const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
    if (dirPath) {
      await this._execShell(agentId, `mkdir -p ${this._sh(dirPath)}`, 10);
    }
    const b64 = Buffer.from(content).toString('base64');
    await this._execShell(agentId, `echo '${b64}' | base64 -d >> ${this._sh(filePath)}`, 30);
  }

  async listDir(agentId, dirPath) {
    const { stdout } = await this._execShell(agentId, `ls -1F ${this._sh(dirPath)} | head -200`, 10);
    return stdout;
  }

  async searchFiles(agentId, pattern, query) {
    const { stdout: matches } = await this._execShell(
      agentId,
      `grep -r -n -i --include ${this._sh(pattern)} -- ${this._sh(query)} . 2>/dev/null | head -50`,
      15
    );
    return matches;
  }

  // ── Command execution ─────────────────────────────────────────────────

  async exec(agentId, command, options = {}) {
    const timeout = Math.min(Math.ceil((options.timeout || 300000) / 1000), 120);
    const { stdout, stderr } = await this._execShell(agentId, command, timeout);
    return { stdout, stderr };
  }

  // ── Git operations ────────────────────────────────────────────────────

  async gitCommitPush(agentId, message) {
    const safeMsg = sanitizeCommitMessage(message);
    let commitHash = null;
    let commitOutput = '';

    try {
      // Step 1: Stage all changes
      await this._execShell(agentId, 'git add -A', 15);

      // Step 2: Check for staged changes
      let hasStagedChanges = false;
      try {
        await this._execShell(agentId, 'git diff --cached --quiet', 10);
        hasStagedChanges = false;
      } catch {
        hasStagedChanges = true;
      }

      if (!hasStagedChanges) {
        return { success: true, result: 'Nothing to commit — working tree clean.' };
      }

      // Step 3: Ensure git config
      const gitName = process.env.GIT_USER_NAME || 'PulsarTeam';
      const gitEmail = process.env.GIT_USER_EMAIL || 'agent@pulsarteam.local';
      await this._execShell(
        agentId,
        `git config user.name >/dev/null 2>&1 || git config user.name '${gitName.replace(/'/g, "'\\''")}'; git config user.email >/dev/null 2>&1 || git config user.email '${gitEmail.replace(/'/g, "'\\''")}'`,
        10
      );

      // Step 4: Commit
      const { stdout: commitOut } = await this._execShell(agentId, `git commit -m '${safeMsg}'`, 30);
      commitOutput = commitOut;
      commitHash = extractCommitHash(commitOutput);
      if (!commitHash) {
        try {
          const { stdout: revOut } = await this._execShell(agentId, 'git rev-parse --short HEAD', 5);
          commitHash = revOut.trim() || null;
        } catch { /* ignore */ }
      }

      // Step 5 & 6: Pull --rebase + Push with retry (up to 3 attempts)
      const GIT_SSH = 'GIT_SSH_COMMAND="ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"';
      const MAX_PUSH_RETRIES = 3;
      let pushOut = '';
      let pushSuccess = false;

      for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
        // Pull --rebase to integrate remote changes
        try {
          await this._execShell(agentId, `${GIT_SSH} git pull --rebase --autostash`, 60);
        } catch (pullErr) {
          try { await this._execShell(agentId, 'git rebase --abort', 10); } catch { /* ignore */ }
          if (attempt === MAX_PUSH_RETRIES) {
            return {
              success: false,
              error: `Push failed after ${MAX_PUSH_RETRIES} attempts: remote has conflicting changes that could not be auto-rebased.`,
              result: `${commitOutput}\n\nPull --rebase failed (attempt ${attempt}/${MAX_PUSH_RETRIES}):\n${pullErr.stdout || pullErr.message}\n\nYour commit is saved locally. Use @run_command(git push origin main) to retry manually.`.trim().slice(0, 5000),
              meta: { commitHash }
            };
          }
          console.warn(`[git_commit_push] Pull --rebase failed (attempt ${attempt}/${MAX_PUSH_RETRIES}), retrying...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }

        // Push
        try {
          const { stdout: out } = await this._execShell(agentId, `${GIT_SSH} git push`, 60);
          pushOut = out;
        } catch (pushErr) {
          if (attempt === MAX_PUSH_RETRIES) {
            return {
              success: false,
              error: `Push failed after ${MAX_PUSH_RETRIES} attempts: ${pushErr.message || 'unknown error'}`,
              result: `${commitOutput}\n\nPush failed (attempt ${attempt}/${MAX_PUSH_RETRIES}):\n${pushErr.stdout || pushErr.message}\n\nYour commit is saved locally. Use @run_command(git push origin main) to retry manually.`.trim().slice(0, 5000),
              meta: { commitHash }
            };
          }
          console.warn(`[git_commit_push] Push failed (attempt ${attempt}/${MAX_PUSH_RETRIES}), retrying...`);
          await new Promise(r => setTimeout(r, 1000 * attempt));
          continue;
        }

        pushSuccess = true;
        break;
      }

      // Re-capture hash after rebase
      try {
        const { stdout: revOut } = await this._execShell(agentId, 'git rev-parse --short HEAD', 5);
        commitHash = revOut.trim() || commitHash;
      } catch { /* keep original */ }

      // Step 7: Verify push actually reached the remote
      try {
        const { stdout: localHead } = await this._execShell(agentId, 'git rev-parse HEAD', 5);
        const { stdout: remoteHead } = await this._execShell(agentId, `${GIT_SSH} git ls-remote origin HEAD`, 10);
        const localSha = localHead.trim();
        const remoteSha = (remoteHead.trim().split(/\s/)[0] || '').trim();
        if (remoteSha && localSha && !remoteSha.startsWith(localSha.slice(0, 7)) && localSha !== remoteSha) {
          console.warn(`[git_commit_push] Push verification: local HEAD ${localSha.slice(0, 8)} != remote HEAD ${remoteSha.slice(0, 8)}`);
          return {
            success: false,
            error: `Push appeared to succeed but verification failed: local HEAD (${localSha.slice(0, 8)}) does not match remote HEAD (${remoteSha.slice(0, 8)}). Use @run_command(git push origin main) to retry.`,
            result: `${commitOutput}\n${pushOut}\n\n⚠️ Push verification FAILED. Use @run_command(git push origin main 2>&1) to push manually.`.trim().slice(0, 5000),
            meta: { commitHash }
          };
        }
        console.log(`[git_commit_push] Push verified: local=${localSha.slice(0, 8)} remote=${remoteSha.slice(0, 8)}`);
      } catch (verifyErr) {
        console.warn(`[git_commit_push] Push verification check failed (non-fatal): ${verifyErr.message}`);
      }

      const output = [commitOutput, pushOut, `✅ Push verified on remote.`].filter(Boolean).join('\n').trim();
      return { success: true, result: output.slice(0, 10000), meta: { commitHash } };
    } catch (err) {
      const fullOutput = [commitOutput, err.stdout || err.message].filter(Boolean).join('\n').trim();
      return {
        success: false,
        error: err.message,
        result: fullOutput.slice(0, 5000),
        meta: { commitHash }
      };
    }
  }

  // ── Backward compatibility aliases ────────────────────────────────────

  /** @deprecated Use ensureProject() */
  async ensureSandbox(agentId, project = null, gitUrl = null) {
    return this.ensureProject(agentId, project, gitUrl);
  }
  /** @deprecated Use hasEnvironment() */
  hasSandbox(agentId) {
    return this.hasEnvironment(agentId);
  }
  /** @deprecated Use getProject() */
  getSandboxProject(agentId) {
    return this.getProject(agentId);
  }

  // ── Private HTTP helpers ──────────────────────────────────────────────

  _headers(agentId, ownerId = null) {
    const resolvedOwner = ownerId || (agentId ? this.ownerIds.get(agentId) : null) || null;
    const h = {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (agentId) h['X-Agent-Id'] = agentId;
    if (resolvedOwner) h['X-Owner-Id'] = resolvedOwner;
    return h;
  }

  /**
   * Execute a shell command on the coder-service via /exec-shell.
   * Returns { stdout, stderr } to match the sandbox exec interface.
   */
  async _execShell(agentId, command, timeoutSecs = 60) {
    const res = await fetch(`${this.baseUrl}/exec-shell`, {
      method: 'POST',
      headers: this._headers(agentId),
      body: JSON.stringify({ command, timeout: timeoutSecs }),
    });
    const data = await res.json();
    if (data.status !== 'success') {
      const err = new Error(data.error || 'Command failed');
      err.stdout = data.output || '';
      err.stderr = data.output || '';
      throw err;
    }
    return { stdout: data.output || '', stderr: '' };
  }

  _sh(value) {
    return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function sanitizeCommitMessage(msg) {
  if (!msg || typeof msg !== 'string') return 'update';
  return msg
    .replace(/[\x00]/g, '')
    .replace(/[`$\\!]/g, '')
    .replace(/\r?\n/g, ' ')
    .replace(/'/g, "'\\''")
    .slice(0, 500);
}

function extractCommitHash(text) {
  if (!text) return null;
  const match = text.match(/\[[^\]]*\s([a-f0-9]{7,40})\]/);
  if (match) return match[1];
  const lineMatch = text.match(/^([a-f0-9]{40})$/m);
  return lineMatch ? lineMatch[1] : null;
}
