from typing import Optional
from pydantic import BaseModel


class MessageRequest(BaseModel):
    content: str
    system_prompt: Optional[str] = None


class ExecutionResponse(BaseModel):
    status: str
    output: str
    error: Optional[str] = None


class ShellExecRequest(BaseModel):
    command: str
    cwd: Optional[str] = None
    timeout: int = 60