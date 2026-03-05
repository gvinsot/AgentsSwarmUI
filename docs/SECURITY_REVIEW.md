# Security Review — AgentsSwarmUI

**Date:** 2026-03-05
**Reviewer:** CLAUDE (Automated Security Agent)
**Scope:** Full-stack review of server, client, DevOps, and dependency management

---

## Executive Summary

The AgentsSwarmUI project follows several security best practices (JWT auth, bcrypt hashing, parameterized SQL, rate limiting, sandbox isolation, security headers). However, several **critical** and **high-severity** issues were identified that require immediate attention.

| Severity | Count | Summary |
|----------|-------|---------|
| CRITICAL | 3 | Hardcoded secrets in `.env`, Docker socket exposure, health endpoint unauthenticated |
| HIGH     | 5 | Default credentials, no CSRF protection, no input validation/sanitization on agent creation, JWT token in localStorage, vulnerable transitive dependencies |
| MEDIUM   | 5 | No role-based authorization, in-memory user store, login rate limiter in-memory only, missing CSP header, no token refresh mechanism |
| LOW      | 3 | No request body size validation per route, `X-XSS-Protection` is deprecated, missing `Strict-Transport-Security` in nginx |

---

## CRITICAL Issues

### C1. Production Secrets in `devops/.env`

**File:** `devops/.env`
**Impact:** Full compromise of all integrated services

The `devops/.env` file contains **real production secrets** in plaintext:
- Anthropic API key (`sk-ant-api03-...`)
- OpenAI API key (`sk-proj-...`)
- Mistral API key
- GitHub personal access token (`github_pat_...`)
- PostgreSQL database credentials
- Admin password
- JWT secret

**Status:** File is NOT tracked by git (`.gitignore` covers `*.env`), but it exists on the filesystem and could be accidentally committed or leaked.

**Recommendations:**
1. **Immediately rotate ALL exposed credentials** (API keys, database passwords, GitHub token, JWT secret)
2. Use a secrets manager (HashiCorp Vault, Docker Swarm secrets, or encrypted `.env` files)
3. Add `devops/.env` explicitly to `.gitignore` for clarity
4. Run `git log --all -- devops/.env` periodically to verify no accidental commits

### C2. Docker Socket Mounted into Server Container

**File:** `devops/docker-compose.swarm.yml:30`
```yaml
- /var/run/docker.sock:/var/run/docker.sock
```

**Impact:** Container escape / full host compromise

Mounting the Docker socket gives the server container (and any code it runs) **root-level access to the host**. A compromised agent could execute arbitrary Docker commands on the host.

**Recommendations:**
1. Use a Docker socket proxy with restricted permissions (e.g., Tecnativa/docker-socket-proxy)
2. Restrict Docker API access to only the commands needed (container create/exec/rm)
3. Consider rootless Docker or Podman

### C3. Health Endpoint Exposes Internal State Without Auth

**File:** `server/src/index.js:60-88`

The `/api/health` endpoint is not protected by `authenticateToken` and exposes:
- Server uptime
- Total agent count
- Agent status distribution (busy/idle/error)
- Project names and agent distribution per project

**Recommendations:**
1. Separate liveness probe (`/healthz` returning just `{"status":"ok"}`) from detailed status
2. Protect the detailed status endpoint with authentication

---

## HIGH Issues

### H1. Default Admin Credentials

**File:** `server/src/middleware/auth.js:17`
```javascript
const adminPassword = process.env.ADMIN_PASSWORD || 'swarm2026';
```

If `ADMIN_PASSWORD` is not set, the default password `swarm2026` is used. This is easily guessable.

**Recommendations:**
1. Refuse to start if `ADMIN_PASSWORD` is not explicitly set in production
2. Enforce minimum password complexity requirements
3. Log a warning if default credentials are being used

### H2. No CSRF Protection

**Impact:** Cross-site request forgery on all state-changing API endpoints

The server uses JWT in `Authorization` header (good), but if the token is stored in a cookie or via `localStorage` and a malicious page scripts a fetch with the token, CSRF is possible. More critically, the WebSocket has no CSRF origin checking beyond the CORS config.

**Recommendations:**
1. Add CSRF token validation for state-changing REST endpoints
2. Validate the `Origin` header on WebSocket handshake against allowed origins
3. Consider using `SameSite=Strict` cookies instead of `localStorage` for token storage

### H3. No Input Validation on Agent Creation

**File:** `server/src/routes/agents.js:57-64`
```javascript
router.post('/', (req, res) => {
  const agent = agentManager.create(req.body);
  // No validation of req.body fields
});
```

The entire `req.body` is passed directly to `agentManager.create()` without schema validation. An attacker could inject arbitrary fields (e.g., `isAdmin`, `apiKey`, or craft a prototype pollution payload).

**Recommendations:**
1. Use Zod (already a dependency!) to validate all request bodies
2. Whitelist allowed fields for agent creation/update
3. Apply the same validation to all POST/PUT routes

### H4. JWT Token Stored in localStorage

**File:** `client/src/App.jsx:194`
```javascript
localStorage.setItem('token', data.token);
```

Tokens in `localStorage` are accessible to any JavaScript on the page, making them vulnerable to XSS-based token theft.

**Recommendations:**
1. Use `httpOnly` cookies for token storage (not accessible via JS)
2. If `localStorage` must be used, implement a short-lived access token + refresh token pattern
3. Add Content Security Policy headers to mitigate XSS

