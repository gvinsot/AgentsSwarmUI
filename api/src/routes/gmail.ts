import express from 'express';
import crypto from 'crypto';

/**
 * Gmail OAuth2 routes.
 *
 * Flow:
 * 1. Client calls GET /api/gmail/auth-url → receives the Google OAuth login URL
 * 2. User logs in on Google, gets redirected to the configured redirect URI
 * 3. Client captures the auth code and POST /api/gmail/callback with { code, state }
 * 4. Server exchanges the code for access + refresh tokens via Google OAuth2
 * 5. Tokens are stored in-memory (per-user OR per-agent) and used by the Gmail MCP proxy
 *
 * Per-agent mode:
 *   When agentId is provided, tokens are stored under "agent:<agentId>" key.
 *   This allows each agent to have its own Gmail connection independent of others.
 *
 * Environment variables:
 *   GMAIL_CLIENT_ID     — Google OAuth2 client ID
 *   GMAIL_CLIENT_SECRET — Google OAuth2 client secret
 *   GMAIL_REDIRECT_URI  — Must match the redirect URI configured in Google Cloud Console
 */

// In-memory token store: key → { accessToken, refreshToken, expiresAt, email }
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
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

export function getGmailTokenStore() {
  return tokenStore;
}

/**
 * Check if an agent has Gmail tokens stored.
 */
export function hasGmailTokensForAgent(agentId) {
  if (!agentId) return false;
  const key = `agent:${agentId}`;
  const tokens = tokenStore.get(key);
  return !!(tokens && tokens.expiresAt > Date.now() - 3600000); // valid or refreshable
}

export function gmailRoutes() {
  const router = express.Router();

  // Check if Gmail is configured (supports ?agentId= for per-agent status)
  router.get('/status', (req, res) => {
    const config = getConfig();
    const agentId = req.query.agentId || null;
    const username = req.user?.username;

    const key = tokenKey(agentId, username);
    const tokens = tokenStore.get(key);
    const connected = !!(tokens && tokens.expiresAt > Date.now());

    res.json({
      configured: !!config,
      connected,
      email: connected ? tokens.email || null : null,
      agentId: agentId || null,
    });
  });

  // Get the Google OAuth authorization URL (supports ?agentId= for per-agent auth)
  router.get('/auth-url', (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({
        error: 'Gmail not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REDIRECT_URI.',
      });
    }

    const agentId = req.query.agentId || null;

    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const state = generateOAuthState(req.user?.username || 'default', agentId);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    res.json({ authUrl });
  });

  // Exchange authorization code for tokens
  router.post('/callback', async (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: 'Gmail not configured' });
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
      const tokenUrl = 'https://oauth2.googleapis.com/token';
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
        console.error('[Gmail] Token exchange failed:', data);
        return res.status(400).json({ error: 'Token exchange failed' });
      }

      // Get user email from the access token
      let email = null;
      try {
        const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          email = profile.emailAddress;
        }
      } catch (err) {
        console.warn('[Gmail] Could not fetch profile email:', err.message);
      }

      const key = tokenKey(stateData.agentId, stateData.username);
      tokenStore.set(key, {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // subtract 60s buffer
        email,
      });

      const target = stateData.agentId ? `agent "${stateData.agentId.slice(0, 8)}"` : `user "${stateData.username}"`;
      console.log(`✅ [Gmail] OAuth tokens stored for ${target} (${email || 'unknown email'})`);
      res.json({ success: true, expiresIn: data.expires_in, agentId: stateData.agentId, email });
    } catch (err) {
      console.error('[Gmail] Token exchange error:', err);
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
    console.log(`🔌 [Gmail] Disconnected ${target}`);
    res.json({ success: true });
  });

  return router;
}

/**
 * Refresh the access token using the stored refresh token.
 * Called automatically by the MCP handler when the access token expires.
 */
export async function refreshGmailAccessToken(key) {
  const config = getConfig();
  if (!config) throw new Error('Gmail not configured');

  const tokens = tokenStore.get(key);
  if (!tokens?.refreshToken) throw new Error('No refresh token available');

  const tokenUrl = 'https://oauth2.googleapis.com/token';
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
    console.error('[Gmail] Token refresh failed:', data);
    tokenStore.delete(key);
    throw new Error(data.error_description || 'Token refresh failed');
  }

  tokenStore.set(key, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    email: tokens.email,
  });

  console.log(`🔄 [Gmail] Token refreshed for "${key}"`);
  return data.access_token;
}

/**
 * Get a valid access token for a key (username or "agent:<id>"), refreshing if needed.
 */
export async function getGmailAccessToken(key = 'default') {
  const tokens = tokenStore.get(key);
  if (!tokens) throw new Error('Not connected to Gmail. Please authenticate first.');

  if (Date.now() >= tokens.expiresAt) {
    return refreshGmailAccessToken(key);
  }

  return tokens.accessToken;
}

/**
 * Get a valid access token for an agent, falling back to the default user.
 * This is the primary function used by the MCP handler.
 */
export async function getGmailAccessTokenForAgent(agentId) {
  // Try agent-specific tokens first
  if (agentId) {
    const agentKey = `agent:${agentId}`;
    const agentTokens = tokenStore.get(agentKey);
    if (agentTokens) {
      if (Date.now() >= agentTokens.expiresAt) {
        return refreshGmailAccessToken(agentKey);
      }
      return agentTokens.accessToken;
    }
  }

  // Fall back to default user
  const store = getGmailTokenStore();
  for (const [key, tokens] of store) {
    if (!key.startsWith('agent:') && tokens.expiresAt > Date.now()) {
      return tokens.accessToken;
    }
  }

  throw new Error('Not connected to Gmail. Please authenticate first.');
}
