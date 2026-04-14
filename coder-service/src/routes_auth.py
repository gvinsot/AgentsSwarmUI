"""
Coder Service — Authentication HTTP routes.

Global, per-agent, and per-owner OAuth endpoints.
"""

import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Header

from config import OAUTH_CLIENT_ID, OAUTH_REDIRECT_URI, OAUTH_SCOPES, logger
from models import TokenRequest, AgentAuthCallback, OwnerAuthCallback
from security import extract_api_key, verify_api_key
from agent_user import ensure_agent_user
from token_store import (
    save_token, load_agent_token, save_agent_token,
    is_agent_token_expired,
    load_owner_token, save_owner_token, is_owner_token_expired,
    token_http_request,
    auth_method, claude_auth_status,
)
from auth_oauth import (
    get_login_url, get_auth_url, set_auth_url,
    get_agent_oauth_flow, pop_agent_oauth_flow, initiate_agent_login,
    get_owner_oauth_flow, pop_owner_oauth_flow, initiate_owner_login,
)

router = APIRouter()


# =============================================================================
# Global auth routes
# =============================================================================

@router.get("/auth/status")
async def auth_status(
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Check current authentication status (uses `claude auth status`)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)
    # Prefer CLI auth status for accurate info
    cli_status = claude_auth_status()
    if cli_status.get("loggedIn"):
        return {
            "authenticated": True,
            "method": cli_status.get("authMethod", "unknown"),
            "email": cli_status.get("email"),
            "subscription": cli_status.get("subscriptionType"),
        }
    # Fallback to env-based check
    method = auth_method()
    return {"authenticated": method != "none", "method": method}


