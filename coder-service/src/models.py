"""
Coder Service — Pydantic request/response models and helper functions.
"""

from typing import Optional
from pydantic import BaseModel


# --- Request Models -----------------------------------------------------------

class MessageRequest(BaseModel):
    content: str
    system_prompt: Optional[str] = None


class CodeRequest(BaseModel):
    code: str
    language: str = "python"


class OpenAIChatMessage(BaseModel):
    role: str
    content: str


class OpenAIChatCompletionRequest(BaseModel):
    model: Optional[str] = None
    messages: list[OpenAIChatMessage]
    stream: bool = False
    system_prompt: Optional[str] = None


class OpenAICompletionRequest(BaseModel):
    model: Optional[str] = None
    prompt: str
    stream: bool = False
    system_prompt: Optional[str] = None


class TokenRequest(BaseModel):
    token: str


class ShellExecRequest(BaseModel):
    command: str
    cwd: Optional[str] = None
    timeout: int = 60


class EnsureProjectRequest(BaseModel):
    project: str
    git_url: str


class AgentAuthCallback(BaseModel):
    code: str


class OwnerAuthCallback(BaseModel):
    code: str


# --- Response Models ----------------------------------------------------------

class ExecutionResponse(BaseModel):
    status: str
    output: str
    cost_usd: Optional[float] = None
    duration_ms: Optional[int] = None
    total_tokens: Optional[int] = None
    error: Optional[str] = None
    login_url: Optional[str] = None


# --- Helpers ------------------------------------------------------------------

def chunk_text(text: str, size: int = 700):
    """Yield successive chunks of *text* of at most *size* characters."""
    if not text:
        return
    for i in range(0, len(text), size):
        yield text[i:i + size]


def messages_to_prompt(messages: list[OpenAIChatMessage]) -> tuple[str, Optional[str]]:
    """Convert OpenAI chat messages to a single prompt + optional system prompt.

    Returns (prompt, system_prompt).

    Claude Code CLI is stateless -- each invocation starts a fresh session.
    When the conversation contains tool-result continuations, we condense the
    history to avoid the model re-reading the original user request and
    restarting its reasoning from scratch.
    """
    system_parts = []
    conversation_parts = []

    for msg in messages:
        if msg.role == "system":
            system_parts.append(msg.content)
        elif msg.role == "user":
            conversation_parts.append(("user", msg.content))
        elif msg.role == "assistant":
            conversation_parts.append(("assistant", msg.content))

    system_prompt = "\n\n".join(system_parts) if system_parts else None

    if not conversation_parts:
        return "Continue.", system_prompt

    # Simple case: single user message, no conversation history
    if len(conversation_parts) == 1 and conversation_parts[0][0] == "user":
        return conversation_parts[0][1], system_prompt

    # Check if the last message is a tool-result continuation
    last_role, last_content = conversation_parts[-1]
    is_tool_continuation = (last_role == "user" and
                            last_content.lstrip().startswith("[TOOL RESULTS"))

    if is_tool_continuation:
        # With session resume, Claude Code already has the full conversation
        # context. Just send the latest tool results as the new message.
        return last_content, system_prompt

    # Normal multi-turn: flatten as conversation
    parts = []
    for role, content in conversation_parts:
        prefix = "User" if role == "user" else "Assistant"
        parts.append(f"{prefix}: {content}")
    prompt = "\n".join(parts)

    if not prompt or not prompt.strip():
        prompt = "Continue."

    return prompt, system_prompt
