import express from 'express';
import crypto from 'crypto';

/**
 * GitHub OAuth2 routes.
 *
 * Flow:
 * 1. Client calls GET /api/github/auth-url → receives the GitHub OAuth login URL
 * 2. User logs in on GitHub, gets redirected to the configured redirect URI
 * 3. Client captures the auth code and POST /api/github/callback with { code, state }
 * 4. Server exchanges the code for an access token via GitHub OAuth2
 * 5. Token is stored in-memory (per-agent) and used by the GitHub MCP proxy
 *
 * Per-agent mode:
 *   When agentId is provided, tokens are stored under "agent:<agentId>" key.
 *   Each agent gets its own GitHub connection with its own repo access scope.
 *
 * Environment variables:
 *   GITHUB_OAUTH_CLIENT_ID     — GitHub OAuth App client ID
 *   GITHUB_OAUTH_CLIENT_SECRET — GitHub OAuth App client secret
 *   GITHUB_OAUTH_REDIRECT_URI  — Must match the callback URL in the GitHub OAuth App settings
 */

const tokenStore = new Map();
const stateStore = new Map();
const STATE_TTL_MS = 10 * 60 * 1000;

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
  stateStore.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return { username: entry.username, agentId: entry.agentId || null };
}

function tokenKey(agentId, username) {
  if (agentId) return `agent:${agentId}`;
  return username || 'default';
}

function getConfig() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return null;
  }

  return { clientId, clientSecret, redirectUri };
}

export function getGitHubTokenStore() {
  return tokenStore;
}

export function hasGitHubTokensForAgent(agentId) {
  if (!agentId) return false;
  const key = `agent:${agentId}`;
  const tokens = tokenStore.get(key);
  return !!(tokens && tokens.accessToken);
}

export function githubRoutes() {
  const router = express.Router();

  router.get('/status', (req, res) => {
    const config = getConfig();
    const agentId = req.query.agentId || null;
    const username = req.user?.username;

    const key = tokenKey(agentId, username);
    const tokens = tokenStore.get(key);
    const connected = !!(tokens && tokens.accessToken);

    res.json({
      configured: !!config,
      connected,
      login: connected ? tokens.login || null : null,
      agentId: agentId || null,
    });
  });

  router.get('/auth-url', (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({
        error: 'GitHub OAuth not configured. Set GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, and GITHUB_OAUTH_REDIRECT_URI.',
      });
    }

    const agentId = req.query.agentId || null;
    const state = generateOAuthState(req.user?.username || 'default', agentId);

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'repo read:org read:user',
      state,
    });

    const authUrl = `https://github.com/login/oauth/authorize?${params}`;
    res.json({ authUrl });
  });

  router.post('/callback', async (req, res) => {
    const config = getConfig();
    if (!config) {
      return res.status(500).json({ error: 'GitHub OAuth not configured' });
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
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
        }),
      });

      const data = await response.json();

      if (data.error) {
        console.error('[GitHub] Token exchange failed:', data);
        return res.status(400).json({ error: data.error_description || 'Token exchange failed' });
      }

      let login = null;
      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'PulsarTeam',
          },
        });
        if (userRes.ok) {
          const user = await userRes.json();
          login = user.login;
        }
      } catch (err) {
        console.warn('[GitHub] Could not fetch user profile:', err.message);
      }

      const key = tokenKey(stateData.agentId, stateData.username);
      tokenStore.set(key, {
        accessToken: data.access_token,
        scope: data.scope,
        tokenType: data.token_type,
        login,
      });

      const target = stateData.agentId ? `agent "${stateData.agentId.slice(0, 8)}"` : `user "${stateData.username}"`;
      console.log(`✅ [GitHub] OAuth token stored for ${target} (${login || 'unknown'})`);
      res.json({ success: true, agentId: stateData.agentId, login });
    } catch (err) {
      console.error('[GitHub] Token exchange error:', err);
      res.status(500).json({ error: 'Token exchange failed' });
    }
  });

  router.post('/disconnect', (req, res) => {
    const agentId = req.body?.agentId || null;
    const username = req.user?.username || 'default';
    const key = tokenKey(agentId, username);
    tokenStore.delete(key);
    const target = agentId ? `agent "${agentId.slice(0, 8)}"` : `user "${username}"`;
    console.log(`🔌 [GitHub] Disconnected ${target}`);
    res.json({ success: true });
  });

  return router;
}

export async function getGitHubAccessTokenForAgent(agentId) {
  if (agentId) {
    const agentKey = `agent:${agentId}`;
    const agentTokens = tokenStore.get(agentKey);
    if (agentTokens?.accessToken) {
      return agentTokens.accessToken;
    }
  }

  for (const [key, tokens] of tokenStore) {
    if (!key.startsWith('agent:') && tokens.accessToken) {
      return tokens.accessToken;
    }
  }

  throw new Error('Not connected to GitHub. Please authenticate first.');
}
