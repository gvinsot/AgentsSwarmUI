"""
Coder Service — OAuth PKCE flow management.

Handles URL generation, code exchange, login initiation for global,
per-agent, and per-owner OAuth flows.
"""

import re
import hashlib
import base64
import secrets
from typing import Optional

from config import (
    OAUTH_CLIENT_ID, OAUTH_AUTHORIZE_URL, OAUTH_REDIRECT_URI, OAUTH_SCOPES,
    logger,
)
from token_store import (
    token_http_request,
    save_token, save_owner_token, save_agent_token,
)
from agent_user import ensure_agent_user


# --- Global OAuth flow state --------------------------------------------------

_auth_url: Optional[str] = None
_oauth_code_verifier: Optional[str] = None
_oauth_state: Optional[str] = None

# Per-agent / per-owner pending OAuth flow state
_agent_oauth_flows: dict[str, dict] = {}
_owner_oauth_flows: dict[str, dict] = {}


# --- Helpers ------------------------------------------------------------------

# Verification code pattern: auth_code#state (long alphanumeric with #, _, -)
_CODE_RE = re.compile(r'^[A-Za-z0-9_#-]{20,}$')


def _extract_code_from_prompt(prompt: str) -> Optional[str]:
    """Extract a verification code from a prompt (may be wrapped in conversation format).

    Handles:
    - Raw code: "oAb7X8p0ADm...#state..."
    - Single message: "User: oAb7X8p0ADm..."
    - Full conversation: "User: hello\\nAssistant: ...\\nUser: oAb7X8p0ADm..."
    Returns None if the last user message doesn't look like a code.
    """
    last_user_msg = prompt.strip()
    for line in reversed(prompt.strip().split('\n')):
        line = line.strip()
        if line.startswith("User: "):
            last_user_msg = line[6:].strip()
            break

    if _CODE_RE.match(last_user_msg):
        return last_user_msg
    return None


def requests_encode(value: str) -> str:
    """URL-encode a value (percent-encoding)."""
    import urllib.parse
    return urllib.parse.quote(value, safe="")


def _generate_pkce() -> tuple[str, str]:
    """Generate PKCE code_verifier and code_challenge (S256)."""
    code_verifier = secrets.token_urlsafe(64)[:128]
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return code_verifier, code_challenge


# --- Global OAuth flow --------------------------------------------------------

def _build_auth_url() -> str:
    """Build OAuth authorization URL with PKCE and store state for later exchange."""
    global _oauth_code_verifier, _oauth_state

    _oauth_code_verifier, code_challenge = _generate_pkce()
    _oauth_state = secrets.token_urlsafe(32)

    params = {
        "code": "true",
        "client_id": OAUTH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": OAUTH_REDIRECT_URI,
        "scope": OAUTH_SCOPES,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": _oauth_state,
    }
    query = "&".join(f"{k}={requests_encode(v)}" for k, v in params.items())
    return f"{OAUTH_AUTHORIZE_URL}?{query}"


async def get_login_url() -> str:
    """Generate an OAuth authorization URL with PKCE."""
    url = _build_auth_url()
    logger.info(f"Generated OAuth URL: {url[:80]}...")
    return url


async def exchange_auth_code(full_code: str) -> dict:
    """Exchange the authorization code for OAuth tokens.

    The code from the browser callback is formatted as: {auth_code}#{state}
    """
    global _oauth_code_verifier, _oauth_state, _auth_url

    if not _oauth_code_verifier:
        return {"status": "error", "message": "No login flow in progress. Start one first."}

    # Split code on # - format is auth_code#state
    if "#" in full_code:
        auth_code, state = full_code.split("#", 1)
    else:
        auth_code = full_code
        state = _oauth_state or ""

    payload = {
        "grant_type": "authorization_code",
        "code": auth_code,
        "state": state,
        "client_id": OAUTH_CLIENT_ID,
        "redirect_uri": OAUTH_REDIRECT_URI,
        "code_verifier": _oauth_code_verifier,
    }

    try:
        result = await token_http_request(payload, f"Exchanging auth code ({len(auth_code)} chars)")

        if result is None:
            _oauth_code_verifier = None
            _oauth_state = None
            _auth_url = None
            return {"status": "error", "message": "Token exchange failed: rate-limited. Please wait 2 minutes and try again."}

        if result.get("_already_valid"):
            _oauth_code_verifier = None
            _oauth_state = None
            _auth_url = None
            return {"status": "authenticated", "method": "oauth", "email": "", "subscription": ""}

        access_token = result.get("access_token")
        refresh_token = result.get("refresh_token")
        expires_in = result.get("expires_in", 28800)

        if not access_token:
            logger.error(f"Token exchange returned no access_token: {result}")
            return {"status": "error", "message": "Token exchange failed: no access_token in response"}

        save_token(access_token, refresh_token=refresh_token, expires_in=expires_in)

        email = result.get("account", {}).get("email", "")
        logger.info(f"OAuth token exchange successful: {email}")

        # Clear OAuth flow state
        _oauth_code_verifier = None
        _oauth_state = None
        _auth_url = None

        return {
            "status": "authenticated",
            "method": "oauth",
            "email": email,
            "subscription": result.get("account", {}).get("subscription_type", ""),
        }

    except Exception as e:
        logger.error(f"Token exchange error: {e}", exc_info=True)
        _oauth_code_verifier = None
        _oauth_state = None
        _auth_url = None
        return {"status": "error", "message": f"Token exchange failed: {e}"}


