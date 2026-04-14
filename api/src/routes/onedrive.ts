import express from 'express';
import crypto from 'crypto';

/**
 * OneDrive OAuth2 routes.
 *
 * Flow:
 * 1. Client calls GET /api/onedrive/auth-url → receives the Microsoft login URL
 * 2. User logs in on Microsoft, gets redirected to the configured redirect URI
 * 3. Client captures the auth code and POST /api/onedrive/callback with { code, state }
 * 4. Server exchanges the code for access + refresh tokens via Microsoft identity platform
 * 5. Tokens are stored in-memory (per-user OR per-agent) and used by the OneDrive MCP proxy
 *
 * Per-agent mode:
 *   When agentId is provided, tokens are stored under "agent:<agentId>" key.
 *   This allows each agent to have its own OneDrive connection independent of others.
 *
 * Environment variables:
 *   ONEDRIVE_CLIENT_ID     — Azure App Registration client ID
 *   ONEDRIVE_CLIENT_SECRET — Azure App Registration client secret
 *   ONEDRIVE_REDIRECT_URI  — Must match the redirect URI configured in Azure
 *   ONEDRIVE_TENANT_ID     — (optional) defaults to "common" for multi-tenant
 */

// In-memory token store: key → { accessToken, refreshToken, expiresAt }
// Key is either a username (global) or "agent:<agentId>" (per-agent)
const tokenStore = new Map();

// In-memory OAuth state store: state → { username, agentId, expiresAt }
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateOAuthState(username, agentId = null) {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (v.expiresAt < now) stateStore.delete(k);
  }
  const state = crypto.randomBytes(32).toString('hex');
  stateStore.set(state, { username, agentId, expiresAt: now + STATE_TTL_MS });
  return state;
}

function consumeOAuthState(state) {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state); // one-time use
  if (entry.expiresAt < Date.now()) return null;
  return { username: entry.username, agentId: entry.agentId || null };
}

/** Build the token store key for an agent or username. */
function tokenKey(agentId, username) {
  if (agentId) return `agent:${agentId}`;
  return username || 'default';
}

function getConfig() {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  const redirectUri = process.env.ONEDRIVE_REDIRECT_URI;
  const tenantId = process.env.ONEDRIVE_TENANT_ID || 'common';

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri, tenantId };
}

export function getTokenStore() {
  return tokenStore;
}

/**
 * Check if an agent has OneDrive tokens stored.
 */
export function hasOnedriveTokensForAgent(agentId) {
  if (!agentId) return false;
  const key = `agent:${agentId}`;
  const tokens = tokenStore.get(key);
  return !!(tokens && tokens.expiresAt > Date.now() - 3600000); // valid or refreshable
}

export function onedriveRoutes() {
  const router = express.Router();

  // Check if OneDrive is configured (supports ?agentId= for per-agent status)
  router.get('/status', (req, res) => {
    const config = getConfig();
    const agentId = req.query.agentId || null;
    const username = req.user?.username;

    const key = tokenKey(agentId, username);
    const tokens = tokenStore.get(key);
    const connected = tokens && tokens.expiresAt > Date.now();

    res.json({
      configured: !!config,
      connected,
      username: connected ? username : null,
      agentId: agentId || null,
    });
  });

  // Get the Microsoft OAuth authorization URL (supports ?agentId= for per-agent auth)
  router.get('/auth-url', (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({
        error: 'OneDrive not configured. Set ONEDRIVE_CLIENT_ID, ONEDRIVE_CLIENT_SECRET, and ONEDRIVE_REDIRECT_URI.',
      });
    }

    const agentId = req.query.agentId || null;

    const scopes = [
      'Files.Read',
      'Files.Read.All',
      'Files.ReadWrite',
      'Files.ReadWrite.All',
      'Sites.Read.All',
      'User.Read',
      'offline_access',
    ];

    const state = generateOAuthState(req.user?.username || 'default', agentId);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: scopes.join(' '),
      response_mode: 'query',
      state,
    });

    const authUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize?${params}`;
    res.json({ authUrl });
  });

  // Exchange authorization code for tokens
  router.post('/callback', async (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: 'OneDrive not configured' });
    }

    const { code, state } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }
    if (!state) {
      return res.status(400).json({ error: 'State parameter required' });
    }

    const stateData = consumeOAuthState(state);
    if (!stateData) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    try {
      const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[OneDrive] Token exchange failed:', data);
        return res.status(400).json({ error: 'Token exchange failed' });
      }

      const key = tokenKey(stateData.agentId, stateData.username);
      tokenStore.set(key, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // subtract 60s buffer
      });

      const target = stateData.agentId ? `agent "${stateData.agentId.slice(0, 8)}"` : `user "${stateData.username}"`;
      console.log(`✅ [OneDrive] OAuth tokens stored for ${target}`);
      res.json({ success: true, expiresIn: data.expires_in, agentId: stateData.agentId });
    } catch (err) {
      console.error('[OneDrive] Token exchange error:', err);
      res.status(500).json({ error: 'Token exchange failed' });
    }
  });

  // Disconnect (clear tokens) — supports agentId in body for per-agent disconnect
  router.post('/disconnect', (req, res) => {
    const agentId = req.body?.agentId || null;
    const username = req.user?.username || 'default';
    const key = tokenKey(agentId, username);
    tokenStore.delete(key);
    const target = agentId ? `agent "${agentId.slice(0, 8)}"` : `user "${username}"`;
    console.log(`🔌 [OneDrive] Disconnected ${target}`);
    res.json({ success: true });
  });

  return router;
}

/**
 * Refresh the access token using the stored refresh token.
 * Called automatically by the MCP proxy when the access token expires.
 */
export async function refreshAccessToken(key) {
  const config = getConfig();
  if (!config) throw new Error('OneDrive not configured');

  const tokens = tokenStore.get(key);
  if (!tokens?.refreshToken) throw new Error('No refresh token available');

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: 'refresh_token',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error('[OneDrive] Token refresh failed:', data);
    tokenStore.delete(key);
    throw new Error(data.error_description || 'Token refresh failed');
  }

  tokenStore.set(key, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  });

  console.log(`🔄 [OneDrive] Token refreshed for "${key}"`);
  return data.access_token;
}

/**
 * Get a valid access token for a key (username or "agent:<id>"), refreshing if needed.
 */
export async function getAccessToken(key = 'default') {
  const tokens = tokenStore.get(key);
  if (!tokens) throw new Error('Not connected to OneDrive. Please authenticate first.');

  if (Date.now() >= tokens.expiresAt) {
    return refreshAccessToken(key);
  }

  return tokens.accessToken;
}

/**
 * Get a valid access token for an agent, falling back to the default user.
 * This is the primary function used by the MCP handler.
 */
export async function getAccessTokenForAgent(agentId) {
  // Try agent-specific tokens first
  if (agentId) {
    const agentKey = `agent:${agentId}`;
    const agentTokens = tokenStore.get(agentKey);
    if (agentTokens) {
      if (Date.now() >= agentTokens.expiresAt) {
        return refreshAccessToken(agentKey);
      }
      return agentTokens.accessToken;
    }
  }

  // Fall back to default user
  const store = getTokenStore();
  for (const [key, tokens] of store) {
    if (!key.startsWith('agent:') && tokens.expiresAt > Date.now()) {
      return tokens.accessToken;
    }
  }

  throw new Error('Not connected to OneDrive. Please authenticate first.');
}
