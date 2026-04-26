import express from 'express';

/**
 * Jira per-agent authentication routes.
 *
 * Unlike Gmail/OneDrive (OAuth2), Jira uses API token + Basic Auth.
 * Each agent stores its own Jira credentials (domain, email, apiToken).
 *
 * Flow:
 * 1. Admin enters Jira domain, email, and API token in the agent's Plugins tab
 * 2. POST /api/jira/connect with { agentId, domain, email, apiToken }
 * 3. Server stores credentials in-memory keyed by agentId
 * 4. MCP tools use these credentials to call Jira REST APIs
 */

// In-memory credential store: "agent:<agentId>" → { domain, email, apiToken }
const credentialStore = new Map<string, { domain: string; email: string; apiToken: string }>();

function credKey(agentId: string) {
  return `agent:${agentId}`;
}

export function getJiraCredentialStore() {
  return credentialStore;
}

export function hasJiraCredentialsForAgent(agentId: string): boolean {
  if (!agentId) return false;
  return credentialStore.has(credKey(agentId));
}

export function getJiraCredentialsForAgent(agentId: string | null) {
  if (!agentId) return null;
  return credentialStore.get(credKey(agentId)) || null;
}

export function jiraRoutes() {
  const router = express.Router();

  // GET /jira/status?agentId= — check connection status for an agent
  router.get('/status', (req, res) => {
    const agentId = (req.query.agentId as string) || null;
    if (!agentId) {
      return res.json({ connected: false, agentId: null });
    }
    const creds = credentialStore.get(credKey(agentId));
    res.json({
      connected: !!creds,
      domain: creds?.domain || null,
      email: creds?.email || null,
      agentId,
    });
  });

  // POST /jira/connect — store Jira credentials for an agent
  router.post('/connect', async (req, res) => {
    const { agentId, domain, email, apiToken } = req.body;
    if (!agentId || !domain || !email || !apiToken) {
      return res.status(400).json({ error: 'agentId, domain, email, and apiToken are required' });
    }

    // Validate credentials by calling Jira API
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const baseUrl = `https://${cleanDomain}`;
    const encoded = Buffer.from(`${email}:${apiToken}`).toString('base64');

    try {
      const testRes = await fetch(`${baseUrl}/rest/api/3/myself`, {
        headers: {
          Authorization: `Basic ${encoded}`,
          Accept: 'application/json',
        },
      });

      if (!testRes.ok) {
        const body = await testRes.text().catch(() => '');
        return res.status(400).json({ error: `Jira authentication failed (${testRes.status}): ${body.slice(0, 200)}` });
      }

      const myself = await testRes.json();

      credentialStore.set(credKey(agentId), { domain: cleanDomain, email, apiToken });
      console.log(`✅ [Jira] Credentials stored for agent "${agentId.slice(0, 8)}" → ${cleanDomain} (${myself.displayName || email})`);
      res.json({ success: true, agentId, displayName: myself.displayName, domain: cleanDomain });
    } catch (err) {
      console.error('[Jira] Connection test failed:', err);
      res.status(500).json({ error: `Connection failed: ${err.message}` });
    }
  });

  // POST /jira/disconnect — clear credentials for an agent
  router.post('/disconnect', (req, res) => {
    const agentId = req.body?.agentId || null;
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' });
    }
    credentialStore.delete(credKey(agentId));
    console.log(`🔌 [Jira] Disconnected agent "${agentId.slice(0, 8)}"`);
    res.json({ success: true });
  });

  return router;
}