def get_auth_url() -> Optional[str]:
    """Return the cached global auth URL (if any)."""
    return _auth_url


def set_auth_url(url: Optional[str]):
    global _auth_url
    _auth_url = url


# --- Per-agent OAuth flow -----------------------------------------------------

def initiate_agent_login(agent_id: str) -> str:
    """Generate an OAuth URL for an agent login flow (reuses pending flow if exists)."""
    if agent_id in _agent_oauth_flows:
        return _agent_oauth_flows[agent_id]["auth_url"]
    code_verifier = secrets.token_urlsafe(64)[:128]
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    state = secrets.token_urlsafe(32)
    auth_url = (
        f"{OAUTH_AUTHORIZE_URL}?"
        f"client_id={OAUTH_CLIENT_ID}&"
        f"response_type=code&"
        f"redirect_uri={OAUTH_REDIRECT_URI}&"
        f"scope={OAUTH_SCOPES.replace(' ', '+')}&"
        f"code_challenge={code_challenge}&"
        f"code_challenge_method=S256&"
        f"state={state}"
    )
    _agent_oauth_flows[agent_id] = {
        "code_verifier": code_verifier,
        "state": state,
        "auth_url": auth_url,
    }
    logger.info(f"[Agent Auth] Initiated login flow for agent {agent_id}: {auth_url[:80]}...")
    return auth_url


def get_agent_oauth_flow(agent_id: str) -> Optional[dict]:
    """Return the pending OAuth flow for an agent, or None."""
    return _agent_oauth_flows.get(agent_id)


def pop_agent_oauth_flow(agent_id: str) -> Optional[dict]:
    """Remove and return the pending OAuth flow for an agent."""
    return _agent_oauth_flows.pop(agent_id, None)


# --- Per-owner OAuth flow -----------------------------------------------------

def initiate_owner_login(owner_id: str) -> str:
    """Generate an OAuth URL for an owner login flow (reuses pending flow if exists)."""
    if owner_id in _owner_oauth_flows:
        return _owner_oauth_flows[owner_id]["auth_url"]
    code_verifier = secrets.token_urlsafe(64)[:128]
    code_challenge = base64.urlsafe_b64encode(
        hashlib.sha256(code_verifier.encode()).digest()
    ).rstrip(b"=").decode()
    state = secrets.token_urlsafe(32)
    auth_url = (
        f"{OAUTH_AUTHORIZE_URL}?"
        f"client_id={OAUTH_CLIENT_ID}&"
        f"response_type=code&"
        f"redirect_uri={OAUTH_REDIRECT_URI}&"
        f"scope={OAUTH_SCOPES.replace(' ', '+')}&"
        f"code_challenge={code_challenge}&"
        f"code_challenge_method=S256&"
        f"state={state}"
    )
    _owner_oauth_flows[owner_id] = {
        "code_verifier": code_verifier,
        "state": state,
        "auth_url": auth_url,
    }
    logger.info(f"[Owner Auth] Initiated login flow for owner {owner_id}: {auth_url[:80]}...")
    return auth_url


def get_owner_oauth_flow(owner_id: str) -> Optional[dict]:
    """Return the pending OAuth flow for an owner, or None."""
    return _owner_oauth_flows.get(owner_id)


def pop_owner_oauth_flow(owner_id: str) -> Optional[dict]:
    """Remove and return the pending OAuth flow for an owner."""
    return _owner_oauth_flows.pop(owner_id, None)


# --- In-chat code exchange (tries all pending flows) --------------------------

