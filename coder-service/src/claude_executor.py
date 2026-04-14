"""
Coder Service — Claude Code CLI execution (sync and streaming).

Builds the CLI command, manages sessions, runs the subprocess,
and handles auth errors / token refresh during execution.
"""

import os
import json
import time
import uuid
import asyncio
from typing import Optional

from config import (
    CLAUDE_MODEL, CLAUDE_MAX_TURNS, CLAUDE_CWD, TIMEOUT,
    PROJECTS_DIR, ALLOWED_TOOLS, SYSTEM_PROMPT, VERBOSE,
    logger,
)
from agent_user import ensure_agent_user, get_agent_project_dir
from token_store import (
    get_agent_env, get_subprocess_kwargs,
    load_saved_token, get_saved_refresh_token,
    save_agent_token, save_owner_token,
    resolve_token,
    is_token_expired, is_agent_token_expired,
    get_token_cooldown_until,
    refresh_oauth_token, refresh_agent_token,
)
from auth_oauth import (
    try_exchange_code_from_prompt,
    get_login_url, initiate_agent_login, initiate_owner_login,
)


# --- Session management -------------------------------------------------------

# Map (agent_id, task_id) -> UUID session for --resume support.
# When task_id changes for an agent, a new session is created automatically.
_agent_sessions: dict[str, str] = {}  # "agent_id:task_id" -> session UUID
_agent_current_task: dict[str, str] = {}  # agent_id -> current task_id

MAX_AUTH_RETRIES = 2


def get_agent_sessions() -> dict[str, str]:
    """Return the sessions dict (for use by routes that need to reset sessions)."""
    return _agent_sessions


def get_agent_current_task() -> dict[str, str]:
    """Return the current-task dict (for use by routes that need to reset sessions)."""
    return _agent_current_task


# --- Command builder ----------------------------------------------------------

def _build_claude_cmd(output_format: str = "json", system_prompt: Optional[str] = None, agent_id: Optional[str] = None, task_id: Optional[str] = None) -> tuple[list[str], str]:
    """Build the claude CLI command with appropriate flags.

    The prompt is passed via stdin (not as a CLI argument) to avoid
    'Argument list too long' errors with large conversation histories.

    When agent_id is provided, session persistence is used:
    - Sessions are keyed by (agent_id, task_id) so that each task gets its own session.
    - When a new task_id is provided, a fresh session is created automatically.
    - Within the same task, sessions are resumed to maintain context.
    This lets Claude Code maintain full context within a task execution.
    """
    cmd = [
        "claude",
        "-p",
        "--output-format", output_format,
        "--max-turns", str(CLAUDE_MAX_TURNS),
        "--model", CLAUDE_MODEL,
        # Headless mode: skip all permission prompts so the agent can run autonomously
        "--dangerously-skip-permissions",
        "--effort", "high",
    ]

    # Session persistence: keyed by (agent_id, task_id)
    if agent_id:
        # Determine session key — include task_id when available
        session_key = f"{agent_id}:{task_id}" if task_id else agent_id

        # Detect task change: if task_id changed for this agent, invalidate old session
        if task_id:
            prev_task = _agent_current_task.get(agent_id)
            if prev_task and prev_task != task_id:
                # Task changed — remove old session for previous task
                old_key = f"{agent_id}:{prev_task}"
                if old_key in _agent_sessions:
                    old_session = _agent_sessions.pop(old_key)
                    logger.info(f"[Session] Task changed for agent {agent_id[:12]}: {prev_task[:12]}→{task_id[:12]}, discarding old session {old_session[:12]}")
                # Also remove agent-only key (legacy)
                _agent_sessions.pop(agent_id, None)
            _agent_current_task[agent_id] = task_id

        session_id = _agent_sessions.get(session_key)
        if session_id:
            cmd.extend(["--resume", session_id])
            logger.info(f"[Session] Resuming session {session_id[:12]}... for agent {agent_id[:12]} (task={task_id[:12] if task_id else 'none'})")
        else:
            session_id = str(uuid.uuid4())
            _agent_sessions[session_key] = session_id
            cmd.extend(["--session-id", session_id])
            logger.info(f"[Session] New session {session_id[:12]}... for agent {agent_id[:12]} (task={task_id[:12] if task_id else 'none'})")

    # Append to the default system prompt instead of replacing it, so Claude Code
    # retains its built-in tool knowledge and capabilities.
    sp = system_prompt or SYSTEM_PROMPT
    if sp:
        cmd.extend(["--append-system-prompt", sp])

    # --verbose is required for stream-json output format in print mode
    if VERBOSE or output_format == "stream-json":
        cmd.append("--verbose")

    if ALLOWED_TOOLS:
        for tool in ALLOWED_TOOLS.split(","):
            tool = tool.strip()
            if tool:
                cmd.extend(["--allowedTools", tool])

    # Determine the working directory for Claude Code.
    # If the agent has a per-agent project clone, use it as cwd so Claude Code
    # works directly in the repo (can see git status, modify files, commit, etc.).
    # Otherwise, fall back to /app and add the shared PROJECTS_DIR as read context.
    agent_project_dir = get_agent_project_dir(agent_id) if agent_id else None
    if agent_project_dir and os.path.isdir(agent_project_dir):
        cwd = agent_project_dir
    else:
        cwd = CLAUDE_CWD
        # Give Claude Code access to the projects directory without using it as cwd.
        # This avoids loading stale CLAUDE.md files from mounted project volumes.
        if os.path.isdir(PROJECTS_DIR):
            cmd.extend(["--add-dir", PROJECTS_DIR])

    return cmd, cwd


