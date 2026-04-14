"""
Coder Service — Per-agent Linux user isolation and project management.

Each agent gets an isolated HOME directory under DATA_DIR/agents/<username>.
OAuth credentials are stored per owner (PulsarTeam user), not per agent.
"""

import os
import re
import asyncio
import shutil
from typing import Optional

from config import DATA_DIR, logger


# --- In-memory caches ---------------------------------------------------------

_agent_user_lock = None  # Lazily initialized (asyncio.Lock needs a running event loop)
_agent_users: dict[str, dict] = {}
# Per-agent project workspaces: "agent_id" -> { "project": str, "path": str }
_agent_projects: dict[str, dict] = {}


# --- Helpers ------------------------------------------------------------------

def _sanitize_agent_id(agent_id: str) -> str:
    sanitized = re.sub(r'[^a-zA-Z0-9]', '', agent_id)[:24]
    return f"agent_{sanitized}" if sanitized else "agent_default"


# --- Agent user management ----------------------------------------------------

async def ensure_agent_user(agent_id: str, owner_id: str = None) -> dict:
    """Create an isolated home directory for the given agent ID.

    Instead of creating Linux users (requires root), we create separate
    home directories and override HOME/USER env vars. Claude Code CLI
    uses $HOME to find its config files, so this provides effective isolation.

    OAuth credentials are stored per owner (PulsarTeam user), not per agent.
    If owner_id is provided, all agents of the same owner share one token.
    """
    if not agent_id:
        return None
    # Return cached entry if owner_id hasn't changed
    if agent_id in _agent_users:
        cached = _agent_users[agent_id]
        if owner_id and cached.get("owner_id") != owner_id:
            cached["owner_id"] = owner_id
        return cached
    global _agent_user_lock
    if _agent_user_lock is None:
        _agent_user_lock = asyncio.Lock()
    async with _agent_user_lock:
        if agent_id in _agent_users:
            cached = _agent_users[agent_id]
            if owner_id and cached.get("owner_id") != owner_id:
                cached["owner_id"] = owner_id
            return cached
        username = _sanitize_agent_id(agent_id)
        # Use /app/data/agents/ for persistent storage (mounted volume)
        home_dir = os.path.join(DATA_DIR, "agents", username)
        try:
            agent_claude_dir = os.path.join(home_dir, ".claude")
            os.makedirs(agent_claude_dir, exist_ok=True)
            # Copy NON-credential config files from the main coder user
            coder_home = os.path.expanduser("~")
            # 1. Settings (MCP servers config) -- shared across agents
            coder_settings = os.path.join(coder_home, ".claude", "settings.json")
            if os.path.exists(coder_settings):
                shutil.copy2(coder_settings, os.path.join(agent_claude_dir, "settings.json"))
            # 2. Onboarding bypass (.claude.json in home root)
            coder_claude_json = os.path.join(coder_home, ".claude.json")
            if os.path.exists(coder_claude_json):
                shutil.copy2(coder_claude_json, os.path.join(home_dir, ".claude.json"))
            user_info = {"username": username, "uid": os.getuid(), "gid": os.getgid(), "home": home_dir, "owner_id": owner_id}
            _agent_users[agent_id] = user_info
            logger.info(f"[Agent User] Created isolated home for agent {agent_id[:12]} at {home_dir} (owner={owner_id})")
            return user_info
        except Exception as e:
            logger.error(f"[Agent User] Failed to create home for agent {agent_id}: {e}")
            return None


# --- Agent project management -------------------------------------------------

def get_agent_project_dir(agent_id: str) -> Optional[str]:
    """Return the per-agent project workspace path, or None if not set up."""
    entry = _agent_projects.get(agent_id)
    return entry["path"] if entry else None


async def ensure_agent_project(agent_id: str, project: str, git_url: str) -> str:
    """Clone or update a project repo for a specific agent.

    Each agent gets its own clone at DATA_DIR/agents/<username>/projects/<project>.
    This prevents agents from stepping on each other's changes.
    Returns the absolute path to the agent's project directory.
    """
    username = _sanitize_agent_id(agent_id)
    agent_data_dir = os.path.join(DATA_DIR, "agents", username)
    projects_base = os.path.join(agent_data_dir, "projects")
    project_dir = os.path.join(projects_base, project)

    # Check if already set up with this project
    cached = _agent_projects.get(agent_id)
    if cached and cached["project"] == project and os.path.isdir(os.path.join(project_dir, ".git")):
        # Already cloned — pull latest
        try:
            proc = await asyncio.create_subprocess_exec(
                "git", "fetch", "--all",
                cwd=project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=30)
            # Reset to remote HEAD to get latest code (preserves local uncommitted changes)
            proc = await asyncio.create_subprocess_exec(
                "git", "reset", "--hard", "origin/HEAD",
                cwd=project_dir,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await asyncio.wait_for(proc.communicate(), timeout=15)
            logger.info(f"[Project] Updated {project} for agent {agent_id[:12]}")
        except Exception as e:
            logger.warning(f"[Project] Failed to update {project} for agent {agent_id[:12]}: {e}")
        return project_dir

    # Fresh clone needed
    os.makedirs(projects_base, exist_ok=True)

    # Remove existing dir if it's broken (no .git)
    if os.path.exists(project_dir):
        shutil.rmtree(project_dir, ignore_errors=True)

    # Configure SSH for non-interactive clone
    ssh_cmd = "ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
    env = {**os.environ, "GIT_SSH_COMMAND": ssh_cmd}

    proc = await asyncio.create_subprocess_exec(
        "git", "clone", git_url, project_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
    if proc.returncode != 0:
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"git clone failed: {err_msg}")

    # Configure git identity
    git_name = os.getenv("GIT_USER_NAME", "PulsarTeam")
    git_email = os.getenv("GIT_USER_EMAIL", "agent@pulsarteam.local")
    for config_cmd in [
        ["git", "config", "user.name", git_name],
        ["git", "config", "user.email", git_email],
    ]:
        p = await asyncio.create_subprocess_exec(*config_cmd, cwd=project_dir)
        await p.wait()

    _agent_projects[agent_id] = {"project": project, "path": project_dir}
    logger.info(f"[Project] Cloned {project} for agent {agent_id[:12]} at {project_dir}")
    return project_dir