@router.post("/auth/token")
async def set_auth_token(
    request: TokenRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Set OAuth token for subscription-based authentication.

    Generate a token on a machine with a browser: claude setup-token
    Then POST it here.
    """
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    token = request.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty")

    save_token(token)
    return {
        "status": "success",
        "message": "OAuth token saved. Subscription plan will be used for subsequent requests.",
    }


@router.post("/auth/login")
async def auth_login(
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Initiate OAuth PKCE login flow and return the authorization URL."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    # Already authenticated?
    cli_status = claude_auth_status()
    if cli_status.get("loggedIn"):
        return {"status": "authenticated", "method": cli_status.get("authMethod")}
    method = auth_method()
    if method != "none":
        return {"status": "authenticated", "method": method}

    # Cached URL from a previous attempt?
    cached_url = get_auth_url()
    if cached_url:
        return {
            "status": "pending",
            "login_url": cached_url,
            "message": "Open this URL in your browser to authenticate with your Claude subscription.",
        }

    url = await get_login_url()
    set_auth_url(url)
    return {
        "status": "pending",
        "login_url": url,
        "message": "Open this URL, then send the verification code as your next message.",
    }


# =============================================================================
# Per-agent auth routes
# =============================================================================

@router.get("/auth/agent/{agent_id}/status")
async def agent_auth_status(
    agent_id: str,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Check whether a specific agent has its own OAuth token."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    agent_user = await ensure_agent_user(agent_id)
    if not agent_user:
        return {"authenticated": False, "error": "Failed to resolve agent user"}

    token = load_agent_token(agent_user)
    if token:
        expired = is_agent_token_expired(agent_user)
        return {"authenticated": True, "expired": expired, "agent_id": agent_id}
    return {"authenticated": False, "agent_id": agent_id}


@router.post("/auth/agent/{agent_id}/login")
async def agent_auth_login(
    agent_id: str,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Initiate OAuth PKCE login flow for a specific agent."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    agent_user = await ensure_agent_user(agent_id)
    if not agent_user:
        raise HTTPException(status_code=500, detail="Failed to create agent user")

    # Already authenticated?
    token = load_agent_token(agent_user)
    if token and not is_agent_token_expired(agent_user):
        return {"status": "authenticated", "agent_id": agent_id}

    # Check if there's already a pending flow
    flow = get_agent_oauth_flow(agent_id)
    if flow:
        return {
            "status": "pending",
            "agent_id": agent_id,
            "login_url": flow["auth_url"],
            "message": "Open this URL in your browser to authenticate this agent with its own Claude subscription.",
        }

    login_url = initiate_agent_login(agent_id)
    return {
        "status": "pending",
        "agent_id": agent_id,
        "login_url": login_url,
        "message": "Open this URL in your browser, then POST the verification code to /auth/agent/{agent_id}/callback.",
    }


@router.post("/auth/agent/{agent_id}/callback")
async def agent_auth_callback(
    agent_id: str,
    request: AgentAuthCallback,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Exchange OAuth code for token and save it for a specific agent."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    flow = get_agent_oauth_flow(agent_id)
    if not flow:
        raise HTTPException(status_code=400, detail="No pending OAuth flow for this agent. Call POST /auth/agent/{agent_id}/login first.")

    agent_user = await ensure_agent_user(agent_id)
    if not agent_user:
        raise HTTPException(status_code=500, detail="Failed to resolve agent user")

    code = request.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    payload = {
        "grant_type": "authorization_code",
        "client_id": OAUTH_CLIENT_ID,
        "code": code,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "code_verifier": flow["code_verifier"],
    }
    result = await token_http_request(payload, f"agent {agent_id[:12]} code exchange")
    if not result:
        raise HTTPException(status_code=502, detail="Token exchange failed")

    access_token = result.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail=f"Token response missing access_token: {json.dumps(result)}")

    refresh_token = result.get("refresh_token")
    expires_in = result.get("expires_in", 28800)

    save_agent_token(agent_user, access_token, refresh_token=refresh_token, expires_in=expires_in)
    # Clean up the pending flow
    pop_agent_oauth_flow(agent_id)

    return {
        "status": "authenticated",
        "agent_id": agent_id,
        "message": "Agent now has its own OAuth token.",
    }


@router.post("/auth/agent/{agent_id}/token")
async def agent_set_token(
    agent_id: str,
    request: TokenRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Directly set an OAuth token for a specific agent (e.g. from `claude setup-token`)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    agent_user = await ensure_agent_user(agent_id)
    if not agent_user:
        raise HTTPException(status_code=500, detail="Failed to resolve agent user")

    token = request.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty")

    save_agent_token(agent_user, token)
    return {
        "status": "success",
        "agent_id": agent_id,
        "message": "OAuth token saved for this agent.",
    }


# =============================================================================
# Per-owner auth routes
# =============================================================================

@router.get("/auth/owner/{owner_id}/status")
async def owner_auth_status(
    owner_id: str,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Check whether a PulsarTeam user (owner) has a valid OAuth token."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    token = load_owner_token(owner_id)
    if token:
        expired = is_owner_token_expired(owner_id)
        return {"authenticated": True, "expired": expired, "owner_id": owner_id}
    return {"authenticated": False, "owner_id": owner_id}


@router.post("/auth/owner/{owner_id}/login")
async def owner_auth_login(
    owner_id: str,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Initiate OAuth PKCE login flow for a PulsarTeam user (owner)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    # Already authenticated?
    token = load_owner_token(owner_id)
    if token and not is_owner_token_expired(owner_id):
        return {"status": "authenticated", "owner_id": owner_id}

    # Check if there's already a pending flow
    flow = get_owner_oauth_flow(owner_id)
    if flow:
        return {
            "status": "pending",
            "owner_id": owner_id,
            "login_url": flow["auth_url"],
            "message": "Open this URL in your browser to authenticate your Claude subscription.",
        }

    login_url = initiate_owner_login(owner_id)
    return {
        "status": "pending",
        "owner_id": owner_id,
        "login_url": login_url,
        "message": "Open this URL in your browser, then POST the verification code to /auth/owner/{owner_id}/callback.",
    }


@router.post("/auth/owner/{owner_id}/callback")
async def owner_auth_callback(
    owner_id: str,
    request: OwnerAuthCallback,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Exchange OAuth code for token and save it for a PulsarTeam user (owner)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    flow = get_owner_oauth_flow(owner_id)
    if not flow:
        raise HTTPException(status_code=400, detail="No pending OAuth flow for this owner. Call POST /auth/owner/{owner_id}/login first.")

    code = request.code.strip()
    if not code:
        raise HTTPException(status_code=400, detail="Code cannot be empty")

    payload = {
        "grant_type": "authorization_code",
        "client_id": OAUTH_CLIENT_ID,
        "code": code,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "code_verifier": flow["code_verifier"],
    }
    result = await token_http_request(payload, f"owner {owner_id} code exchange")
    if not result:
        raise HTTPException(status_code=502, detail="Token exchange failed")

    access_token = result.get("access_token")
    if not access_token:
        raise HTTPException(status_code=502, detail=f"Token response missing access_token: {json.dumps(result)}")

    refresh_token = result.get("refresh_token")
    expires_in = result.get("expires_in", 28800)

    save_owner_token(owner_id, access_token, refresh_token=refresh_token, expires_in=expires_in)
    pop_owner_oauth_flow(owner_id)

    return {
        "status": "authenticated",
        "owner_id": owner_id,
        "message": "Owner now has an OAuth token shared by all their agents.",
    }


@router.post("/auth/owner/{owner_id}/token")
async def owner_set_token(
    owner_id: str,
    request: TokenRequest,
    x_api_key: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    """Directly set an OAuth token for a PulsarTeam user (owner)."""
    api_key = extract_api_key(x_api_key, authorization)
    verify_api_key(api_key)

    token = request.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty")

    save_owner_token(owner_id, token)
    return {
        "status": "success",
        "owner_id": owner_id,
        "message": "OAuth token saved for this owner (shared by all their agents).",
    }
