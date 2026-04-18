import express from 'express';
import crypto from 'crypto';

/**
 * Slack OAuth2 routes.
 *
 * Flow:
 * 1. Client calls GET /api/slack/auth-url → receives the Slack OAuth login URL
 * 2. User logs in on Slack, gets redirected to the configured redirect URI
 * 3. Client captures the auth code and POST /api/slack/callback with { code, state }
 * 4. Server exchanges the code for an access token via Slack OAuth2
 * 5. Tokens are stored in-memory (per-agent) and used by the Slack MCP proxy
 *
 * Per-agent mode:
 *   When agentId is provided, tokens are stored under "agent:<agentId>" key.
 *   This allows each agent to have its own Slack connection independent of others.
 *
 * Environment variables:
 *   SLACK_CLIENT_ID     — Slack OAuth2 client ID
 *   SLACK_CLIENT_SECRET — Slack OAuth2 client secret
 *   SLACK_REDIRECT_URI  — Must match the redirect URI configured in the Slack app
 */

// In-memory token store: key → { accessToken, teamId, teamName, botUserId, authedUser }
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
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

export function getSlackTokenStore() {
  return tokenStore;
}

/**
 * Check if an agent has Slack tokens stored.
 */
export function hasSlackTokensForAgent(agentId) {
  if (!agentId) return false;
  const key = `agent:${agentId}`;
  return tokenStore.has(key);
}

export function slackRoutes() {
  const router = express.Router();

  // Check if Slack is configured (supports ?agentId= for per-agent status)
  router.get('/status', (req, res) => {
    const config = getConfig();
    const agentId = req.query.agentId || null;
    const username = (req as any).user?.username;

    const key = tokenKey(agentId, username);
    const tokens = tokenStore.get(key);
    const connected = !!tokens;

    res.json({
      configured: !!config,
      connected,
      teamName: connected ? tokens.teamName || null : null,
      agentId: agentId || null,
    });
  });

  // Get the Slack OAuth authorization URL (supports ?agentId= for per-agent auth)
  router.get('/auth-url', (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({
        error: 'Slack not configured. Set SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, and SLACK_REDIRECT_URI.',
      });
    }

    const agentId = req.query.agentId || null;

    // Bot token scopes (what the bot can do in the workspace)
    const scopes = [
      'channels:read',
      'channels:history',
      'chat:write',
      'users:read',
      'groups:read',
      'groups:history',
      'im:read',
      'im:history',
      'im:write',
      'mpim:read',
      'mpim:history',
      'reactions:read',
      'reactions:write',
      'files:read',
    ];

    const state = generateOAuthState((req as any).user?.username || 'default', agentId);

    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: scopes.join(','),
      redirect_uri: config.redirectUri,
      state,
    });

    const authUrl = `https://slack.com/oauth/v2/authorize?${params}`;
    res.json({ authUrl });
  });

  // Exchange authorization code for tokens
  router.post('/callback', async (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: 'Slack not configured' });
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
      const tokenUrl = 'https://slack.com/api/oauth.v2.access';
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data = await response.json();

      if (!data.ok) {
        console.error('[Slack] Token exchange failed:', data);
        return res.status(400).json({ error: `Token exchange failed: ${data.error}` });
      }

      const key = tokenKey(stateData.agentId, stateData.username);
      tokenStore.set(key, {
        accessToken: data.access_token,
        teamId: data.team?.id,
        teamName: data.team?.name,
        botUserId: data.bot_user_id,
        authedUser: data.authed_user,
      });

      const target = stateData.agentId ? `agent "${stateData.agentId.slice(0, 8)}"` : `user "${stateData.username}"`;
      console.log(`✅ [Slack] OAuth tokens stored for ${target} (team: ${data.team?.name || 'unknown'})`);
      res.json({ success: true, teamName: data.team?.name, agentId: stateData.agentId });
    } catch (err) {
      console.error('[Slack] Token exchange error:', err);
      res.status(500).json({ error: 'Token exchange failed' });
    }
  });

  // Disconnect (clear tokens) — supports agentId in body for per-agent disconnect
  router.post('/disconnect', (req, res) => {
    const agentId = req.body?.agentId || null;
    const username = (req as any).user?.username || 'default';
    const key = tokenKey(agentId, username);
    tokenStore.delete(key);
    const target = agentId ? `agent "${agentId.slice(0, 8)}"` : `user "${username}"`;
    console.log(`🔌 [Slack] Disconnected ${target}`);
    res.json({ success: true });
  });

  return router;
}

/**
 * Get a valid access token for an agent, falling back to the default user.
 * This is the primary function used by the MCP handler.
 */
export function getSlackAccessTokenForAgent(agentId) {
  // Try agent-specific tokens first
  if (agentId) {
    const agentKey = `agent:${agentId}`;
    const agentTokens = tokenStore.get(agentKey);
    if (agentTokens) {
      return agentTokens.accessToken;
    }
  }

  // Fall back to any non-agent token
  for (const [key, tokens] of tokenStore) {
    if (!key.startsWith('agent:')) {
      return tokens.accessToken;
    }
  }

  throw new Error('Not connected to Slack. Please authenticate first.');
}
