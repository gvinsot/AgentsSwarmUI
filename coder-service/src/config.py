"""
Coder Service — Configuration, logging, and shared constants.
"""

import os
import logging

# --- Logging ------------------------------------------------------------------

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
if LOG_LEVEL not in {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG", "NOTSET"}:
    LOG_LEVEL = "INFO"
VERBOSE = os.getenv("VERBOSE", "false").lower() in ("true", "1", "yes")
logging.basicConfig(level=LOG_LEVEL)
logger = logging.getLogger("coder_service")

if not VERBOSE:
    for noisy in ("httpx", "httpcore", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


class HealthCheckFilter(logging.Filter):
    """Filter out noisy health-check access logs from uvicorn."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if "GET /health" in message and "200" in message:
            return False
        return True


logging.getLogger("uvicorn.access").addFilter(HealthCheckFilter())

# --- Application constants ----------------------------------------------------

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-20250514")
CLAUDE_MAX_TURNS = int(os.getenv("CLAUDE_MAX_TURNS", "50"))
TIMEOUT = int(os.getenv("TIMEOUT", "600"))
API_KEY = os.getenv("API_KEY", "change-me-in-production")
PROJECTS_DIR = os.getenv("PROJECTS_DIR", "/projects")
ALLOWED_TOOLS = os.getenv("CLAUDE_ALLOWED_TOOLS", "")
DATA_DIR = os.getenv("DATA_DIR", "/app/data")
# Working directory for Claude Code CLI. Use /app (not PROJECTS_DIR) to avoid
# loading stale CLAUDE.md files from mounted project volumes.
CLAUDE_CWD = "/app"

# System prompt for Claude Code
SYSTEM_PROMPT = os.getenv("CLAUDE_SYSTEM_PROMPT", (
    "You are an autonomous code execution agent running inside a Docker container. "
    "You have full access to: Python 3.12, Node.js 22, bash, git, Docker CLI, "
    "PostgreSQL client, SQLite, and all standard Unix tools. "
    "Your working directory IS the project git repository. "
    "You can read, write, and execute code freely. Use git to commit and push your changes. "
    "Be concise and provide actionable results."
))

# --- OAuth constants ----------------------------------------------------------

TOKEN_FILE = os.path.join(DATA_DIR, "oauth_token")
TOKEN_JSON_FILE = os.path.join(DATA_DIR, "oauth_token.json")
CREDENTIALS_FILE = os.path.expanduser("~/.claude/.credentials.json")

OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
OAUTH_AUTHORIZE_URL = "https://claude.ai/oauth/authorize"
OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
OAUTH_REDIRECT_URI = "https://platform.claude.com/oauth/code/callback"
OAUTH_SCOPES = "user:profile user:inference user:sessions:claude_code user:mcp_servers"

# --- Users directory (per-owner token storage) --------------------------------

USERS_DIR = os.path.join(DATA_DIR, "users")