# --- Synchronous execution ----------------------------------------------------

async def run_claude_sync(prompt: str, system_prompt: Optional[str] = None, agent_id: Optional[str] = None, owner_id: Optional[str] = None, task_id: Optional[str] = None) -> dict:
    """Execute a prompt via Claude Code CLI and return parsed result.

    Uses asyncio.create_subprocess_exec instead of asyncio.to_thread to avoid
    dependency on the thread pool executor (which causes 'Executor shutdown has
    been called' errors during server restart/shutdown).
    """
    # If any OAuth flow is pending (per-owner, per-agent, or global),
    # check if the prompt contains a verification code and exchange it.
    exchange_result = await try_exchange_code_from_prompt(prompt, agent_id=agent_id, owner_id=owner_id)
    if exchange_result is not None:
        if exchange_result.get("status") == "authenticated":
            return {
                "status": "success",
                "output": f"Authentication successful ({exchange_result.get('email', '')}). You can now send your request.",
            }
        return {
            "status": "auth_required",
            "output": "",
            "error": exchange_result.get("message", "Token exchange failed."),
        }

    # Resolve agent-specific Linux user for isolation
    agent_user = await ensure_agent_user(agent_id, owner_id=owner_id) if agent_id else None
    cooldown = get_token_cooldown_until()

    # Proactively refresh token if expired (skip if in cooldown from a recent 429)
    if agent_user:
        # Per-agent token refresh
        if is_agent_token_expired(agent_user) and time.time() >= cooldown:
            refreshed = await refresh_agent_token(agent_user)
            if not refreshed and not resolve_token(agent_user):
                _owner_id = agent_user.get("owner_id")
                login_url = initiate_owner_login(_owner_id) if _owner_id else initiate_agent_login(agent_id)
                return {
                    "status": "auth_required",
                    "output": "",
                    "error": f"OAuth token expired and refresh token is invalid. Please re-authenticate: {login_url}",
                    "login_url": login_url,
                }
    else:
        if is_token_expired() and time.time() >= cooldown:
            refreshed = await refresh_oauth_token()
            if not refreshed and not load_saved_token():
                login_url = await get_login_url()
                return {
                    "status": "auth_required",
                    "output": "",
                    "error": f"OAuth token expired and refresh token is invalid. Please re-authenticate: {login_url}",
                    "login_url": login_url,
                }

    agent_label = f" (user={agent_user['username']})" if agent_user else ""

    async def _run_sync_proc(aid: Optional[str]):
        """Run a Claude CLI subprocess synchronously. Returns (proc, stdout, stderr)."""
        cmd, proc_cwd = _build_claude_cmd(output_format="json", system_prompt=system_prompt, agent_id=aid, task_id=task_id)
        logger.info(f"Executing Claude Code{agent_label}: {prompt[:100]}...")
        logger.debug(f"Command: {' '.join(cmd)} (cwd={proc_cwd})")
        p = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=proc_cwd,
            env=get_agent_env(agent_user),
            **get_subprocess_kwargs(agent_user),
        )
        so, se = await asyncio.wait_for(
            p.communicate(input=prompt.encode("utf-8")),
            timeout=TIMEOUT,
        )
        return p, so, se

    proc = None
    try:
        try:
            proc, stdout_bytes, stderr_bytes = await _run_sync_proc(agent_id)
        except BrokenPipeError:
            # --resume failed (session no longer exists) — reset and retry
            session_key = f"{agent_id}:{task_id}" if agent_id and task_id else agent_id
            if session_key and session_key in _agent_sessions:
                logger.warning(f"[Session] Resume failed for agent {agent_id[:12]} — creating new session")
                _agent_sessions.pop(session_key, None)
                proc, stdout_bytes, stderr_bytes = await _run_sync_proc(agent_id)
            else:
                raise
    except asyncio.TimeoutError:
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
            else:
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    proc.kill()
        return {"status": "timeout", "output": "", "error": f"Execution timeout after {TIMEOUT}s"}
    except asyncio.CancelledError:
        if proc and proc.returncode is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        raise

    stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
    stderr = stderr_bytes.decode("utf-8", errors="replace").strip()

    # Detect auth errors -- auto-trigger login flow or token refresh
    combined = f"{stdout} {stderr}".lower()
    if "token has expired" in combined or ("authentication_error" in combined and "401" in combined):
        if agent_user:
            logger.warning(f"Agent {agent_user['username']} auth error: token expired, attempting refresh...")
            refreshed = await refresh_agent_token(agent_user)
            if refreshed:
                logger.info("Agent token refreshed, retrying request...")
                return await run_claude_sync(prompt, system_prompt, agent_id=agent_id, owner_id=owner_id)
            login_url = initiate_owner_login(agent_user['owner_id']) if agent_user.get('owner_id') else initiate_agent_login(agent_id)
            return {
                "status": "auth_required",
                "output": "",
                "error": f"OAuth token expired and refresh failed. Please re-authenticate: {login_url}",
                "login_url": login_url,
            }
        else:
            logger.warning("Claude Code auth error: token expired, attempting refresh...")
            refreshed = await refresh_oauth_token()
            if refreshed:
                logger.info("Token refreshed, retrying request...")
                return await run_claude_sync(prompt, system_prompt)
            login_url = await get_login_url()
            return {
                "status": "auth_required",
                "output": "",
                "error": f"OAuth token expired and refresh failed. Please re-authenticate: {login_url}",
                "login_url": login_url,
            }

    if "not logged in" in combined:
        if agent_user:
            logger.warning(f"Agent {agent_user['username']} not logged in")
            login_url = initiate_owner_login(agent_user['owner_id']) if agent_user.get('owner_id') else initiate_agent_login(agent_id)
            return {
                "status": "auth_required",
                "output": "",
                "error": f"Not authenticated. Please re-authenticate: {login_url}",
                "login_url": login_url,
            }
        logger.warning("Claude Code auth error: not logged in, initiating login flow...")
        login_url = await get_login_url()
        if login_url:
            return {
                "status": "auth_required",
                "output": "",
                "error": f"Not authenticated. Open this URL: {login_url} -- then send the verification code as your next message.",
                "login_url": login_url,
            }
        return {
            "status": "auth_required",
            "output": "",
            "error": "Not authenticated. Call POST /auth/login to start, or POST a token to /auth/token.",
        }

    if proc.returncode != 0 and not stdout:
        error_msg = stderr if stderr else f"Claude Code exited with code {proc.returncode}"
        logger.error(f"Claude Code error: {error_msg}")
        return {"status": "error", "output": "", "error": error_msg}

    # Parse JSON output
    try:
        parsed = json.loads(stdout)
        output_text = parsed.get("result", stdout)
        cost = parsed.get("cost_usd", 0)
        duration = parsed.get("duration_ms", 0)
        # Token data: Claude CLI stores it in a usage sub-object
        usage = parsed.get("usage", {}) or {}
        input_tokens = usage.get("input_tokens", 0) or 0
        output_tokens = usage.get("output_tokens", 0) or 0
        total_tokens = parsed.get("total_tokens", 0) or (input_tokens + output_tokens)

        if VERBOSE:
            logger.info(f"Claude Code completed: cost=${cost:.4f}, duration={duration}ms, tokens={total_tokens} (in={input_tokens}, out={output_tokens})")

        return {
            "status": "success",
            "output": output_text,
            "cost_usd": cost,
            "duration_ms": duration,
            "total_tokens": total_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
    except json.JSONDecodeError:
        # If not valid JSON, treat raw stdout as the result
        return {"status": "success", "output": stdout}


# --- Streaming execution ------------------------------------------------------

async def stream_claude_events(prompt: str, system_prompt: Optional[str] = None, agent_id: Optional[str] = None, owner_id: Optional[str] = None, task_id: Optional[str] = None, _auth_retry: int = 0):
    """Async generator - streams Claude Code events in real-time.

    Yields status updates as the agent works, then the final result.
    """
    # If any OAuth flow is pending (per-owner, per-agent, or global),
    # check if the prompt contains a verification code and exchange it.
    exchange_result = await try_exchange_code_from_prompt(prompt, agent_id=agent_id, owner_id=owner_id)
    if exchange_result is not None:
        if exchange_result.get("status") == "authenticated":
            yield {
                "type": "result",
                "content": f"Authentication successful ({exchange_result.get('email', '')}). You can now send your request.",
            }
            return
        yield {
            "type": "error",
            "content": exchange_result.get("message", "Token exchange failed."),
        }
        return

    # Resolve agent-specific Linux user for isolation
    agent_user = await ensure_agent_user(agent_id, owner_id=owner_id) if agent_id else None
    cooldown = get_token_cooldown_until()

    # Proactively refresh token if expired (skip if in cooldown from a recent 429)
    _owner_id = agent_user.get("owner_id") if agent_user else None
    if agent_user:
        # If no token at all, bootstrap from global token (or owner token)
        if not resolve_token(agent_user):
            global_token = load_saved_token()
            if global_token:
                global_refresh = get_saved_refresh_token()
                if _owner_id:
                    save_owner_token(_owner_id, global_token, refresh_token=global_refresh)
                    logger.info(f"[Owner Auth] Bootstrapped owner {_owner_id} with global token")
                else:
                    save_agent_token(agent_user, global_token, refresh_token=global_refresh)
                    logger.info(f"[Agent Auth] Bootstrapped agent {agent_user['username']} with global token")
        if is_agent_token_expired(agent_user) and time.time() >= cooldown:
            refreshed = await refresh_agent_token(agent_user)
            if not refreshed:
                who = f"owner {_owner_id}" if _owner_id else f"agent {agent_id}"
                # If there's no token left at all (cleared by invalid_grant),
                # don't launch the CLI — it will just fail immediately.
                if not resolve_token(agent_user):
                    logger.error(f"[Auth] No valid token for {who} — requiring re-authentication")
                    if agent_user:
                        login_url = initiate_owner_login(_owner_id) if _owner_id else initiate_agent_login(agent_id)
                    else:
                        login_url = await get_login_url()
                    yield {
                        "type": "error",
                        "content": f"OAuth token expired and refresh token is invalid. Please re-authenticate: {login_url}",
                        "login_url": login_url,
                    }
                    return
                logger.warning(f"[Auth] Proactive token refresh failed for {who}, continuing with existing token...")
    else:
        if is_token_expired() and time.time() >= cooldown:
            refreshed = await refresh_oauth_token()
            if not refreshed:
                if not load_saved_token():
                    logger.error("[Auth] No valid global token — requiring re-authentication")
                    login_url = await get_login_url()
                    yield {
                        "type": "error",
                        "content": f"OAuth token expired and refresh token is invalid. Please re-authenticate: {login_url}",
                        "login_url": login_url,
                    }
                    return
                logger.warning("[Auth] Proactive global token refresh failed, continuing with existing token...")

    agent_label = f" (user={agent_user['username']})" if agent_user else ""

    async def _start_stream_proc(aid: Optional[str]):
        """Start a Claude CLI subprocess for streaming. Returns the process."""
        cmd, proc_cwd = _build_claude_cmd(output_format="stream-json", system_prompt=system_prompt, agent_id=aid, task_id=task_id)
        logger.info(f"Streaming Claude Code{agent_label}: {prompt[:100]}...")
        p = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=proc_cwd,
            env=get_agent_env(agent_user),
            limit=10 * 1024 * 1024,
            **get_subprocess_kwargs(agent_user),
        )
        try:
            p.stdin.write(prompt.encode("utf-8"))
            await p.stdin.drain()
            p.stdin.close()
            await p.stdin.wait_closed()
        except BrokenPipeError:
            # Subprocess exited before reading stdin — capture stderr for diagnostics
            stderr_out = ""
            try:
                stderr_out = (await asyncio.wait_for(p.stderr.read(), timeout=5)).decode("utf-8", errors="replace").strip()
            except Exception:
                pass
            try:
                await asyncio.wait_for(p.wait(), timeout=5)
            except Exception:
                pass
            raise BrokenPipeError(
                f"Claude CLI exited before reading prompt (rc={p.returncode}). "
                f"stderr: {stderr_out[:500]}" if stderr_out else
                f"Claude CLI exited before reading prompt (rc={p.returncode})"
            )
        return p

    try:
        proc = await _start_stream_proc(agent_id)
    except BrokenPipeError:
        # --resume failed (session no longer exists) — reset and retry with new session
        session_key = f"{agent_id}:{task_id}" if agent_id and task_id else agent_id
        if session_key and session_key in _agent_sessions:
            logger.warning(f"[Session] Resume failed for agent {agent_id[:12]} — creating new session")
            _agent_sessions.pop(session_key, None)
            try:
                proc = await _start_stream_proc(agent_id)
            except BrokenPipeError as e:
                logger.error(f"[Session] Retry also failed for agent {agent_id[:12]}: {e}")
                raise
        else:
            raise

    has_content = False  # Track whether any meaningful output was received

    try:
        async for line in proc.stdout:
            line = line.decode("utf-8", errors="replace").strip()
            if not line:
                continue

            # Try to parse JSON first -- auth checks on raw text cause false
            # positives when the CLI includes auth-related words inside normal
            # conversation events (e.g. <synthetic> model messages).
            is_json_event = False
            event = None
            try:
                event = json.loads(line)
                is_json_event = True
            except json.JSONDecodeError:
                pass

            # Detect auth errors -- only on non-JSON lines (raw stderr),
            # JSON events of type "system"/"error", or synthetic CLI messages
            # (model="<synthetic>").  Normal model responses are skipped to
            # avoid false positives when the conversation text mentions auth.
            check_auth = not is_json_event
            if is_json_event and isinstance(event, dict):
                etype = event.get("type", "")
                if etype in ("system", "error"):
                    check_auth = True
                elif etype == "assistant":
                    msg = event.get("message", {})
                    if isinstance(msg, dict) and msg.get("model") == "<synthetic>":
                        check_auth = True

            if check_auth:
                line_lower = line.lower()
                if "token has expired" in line_lower or ("authentication_error" in line_lower and "401" in line_lower):
                    try:
                        proc.terminate()
                    except ProcessLookupError:
                        pass
                    logger.warning(f"Expired token detected in stream: {line[:120]}")
                    if agent_user:
                        refreshed = await refresh_agent_token(agent_user)
                    else:
                        refreshed = await refresh_oauth_token()
                    if refreshed and _auth_retry < MAX_AUTH_RETRIES:
                        yield {"type": "status", "content": "Token refreshed, retrying..."}
                        async for ev in stream_claude_events(prompt, system_prompt, agent_id=agent_id, owner_id=owner_id, task_id=task_id, _auth_retry=_auth_retry + 1):
                            yield ev
                    else:
                        if _auth_retry >= MAX_AUTH_RETRIES:
                            logger.error(f"Auth retry limit ({MAX_AUTH_RETRIES}) reached, aborting")
                        if agent_user:
                            login_url = initiate_owner_login(_owner_id) if _owner_id else initiate_agent_login(agent_id)
                        else:
                            login_url = await get_login_url()
                        yield {
                            "type": "error",
                            "content": f"OAuth token expired and refresh failed. Please re-authenticate: {login_url}",
                            "login_url": login_url,
                        }
                    return

                if "not logged in" in line_lower:
                    try:
                        proc.terminate()
                    except ProcessLookupError:
                        pass
                    if agent_user:
                        # First try refreshing the agent's own token
                        refreshed = await refresh_agent_token(agent_user)
                        if not refreshed:
                            # Fallback: copy the global token to the agent if available
                            global_token = load_saved_token()
                            if global_token:
                                global_refresh = get_saved_refresh_token()
                                save_agent_token(agent_user, global_token, refresh_token=global_refresh)
                                logger.info(f"[Agent Auth] Copied global token to {agent_user['username']}")
                                refreshed = True
                        if refreshed and _auth_retry < MAX_AUTH_RETRIES:
                            yield {"type": "status", "content": "Agent token refreshed, retrying..."}
                            async for ev in stream_claude_events(prompt, system_prompt, agent_id=agent_id, owner_id=owner_id, task_id=task_id, _auth_retry=_auth_retry + 1):
                                yield ev
                            return
                    if agent_user:
                        login_url = initiate_owner_login(_owner_id) if _owner_id else initiate_agent_login(agent_id)
                    else:
                        login_url = await get_login_url()
                    if login_url:
                        yield {
                            "type": "error",
                            "content": f"Not authenticated. Open this URL: {login_url} -- then send the verification code as your next message.",
                            "login_url": login_url,
                        }
                    else:
                        yield {
                            "type": "error",
                            "content": "Not authenticated. Call POST /auth/login to start, or POST a token to /auth/token.",
                        }
                    return

            if not is_json_event:
                has_content = True
                yield {"type": "text", "content": line}
                continue

            event_type = event.get("type", "")

            if event_type == "assistant":
                # Assistant message content
                message = event.get("message", {})
                content = message.get("content", "")
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "thinking":
                            has_content = True
                            yield {"type": "thinking", "content": block.get("thinking", "")}
                        elif isinstance(block, dict) and block.get("type") == "text":
                            has_content = True
                            yield {"type": "text", "content": block.get("text", "")}
                        elif isinstance(block, dict) and block.get("type") == "tool_use":
                            has_content = True
                            tool_name = block.get("name", "unknown")
                            yield {"type": "status", "content": f"Using tool: {tool_name}"}
                elif isinstance(content, str) and content:
                    has_content = True
                    yield {"type": "text", "content": content}

            elif event_type == "tool_use":
                has_content = True
                tool_name = event.get("name", "unknown")
                yield {"type": "status", "content": f"Using tool: {tool_name}"}

            elif event_type == "tool_result":
                # Tool execution result (skip in stream, agent processes it)
                has_content = True

            elif event_type == "result":
                # Final result — always yield so cost/token metadata is forwarded
                # even when result text is empty (text was already streamed)
                result_text = event.get("result", "")
                cost = event.get("cost_usd", 0)
                duration = event.get("duration_ms", 0)
                # Token data: Claude CLI stores it in a usage sub-object
                usage = event.get("usage", {}) or {}
                input_tokens = usage.get("input_tokens", 0) or 0
                output_tokens = usage.get("output_tokens", 0) or 0
                total_tokens = event.get("total_tokens", 0) or (input_tokens + output_tokens)
                if input_tokens > 0 or output_tokens > 0 or result_text:
                    has_content = True
                yield {"type": "result", "content": result_text or "", "cost_usd": cost, "duration_ms": duration, "total_tokens": total_tokens, "input_tokens": input_tokens, "output_tokens": output_tokens}

            elif event_type == "error":
                error_msg = event.get("error", {})
                if isinstance(error_msg, dict):
                    error_msg = error_msg.get("message", str(error_msg))
                error_str = str(error_msg)
                # Auto-refresh on expired token error
                if "token has expired" in error_str.lower() or "oauth token" in error_str.lower():
                    try:
                        proc.terminate()
                    except ProcessLookupError:
                        pass
                    logger.warning(f"Token expired mid-stream: {error_str}")
                    refreshed = await refresh_oauth_token()
                    if refreshed and _auth_retry < MAX_AUTH_RETRIES:
                        yield {"type": "status", "content": "Token refreshed, retrying..."}
                        # Re-run the full request with the new token
                        async for ev in stream_claude_events(prompt, system_prompt, agent_id=agent_id, owner_id=owner_id, task_id=task_id, _auth_retry=_auth_retry + 1):
                            yield ev
                    else:
                        if _auth_retry >= MAX_AUTH_RETRIES:
                            logger.error(f"Auth retry limit ({MAX_AUTH_RETRIES}) reached, aborting")
                        login_url = await get_login_url()
                        yield {
                            "type": "error",
                            "content": f"OAuth token expired and refresh failed. Please re-authenticate: {login_url}",
                            "login_url": login_url,
                        }
                    return
                yield {"type": "error", "content": error_str}

            else:
                # Other event types - log but don't stream
                if VERBOSE:
                    logger.debug(f"Unhandled event type: {event_type}")

    except asyncio.CancelledError:
        try:
            proc.terminate()
        except ProcessLookupError:
            pass
        raise
    finally:
        try:
            await proc.wait()
        except asyncio.CancelledError:
            pass

    if proc.returncode != 0:
        stderr = await proc.stderr.read()
        stderr_text = stderr.decode("utf-8", errors="replace").strip()
        if stderr_text:
            yield {"type": "error", "content": stderr_text}

    # Detect empty response from a session resume: Claude CLI exited with rc=0
    # but produced no meaningful output (0 tokens, no text). This typically
    # happens when the session file is corrupted or the session state is stale.
    # Reset the session and retry once with a fresh session.
    if not has_content and proc.returncode == 0 and agent_id:
        session_key = f"{agent_id}:{task_id}" if agent_id and task_id else agent_id
        was_resume = session_key and session_key in _agent_sessions
        # Capture stderr for diagnostics even on rc=0
        try:
            stderr_out = (await proc.stderr.read()).decode("utf-8", errors="replace").strip()
        except Exception:
            stderr_out = ""
        if stderr_out:
            logger.warning(f"[Session] Empty response stderr: {stderr_out[:300]}")
        if was_resume and _auth_retry < 1:
            logger.warning(f"[Session] Empty response from resumed session for agent {agent_id[:12]} — resetting session and retrying")
            _agent_sessions.pop(session_key, None)
            async for ev in stream_claude_events(prompt, system_prompt, agent_id=agent_id, owner_id=owner_id, task_id=task_id, _auth_retry=_auth_retry + 1):
                yield ev
        else:
            logger.warning(f"[Session] Empty response from Claude CLI for agent {agent_id[:12] if agent_id else 'none'} (rc=0, was_resume={was_resume})")