async def try_exchange_code_from_prompt(prompt: str, agent_id: Optional[str] = None, owner_id: Optional[str] = None) -> Optional[dict]:
    """Detect a verification code in the prompt and exchange it for a token.

    Checks ALL pending OAuth flows (per-owner, per-agent, then global) and
    exchanges the code using the matching flow's code_verifier.

    Returns a dict with {"status": "authenticated", ...} on success,
    {"status": "error", ...} on failure, or None if no code was detected
    or no matching flow is pending.
    """
    code = _extract_code_from_prompt(prompt)
    if not code:
        return None

    # Split code on # to get state (used to match the flow)
    if "#" in code:
        auth_code, state = code.split("#", 1)
    else:
        auth_code = code
        state = ""

    # 1. Try per-owner flow
    if owner_id and owner_id in _owner_oauth_flows:
        flow = _owner_oauth_flows[owner_id]
        payload = {
            "grant_type": "authorization_code",
            "client_id": OAUTH_CLIENT_ID,
            "code": auth_code,
            "state": state,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "code_verifier": flow["code_verifier"],
        }
        logger.info(f"[Owner Auth] Exchanging code for owner {owner_id}")
        try:
            result = await token_http_request(payload, f"owner {owner_id} in-chat code exchange")
            if not result:
                _owner_oauth_flows.pop(owner_id, None)
                return {"status": "error", "message": "Token exchange failed (rate-limited or network error). Try again in 2 minutes."}
            if result.get("_already_valid"):
                _owner_oauth_flows.pop(owner_id, None)
                return {"status": "authenticated", "email": ""}
            if result.get("_invalid_grant"):
                _owner_oauth_flows.pop(owner_id, None)
                return {"status": "error", "message": "The verification code was rejected. Please start a new login flow."}
            access_token = result.get("access_token")
            if not access_token:
                logger.error(f"[Owner Auth] Token response missing access_token: {result}")
                _owner_oauth_flows.pop(owner_id, None)
                return {"status": "error", "message": "Token exchange returned no access token."}
            refresh_token = result.get("refresh_token")
            expires_in = result.get("expires_in", 28800)
            save_owner_token(owner_id, access_token, refresh_token=refresh_token, expires_in=expires_in)
            _owner_oauth_flows.pop(owner_id, None)
            email = result.get("account", {}).get("email", "")
            logger.info(f"[Owner Auth] In-chat OAuth exchange successful for owner {owner_id}: {email}")
            return {"status": "authenticated", "email": email}
        except Exception as e:
            logger.error(f"[Owner Auth] In-chat code exchange error: {e}", exc_info=True)
            _owner_oauth_flows.pop(owner_id, None)
            return {"status": "error", "message": f"Token exchange failed: {e}"}

    # 2. Try per-agent flow
    if agent_id and agent_id in _agent_oauth_flows:
        flow = _agent_oauth_flows[agent_id]
        payload = {
            "grant_type": "authorization_code",
            "client_id": OAUTH_CLIENT_ID,
            "code": auth_code,
            "state": state,
            "redirect_uri": OAUTH_REDIRECT_URI,
            "code_verifier": flow["code_verifier"],
        }
        logger.info(f"[Agent Auth] Exchanging code for agent {agent_id[:12]}")
        try:
            result = await token_http_request(payload, f"agent {agent_id[:12]} in-chat code exchange")
            if not result:
                _agent_oauth_flows.pop(agent_id, None)
                return {"status": "error", "message": "Token exchange failed (rate-limited or network error). Try again in 2 minutes."}
            if result.get("_already_valid"):
                _agent_oauth_flows.pop(agent_id, None)
                return {"status": "authenticated", "email": ""}
            if result.get("_invalid_grant"):
                _agent_oauth_flows.pop(agent_id, None)
                return {"status": "error", "message": "The verification code was rejected. Please start a new login flow."}
            access_token = result.get("access_token")
            if not access_token:
                logger.error(f"[Agent Auth] Token response missing access_token: {result}")
                _agent_oauth_flows.pop(agent_id, None)
                return {"status": "error", "message": "Token exchange returned no access token."}
            refresh_token = result.get("refresh_token")
            expires_in = result.get("expires_in", 28800)
            agent_user = await ensure_agent_user(agent_id, owner_id=owner_id)
            if agent_user:
                save_agent_token(agent_user, access_token, refresh_token=refresh_token, expires_in=expires_in)
            _agent_oauth_flows.pop(agent_id, None)
            email = result.get("account", {}).get("email", "")
            logger.info(f"[Agent Auth] In-chat OAuth exchange successful for agent {agent_id[:12]}: {email}")
            return {"status": "authenticated", "email": email}
        except Exception as e:
            logger.error(f"[Agent Auth] In-chat code exchange error: {e}", exc_info=True)
            _agent_oauth_flows.pop(agent_id, None)
            return {"status": "error", "message": f"Token exchange failed: {e}"}

    # 3. Try global flow (legacy)
    global _oauth_code_verifier
    if _oauth_code_verifier:
        return await exchange_auth_code(code)

    # No matching flow found — the code-like string is not for us
    return None
