"""
Coder Service — API HTTP routes.

Health, execute, stream, shell exec, project ensure, session reset,
and OpenAI-compatible endpoints.
"""

import os
import json
import time
import uuid
import asyncio
import subprocess
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse

from config import CLAUDE_MODEL, PROJECTS_DIR, logger
from models import (
    MessageRequest, CodeRequest, ExecutionResponse,
    OpenAIChatCompletionRequest, OpenAICompletionRequest,
    ShellExecRequest, EnsureProjectRequest,
    chunk_text, messages_to_prompt,
)
from security import extract_api_key, verify_api_key
from agent_user import get_agent_project_dir, ensure_agent_project
from claude_executor import (
    run_claude_sync, stream_claude_events,
    get_agent_sessions, get_agent_current_task,
    set_agent_permissions,
)
from code_executor import execute_python, execute_shell

router = APIRouter()


# =============================================================================
# Health / docs
# =============================================================================

@router.get("/health")
async def health_check():
    # Check Claude Code CLI is available
    try:
        result = subprocess.run(
            ["claude", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        claude_ok = result.returncode == 0
        claude_version = result.stdout.strip() if claude_ok else None
    except Exception:
        claude_ok = False
        claude_version = None

    return {
        "status": "healthy" if claude_ok else "degraded",
        "service": "coder-service",
        "agent_backend": "claude-code",
        "claude_version": claude_version,
        "claude_model": CLAUDE_MODEL,
    }


@router.get("/docs-openapi")
async def docs_openapi(x_api_key: str = Header(None)):
    # Import the app to get its openapi schema — avoid circular imports
    from server import app
    return app.openapi()


# =============================================================================
# Core execution endpoints
# =============================================================================

@router.post("/execute", response_model=ExecutionResponse)
async def execute_message(
    request: MessageRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
    x_agent_permissions: Optional[str] = Header(None),
):
    """Execute a natural language request via Claude Code CLI."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    if x_agent_id and x_agent_permissions:
        try:
            set_agent_permissions(x_agent_id, json.loads(x_agent_permissions))
        except (json.JSONDecodeError, TypeError):
            pass

    result = await run_claude_sync(request.content, request.system_prompt, agent_id=x_agent_id, owner_id=x_owner_id)
    return ExecutionResponse(**result)


@router.post("/code/execute", response_model=ExecutionResponse)
async def execute_code(
    request: CodeRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Direct code execution endpoint (bypass Claude Code)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    try:
        logger.info(f"Executing {request.language} code ({len(request.code)} chars)...")

        if request.language == "python":
            output = execute_python(request.code)
            return ExecutionResponse(status="success", output=output)
        elif request.language in ("shell", "bash"):
            output = execute_shell(request.code)
            return ExecutionResponse(status="success", output=output)
        else:
            return ExecutionResponse(
                status="error", output="",
                error=f"Unsupported language: {request.language}",
            )
    except Exception as e:
        logger.error(f"Code execution error: {str(e)}", exc_info=True)
        return ExecutionResponse(status="error", output="", error=str(e))


@router.post("/projects/ensure")
async def ensure_project(
    request: EnsureProjectRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
):
    """Clone or update a project repo for a specific agent.

    Each agent gets its own isolated clone so concurrent agents don't conflict.
    Must be called before streaming/executing with the agent.
    """
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    if not x_agent_id:
        raise HTTPException(status_code=400, detail="X-Agent-Id header required")

    try:
        project_dir = await ensure_agent_project(x_agent_id, request.project, request.git_url)
        return {"status": "success", "project_dir": project_dir}
    except Exception as e:
        logger.error(f"[Project] ensure failed for agent {x_agent_id[:12]}: {e}")
        return {"status": "error", "error": str(e)}


@router.post("/exec-shell")
async def exec_shell(
    request: ShellExecRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
):
    """Execute a shell command in the agent's project context.

    Automatically uses the agent's per-agent project clone if available,
    falling back to PROJECTS_DIR.
    """
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    # Resolve cwd: explicit > agent project dir > PROJECTS_DIR
    cwd = request.cwd
    if not cwd and x_agent_id:
        cwd = get_agent_project_dir(x_agent_id)
    if not cwd:
        cwd = PROJECTS_DIR
    if not os.path.isdir(cwd):
        return ExecutionResponse(status="error", output="", error=f"Directory not found: {cwd}")

    timeout = min(request.timeout, 120)  # cap at 2 minutes

    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", "-c", request.command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
        )
        stdout_bytes, stderr_bytes = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        output = stdout
        if stderr:
            output += f"\n[stderr] {stderr}"
        if proc.returncode != 0:
            output += f"\n[exit code: {proc.returncode}]"
            return ExecutionResponse(
                status="error",
                output=output[:10000],
                error=f"Command failed with exit code {proc.returncode}",
            )
        return ExecutionResponse(status="success", output=output[:10000])
    except asyncio.TimeoutError:
        return ExecutionResponse(status="error", output="", error=f"Command timed out after {timeout}s")
    except Exception as e:
        logger.error(f"exec-shell error: {e}")
        return ExecutionResponse(status="error", output="", error=str(e))


# =============================================================================
# Streaming
# =============================================================================

@router.post("/stream")
async def stream_execution(
    request: MessageRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
    x_agent_permissions: Optional[str] = Header(None),
):
    """Stream execution results in real-time via SSE."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    if x_agent_id and x_agent_permissions:
        try:
            set_agent_permissions(x_agent_id, json.loads(x_agent_permissions))
        except (json.JSONDecodeError, TypeError):
            pass

    async def event_generator():
        try:
            yield f"data: {json.dumps({'status': 'starting', 'message': 'Claude Code execution started'})}\n\n"

            has_streamed_text = False
            async for event in stream_claude_events(request.content, request.system_prompt, agent_id=x_agent_id, owner_id=x_owner_id):
                event_type = event.get("type", "")

                if event_type == "thinking":
                    yield f"data: {json.dumps({'status': 'thinking', 'output': event['content']}, ensure_ascii=False)}\n\n"
                elif event_type == "status":
                    yield f"data: {json.dumps({'status': 'working', 'output': event['content']}, ensure_ascii=False)}\n\n"
                elif event_type == "text":
                    yield f"data: {json.dumps({'status': 'streaming', 'output': event['content']}, ensure_ascii=False)}\n\n"
                    has_streamed_text = True
                elif event_type == "result":
                    # Send completion signal with metadata; only include output
                    # if nothing was streamed yet (avoids duplicating content).
                    output = "" if has_streamed_text else event["content"]
                    yield f"data: {json.dumps({'status': 'success', 'output': output, 'cost_usd': event.get('cost_usd'), 'duration_ms': event.get('duration_ms'), 'total_tokens': event.get('total_tokens'), 'input_tokens': event.get('input_tokens'), 'output_tokens': event.get('output_tokens')}, ensure_ascii=False)}\n\n"
                elif event_type == "error":
                    yield f"data: {json.dumps({'status': 'error', 'error': event['content']}, ensure_ascii=False)}\n\n"

            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/reset")
async def reset_agent(
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_task_id: Optional[str] = Header(None),
):
    """Reset agent session — starts a fresh Claude Code session on next invocation."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    sessions = get_agent_sessions()
    current_tasks = get_agent_current_task()

    if x_agent_id:
        removed = 0
        # Remove specific task session if task_id provided
        if x_task_id:
            session_key = f"{x_agent_id}:{x_task_id}"
            if session_key in sessions:
                old_session = sessions.pop(session_key)
                logger.info(f"[Session] Reset session for agent {x_agent_id[:12]} task {x_task_id[:12]} (was {old_session[:12]})")
                removed += 1
        # Also remove agent-only session (legacy) and clear current task tracking
        if x_agent_id in sessions:
            sessions.pop(x_agent_id)
            removed += 1
        current_tasks.pop(x_agent_id, None)
        # Remove ALL sessions for this agent (across all tasks) for a full reset
        if not x_task_id:
            keys_to_remove = [k for k in sessions if k.startswith(f"{x_agent_id}:")]
            for k in keys_to_remove:
                sessions.pop(k)
                removed += 1
        if removed:
            return {"status": "success", "message": f"Reset {removed} session(s) for agent {x_agent_id[:12]}"}
    return {"status": "success", "message": "No session to reset"}


# =============================================================================
# OpenAI-compatible endpoints
# =============================================================================

@router.get("/v1/models")
async def openai_models(
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)
    return {
        "object": "list",
        "data": [
            {
                "id": CLAUDE_MODEL,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "anthropic",
            }
        ],
    }


@router.post("/v1/chat/completions")
async def openai_chat_completions(
    request: OpenAIChatCompletionRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
    x_task_id: Optional[str] = Header(None),
    x_agent_permissions: Optional[str] = Header(None),
):
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    if x_agent_id and x_agent_permissions:
        try:
            set_agent_permissions(x_agent_id, json.loads(x_agent_permissions))
        except (json.JSONDecodeError, TypeError):
            pass

    if not request.messages:
        raise HTTPException(status_code=400, detail="At least one message is required")

    prompt, system_prompt = messages_to_prompt(request.messages)
    # Request-level system_prompt overrides messages-derived one
    if request.system_prompt:
        system_prompt = request.system_prompt

    model = request.model or CLAUDE_MODEL

    async def stream_openai_response():
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"
        created = int(time.time())

        # Send initial role delta
        yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]})}\n\n"

        has_streamed_text = False
        total_tokens = 0
        input_tokens = 0
        output_tokens_val = 0
        cost_usd = 0
        try:
            async for event in stream_claude_events(prompt, system_prompt, agent_id=x_agent_id, owner_id=x_owner_id, task_id=x_task_id):
                event_type = event.get("type", "")

                if event_type == "thinking":
                    content = event["content"]
                    yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'reasoning_content': content}, 'finish_reason': None}]})}\n\n"
                elif event_type == "text":
                    content = event["content"]
                    yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})}\n\n"
                    has_streamed_text = True
                elif event_type == "status":
                    # Forward tool-use status as reasoning_content so the UI
                    # shows live progress in the thinking panel
                    status_text = event.get("content", "")
                    if status_text:
                        yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'reasoning_content': status_text + chr(10)}, 'finish_reason': None}]})}\n\n"
                elif event_type == "result":
                    # Capture usage metadata from the final result event
                    cost_usd = event.get("cost_usd", 0) or 0
                    total_tokens = event.get("total_tokens", 0) or 0
                    input_tokens = event.get("input_tokens", 0) or 0
                    output_tokens_val = event.get("output_tokens", 0) or 0
                    # Only send the final result text if we haven't already
                    # streamed text events (which contain the same content).
                    if not has_streamed_text:
                        content = event.get("content", "")
                        if content:
                            for piece in chunk_text(content):
                                yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': piece}, 'finish_reason': None}]})}\n\n"
                            has_streamed_text = True
                elif event_type == "error":
                    content = event.get("content", "")
                    yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})}\n\n"
        except BrokenPipeError as e:
            logger.error(f"Claude CLI subprocess failed: {e}")
            error_msg = f"Agent subprocess failed to start: {e}"
            yield f"data: {json.dumps({'id': completion_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': error_msg}, 'finish_reason': None}]})}\n\n"

        # Send finish chunk with usage data (including cost_usd extension)
        finish_chunk = {
            "id": completion_id, "object": "chat.completion.chunk",
            "created": created, "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": input_tokens or total_tokens,
                "completion_tokens": output_tokens_val,
                "total_tokens": total_tokens or (input_tokens + output_tokens_val),
                "cost_usd": cost_usd,
            },
        }
        yield f"data: {json.dumps(finish_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    if request.stream:
        return StreamingResponse(stream_openai_response(), media_type="text/event-stream")

    # Non-streaming: run synchronously
    result = await run_claude_sync(prompt, system_prompt, agent_id=x_agent_id, owner_id=x_owner_id, task_id=x_task_id)
    content = result.get("output", "") if result.get("status") == "success" else (result.get("error") or "Execution failed")

    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": result.get("input_tokens", 0) or result.get("total_tokens", 0),
            "completion_tokens": result.get("output_tokens", 0),
            "total_tokens": result.get("total_tokens", 0) or (result.get("input_tokens", 0) + result.get("output_tokens", 0)),
            "cost_usd": result.get("cost_usd", 0),
        },
    }


@router.post("/v1/completions")
async def openai_completions(
    request: OpenAICompletionRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    x_agent_id: Optional[str] = Header(None),
    x_owner_id: Optional[str] = Header(None),
    x_task_id: Optional[str] = Header(None),
    x_agent_permissions: Optional[str] = Header(None),
):
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    if x_agent_id and x_agent_permissions:
        try:
            set_agent_permissions(x_agent_id, json.loads(x_agent_permissions))
        except (json.JSONDecodeError, TypeError):
            pass

    model = request.model or CLAUDE_MODEL

    async def stream_openai_completion_response():
        completion_id = f"cmpl-{uuid.uuid4().hex}"
        created = int(time.time())

        has_streamed_text = False
        total_tokens = 0
        input_tokens = 0
        output_tokens_val = 0
        cost_usd = 0
        async for event in stream_claude_events(request.prompt, request.system_prompt, agent_id=x_agent_id, owner_id=x_owner_id, task_id=x_task_id):
            event_type = event.get("type", "")

            if event_type == "text":
                content = event["content"]
                for piece in chunk_text(content):
                    yield f"data: {json.dumps({'id': completion_id, 'object': 'text_completion', 'created': created, 'model': model, 'choices': [{'index': 0, 'text': piece, 'finish_reason': None}]})}\n\n"
                has_streamed_text = True
            elif event_type == "result":
                cost_usd = event.get("cost_usd", 0) or 0
                total_tokens = event.get("total_tokens", 0) or 0
                input_tokens = event.get("input_tokens", 0) or 0
                output_tokens_val = event.get("output_tokens", 0) or 0
                if not has_streamed_text:
                    content = event["content"]
                    for piece in chunk_text(content):
                        yield f"data: {json.dumps({'id': completion_id, 'object': 'text_completion', 'created': created, 'model': model, 'choices': [{'index': 0, 'text': piece, 'finish_reason': None}]})}\n\n"
            elif event_type == "error":
                yield f"data: {json.dumps({'id': completion_id, 'object': 'text_completion', 'created': created, 'model': model, 'choices': [{'index': 0, 'text': event['content'], 'finish_reason': None}]})}\n\n"

        # Send finish chunk with usage data (including cost_usd extension)
        finish_chunk = {
            "id": completion_id, "object": "text_completion",
            "created": created, "model": model,
            "choices": [{"index": 0, "text": "", "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": input_tokens or total_tokens,
                "completion_tokens": output_tokens_val,
                "total_tokens": total_tokens or (input_tokens + output_tokens_val),
                "cost_usd": cost_usd,
            },
        }
        yield f"data: {json.dumps(finish_chunk)}\n\n"
        yield "data: [DONE]\n\n"

    if request.stream:
        return StreamingResponse(stream_openai_completion_response(), media_type="text/event-stream")

    result = await run_claude_sync(request.prompt, request.system_prompt, agent_id=x_agent_id, owner_id=x_owner_id, task_id=x_task_id)
    content = result.get("output", "") if result.get("status") == "success" else (result.get("error") or "Execution failed")

    return {
        "id": f"cmpl-{uuid.uuid4().hex}",
        "object": "text_completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{"index": 0, "text": content, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": result.get("input_tokens", 0) or result.get("total_tokens", 0),
            "completion_tokens": result.get("output_tokens", 0),
            "total_tokens": result.get("total_tokens", 0) or (result.get("input_tokens", 0) + result.get("output_tokens", 0)),
            "cost_usd": result.get("cost_usd", 0),
        },
    }