### H5. Vulnerable Transitive Dependencies (server)

**npm audit:** 2 high-severity vulnerabilities in transitive dependencies:
- `@hono/node-server` < 1.19.10 — authorization bypass via encoded slashes
- `hono` <= 4.12.3 — cookie injection, SSE injection, arbitrary file access

These come from the `@modelcontextprotocol/sdk` dependency.

**Recommendations:**
1. Run `npm audit fix` or add overrides in `package.json` for `hono` and `@hono/node-server`
2. Monitor for `@modelcontextprotocol/sdk` updates that fix transitive deps
3. Set up automated dependency scanning (Dependabot, Renovate)

---

## MEDIUM Issues

### M1. No Role-Based Authorization (RBAC)

All authenticated users have the same access level. The `role` field exists on JWT tokens but is never checked on any route. Any authenticated user can:
- Create/delete agents
- Execute commands in sandboxes
- Access all projects
- Broadcast messages to all agents

**Recommendation:** Implement middleware that checks `req.user.role` for destructive operations.

### M2. In-Memory User Store

**File:** `server/src/middleware/auth.js:8`
```javascript
const users = new Map();
```

Users are stored in memory and lost on restart. This also means:
- No multi-instance support
- Password changes don't persist
- No user management API

**Recommendation:** Store users in the PostgreSQL database.

### M3. Login Rate Limiter is In-Memory Only

**File:** `server/src/middleware/auth.js:37`

The rate limiter uses an in-memory `Map`, which:
- Resets on server restart
- Doesn't work across multiple instances
- Can be bypassed by restarting the server
- Leaks memory (entries are never cleaned up)

**Recommendations:**
1. Use a Redis-backed rate limiter for production
2. At minimum, add periodic cleanup of expired entries
3. Consider using `express-rate-limit` with a persistent store

### M4. Missing Content-Security-Policy Header

**File:** `client/nginx.conf`

The nginx config includes `X-Content-Type-Options`, `X-Frame-Options`, and `X-XSS-Protection`, but lacks a `Content-Security-Policy` header.

**Recommendation:** Add a CSP header:
```
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; img-src 'self' data:;" always;
```

### M5. No Token Refresh Mechanism

JWT tokens are issued with a 24-hour expiry and there is no refresh token mechanism. If a token is stolen, it remains valid for 24 hours with no way to revoke it.

**Recommendations:**
1. Implement refresh tokens with shorter access token lifetimes (15 min)
2. Add a token revocation list (blacklist) for logout
3. Store refresh tokens in `httpOnly` cookies

---

## LOW Issues

### L1. No Per-Route Request Body Size Limits

**File:** `server/src/index.js:46`
```javascript
app.use(express.json({ limit: '10mb' }));
```

A global 10MB limit is set, but large payloads could be used for DoS on specific endpoints that don't need large bodies.

**Recommendation:** Apply smaller limits to routes that don't need large payloads (e.g., login, status endpoints).

### L2. Deprecated X-XSS-Protection Header

**File:** `client/nginx.conf:22`
```
add_header X-XSS-Protection "1; mode=block" always;
```

This header is deprecated in modern browsers and can introduce vulnerabilities in older ones. CSP is the modern replacement.

**Recommendation:** Remove this header and rely on CSP instead.

### L3. Missing Strict-Transport-Security in Nginx

**File:** `client/nginx.conf`

No `Strict-Transport-Security` (HSTS) header is set. While Traefik handles TLS, adding HSTS at the application level provides defense-in-depth.

**Recommendation:** Add:
```
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

---

## Positive Security Findings

The project also implements several good security practices:

1. **Parameterized SQL queries** — All database queries use `$1, $2` placeholders (no SQL injection)
2. **bcrypt password hashing** with salt rounds of 10
3. **JWT secret validation** — Server refuses to start without `JWT_SECRET`
4. **Shell argument escaping** — `sandboxManager._sh()` properly escapes single quotes
5. **Path traversal prevention** — `agentTools.js` strips `..` segments from file paths
6. **Rate limiting** on login endpoints and Claude API calls
7. **CORS configuration** with explicit origins (not `*`)
8. **MCP API key masking** — Server sanitizes API keys before sending to client
9. **Docker image uses Alpine** — Minimal attack surface
10. **Sandbox isolation** — Agents run as separate Linux users inside a shared container
11. **Input validation on names** — `_validateName()` and `_validateImageRef()` in SandboxManager
12. **Security headers** in nginx (X-Frame-Options: DENY, X-Content-Type-Options: nosniff)

---

## Priority Action Items

| Priority | Action | Effort |
|----------|--------|--------|
| 1 | Rotate ALL credentials in `devops/.env` | 1 hour |
| 2 | Add Zod validation to all API route request bodies | 2-4 hours |
| 3 | Fix npm audit vulnerabilities (hono, @hono/node-server) | 30 min |
| 4 | Add CSP header to nginx config | 30 min |
| 5 | Restrict health endpoint information disclosure | 30 min |
| 6 | Replace Docker socket mount with socket proxy | 2-4 hours |
| 7 | Implement RBAC middleware | 2-4 hours |
| 8 | Move user store to PostgreSQL | 2-4 hours |
| 9 | Implement token refresh mechanism | 4-8 hours |
| 10 | Set up automated dependency scanning | 1 hour |
