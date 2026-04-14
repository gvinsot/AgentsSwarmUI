#!/usr/bin/env python3
"""
Coder Service - Claude Code Mapper
FastAPI proxy that invokes Claude Code CLI in headless mode.
Provides an autonomous AI agent with full access to dev tools via mounted volumes.

This is the application entry point. Business logic lives in:
  config.py          — configuration constants, logging setup
  models.py          — Pydantic request/response models
  security.py        — API key extraction and verification
  agent_user.py      — per-agent Linux user isolation and project management
  token_store.py     — OAuth token persistence (global, agent, owner)
  auth_oauth.py      — OAuth PKCE flow management
  claude_executor.py — Claude Code CLI execution (sync + streaming)
  code_executor.py   — direct Python/shell execution
  routes_auth.py     — authentication HTTP endpoints
  routes_api.py      — API HTTP endpoints (health, execute, stream, OpenAI compat)
"""

import os
import subprocess
from contextlib import asynccontextmanager

from fastapi import FastAPI
import uvicorn

from config import (
    CLAUDE_MODEL, CLAUDE_MAX_TURNS, TIMEOUT, PROJECTS_DIR,
    logger,
)
from token_store import load_saved_token, auth_method, claude_auth_status
from routes_auth import router as auth_router
from routes_api import router as api_router


# --- App creation -------------------------------------------------------------

app = FastAPI(
    title="Coder Service",
    description="AI agent powered by Claude Code CLI (headless mode)",
    version="4.0.0",
)

app.include_router(auth_router)
app.include_router(api_router)


# --- Lifespan -----------------------------------------------------------------

@asynccontextmanager
async def lifespan(application: FastAPI):
    """Startup/shutdown lifecycle for FastAPI."""
    logger.info("Coder Service starting (Claude Code backend)...")
    logger.info(f"  Model: {CLAUDE_MODEL}")
    logger.info(f"  Max turns: {CLAUDE_MAX_TURNS}")
    logger.info(f"  Timeout: {TIMEOUT}s")
    logger.info(f"  Projects dir: {PROJECTS_DIR}")

    # Check Claude Code CLI
    try:
        result = subprocess.run(["claude", "--version"], capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            logger.info(f"  Claude Code CLI: {result.stdout.strip()}")
        else:
            logger.error(f"  Claude Code CLI error: {result.stderr.strip()}")
    except FileNotFoundError:
        logger.error("  Claude Code CLI not found! Install with: npm install -g @anthropic-ai/claude-code")
    except Exception as e:
        logger.error(f"  Claude Code CLI check failed: {e}")

    # Load saved token from persistent storage
    saved = load_saved_token()
    if saved and not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN"):
        os.environ["CLAUDE_CODE_OAUTH_TOKEN"] = saved
        logger.info("  Loaded saved OAuth token from persistent storage")

    # Log authentication status (prefer CLI check for accuracy)
    cli_status = claude_auth_status()
    if cli_status.get("loggedIn"):
        logger.info(f"  Auth: {cli_status.get('authMethod', 'unknown')} "
                     f"({cli_status.get('subscriptionType', 'unknown')} plan, "
                     f"{cli_status.get('email', 'no email')})")
    else:
        method = auth_method()
        if method == "oauth":
            logger.info("  Auth: OAuth token (subscription plan)")
        elif method == "api_key":
            logger.info("  Auth: API key (API credits)")
        else:
            logger.warning("  No auth configured! Use POST /auth/login or /auth/token, or set CLAUDE_CODE_OAUTH_TOKEN env var.")

    yield

    logger.info("Coder Service shutting down...")

app.router.lifespan_context = lifespan

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )
