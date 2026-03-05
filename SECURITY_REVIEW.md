# Security Review — AgentsSwarmUI

**Date:** 2026-03-05
**Reviewer:** CLAUDE (Autonomous Security Agent)
**Scope:** Full codebase — server, client, DevOps, dependencies

---

## Executive Summary

The AgentsSwarmUI project demonstrates **good security awareness overall**, with many best practices already in place: JWT-based auth, bcrypt password hashing, rate limiting, Zod input validation, parameterized SQL queries, shell argument escaping, path traversal prevention, security headers, WebSocket origin validation, and per-socket rate limiting.

However, several issues were identified, ranging from **CRITICAL** (credential exposure) to **LOW** (hardening recommendations).

---

## CRITICAL

### 1. Production Secrets in `devops/.env` on Disk
**Location:** `devops/.env`
**Risk:** Total compromise of all integrated services

The `devops/.env` file contains **real production secrets**:
- `ANTHROPIC_API_KEY` (sk-ant-api03-...)
- `OPENAI_API_KEY` (sk-proj-...)
- `MISTRAL_API_KEY`
- `GITHUB_TOKEN` (github_pat_...)
- `DATABASE_URL` with password
- `JWT_SECRET`
- `ADMIN_PASSWORD`

**While this file is correctly in `.gitignore`**, it exists on disk and could be exposed through:
- Backup processes
- Docker volume mounts
- Developer machine compromise
- Accidental `git add -f`

**Recommendation:**
- **Immediately rotate ALL exposed keys** (Anthropic, OpenAI, Mistral, GitHub PAT, JWT secret, admin password, DB password)
- Use a secrets manager (Docker Secrets, Vault, AWS SSM) instead of `.env` files
- Verify the file was never committed: `git log --all -- devops/.env` (confirmed clean)

### 2. Docker Socket Mounted in Production
**Location:** `devops/docker-compose.swarm.yml:32`
```yaml
- /var/run/docker.sock:/var/run/docker.sock
```
**Risk:** Container escape → host root access

The Docker socket gives the server container full control over the Docker daemon, meaning any code execution inside the container (including agent-generated code) can:
- Start privileged containers
- Mount the host filesystem
- Execute arbitrary commands as root on the host

**Recommendation:**
- Use Docker-in-Docker (DinD) with a separate daemon
- Or use a restricted Docker proxy like [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)
- The sandbox system already runs commands inside a separate container — consider using the Docker API over TCP with TLS mutual auth instead of the socket

---

## HIGH

### 3. API Keys Stored in Agent Objects (Database)
**Location:** `server/src/routes/agents.js:12`, `server/src/services/agentManager.js:89`
**Risk:** API key exposure through GET endpoints

Agent API keys (`apiKey` field) are stored in the agent JSONB column and returned in full via:
- `GET /api/agents` — returns all agents with their `apiKey`
- `GET /api/agents/:id` — returns single agent with `apiKey`
- WebSocket `agents:list` — broadcasts all agent data

Any authenticated user can see all API keys for all agents.

**Recommendation:**
- Strip `apiKey` from API responses (mask or omit it)
- Store API keys encrypted at rest or in a separate secure store
- Only return a masked version (e.g., `sk-...last4`) in GET responses

### 4. JWT Token Expiry Too Long (24h)
**Location:** `server/src/middleware/auth.js:108`
```js
{ expiresIn: '24h' }
```
**Risk:** Extended window for token theft

A 24-hour JWT with no refresh mechanism means a stolen token is valid for an entire day.

**Recommendation:**
- Reduce JWT expiry to 1-2 hours
- Implement refresh tokens with rotation
- Add token revocation capability (e.g., maintain a blocklist in Redis/DB)

### 5. No Role-Based Access Control (RBAC)
**Location:** `server/src/middleware/auth.js:133-145`

The `authenticateToken` middleware verifies the token is valid but never checks `req.user.role`. All authenticated users have full admin access to all endpoints (create/delete agents, broadcast, clear histories, etc.).

**Recommendation:**
- Add role checks: `admin` can manage agents, `viewer` can only read
- Protect destructive endpoints (DELETE, broadcast, clear) with admin-only middleware

---

## MEDIUM

### 6. Default Admin Credentials Logged to Console
**Location:** `server/src/middleware/auth.js:17`
```js
const adminPassword = process.env.ADMIN_PASSWORD || 'swarm2026';
```
**Risk:** Default password used in development

In non-production, the default password `swarm2026` is used. The warning is printed but the server continues running. While the server exits in production without `ADMIN_PASSWORD`, a misconfigured `NODE_ENV` could leave defaults active.

**Status:** Partially mitigated (production exits). No fix needed but worth noting.

### 7. Client-Side Token Storage in localStorage
**Location:** `client/src/api.js:4`
```js
const token = localStorage.getItem('token');
```
**Risk:** XSS → token theft

`localStorage` is accessible to any JavaScript running on the page. If XSS is achieved, the attacker can steal the JWT.

**Recommendation:**
- Use `httpOnly` cookies for token storage (prevents JS access)
- Or use `sessionStorage` (clears on tab close, slight improvement)
- The strong CSP headers mitigate this risk significantly

### 8. WebSocket JWT_SECRET Direct Access
**Location:** `server/src/index.js:132`
```js
const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
```
**Risk:** Bypasses the safety check in `getJwtSecret()`

The WebSocket auth middleware reads `process.env.JWT_SECRET` directly instead of using the `getJwtSecret()` helper from `auth.js`, which throws if the secret is undefined. If `JWT_SECRET` is unset, `jwt.verify(token, undefined)` could have unpredictable behavior.

**Recommendation:** Use the shared `getJwtSecret()` function.

### 9. SSH Keys Shared Across All Sandbox Agent Users
**Location:** `server/src/services/sandboxManager.js:256-259`

All sandbox agent users get a copy of the root SSH keys. This means any agent can push to any Git repository the SSH key has access to.

**Recommendation:**
- Use deploy keys (read-only) per repository
- Or use per-agent SSH keypairs

### 10. In-Memory Users Store
**Location:** `server/src/middleware/auth.js:8`
```js
const users = new Map();
```
**Risk:** No user management, no password change capability

Users are stored in memory with only a single admin user. No ability to:
- Create additional users
- Change passwords
- Audit login history

**Recommendation:** Move user management to the PostgreSQL database.

---

## LOW

### 11. Missing `helmet` Middleware
The security headers are set manually (which is correct), but using `helmet` would provide additional defaults and stay updated with emerging best practices.

### 12. No Request ID / Audit Trail
There's no request ID middleware for correlating log entries across a request lifecycle. Adding `express-request-id` or similar would improve observability and forensic capabilities.

### 13. `client/dist/` Committed and Mounted
**Location:** `client/.gitignore` does NOT exclude `dist/`, and `docker-compose.swarm.yml:76` mounts it directly.
The built client is served from a volume mount of the host's `dist/` folder. This means the build artifacts must exist on the host, and any modification to the host files immediately changes what's served.

### 14. Error Messages May Leak Stack Traces
Several routes return `err.message` directly:
```js
res.status(500).json({ error: err.message });
```
In production, this could reveal internal paths or library details.

**Recommendation:** Return generic error messages in production, log details server-side.

---

## What's Already Done Well

| Area | Implementation | Grade |
|------|---------------|-------|
| **Password Hashing** | bcrypt with cost 10 | Good |
| **JWT Auth** | Proper verify, required JWT_SECRET | Good |
| **Login Rate Limiting** | 5 attempts/15min per IP | Good |
| **API Rate Limiting** | 100 req/min global + per-socket WS limiter | Good |
| **Input Validation** | Zod schemas on all routes, UUID regex on WS | Good |
| **SQL Injection** | Parameterized queries ($1, $2) throughout | Excellent |
| **Command Injection** | Shell arg escaping via `_sh()`, commit msg sanitization | Good |
| **Path Traversal** | `..` segment filtering in `normalizePath()` and `_projectPath()` | Good |
| **Security Headers** | CSP, X-Frame-Options, HSTS, nosniff, XSS-Protection | Good |
| **WebSocket Auth** | JWT required + origin validation | Good |
| **CORS** | Configurable origins, not wildcard | Good |
| **Body Size Limit** | 1MB JSON limit | Good |
| **Dependency Audit** | `npm audit` — 0 vulnerabilities | Excellent |
| **Production Safety** | Exits if ADMIN_PASSWORD missing in production | Good |
| **Docker Socket** | Removed from sandbox (comment in code) | Good |
| **Sandbox Isolation** | Per-agent Linux users, separate container | Good |

---

## Priority Action Items

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Rotate all secrets in `devops/.env` | 1 hour |
| **P0** | Replace Docker socket mount with socket proxy | 2 hours |
| **P1** | Strip API keys from GET /agents responses | 30 min |
| **P1** | Add RBAC to endpoints | 2 hours |
| **P2** | Reduce JWT expiry + add refresh tokens | 2 hours |
| **P2** | Fix WS JWT_SECRET direct access | 5 min |
| **P2** | Use httpOnly cookies instead of localStorage | 2 hours |
| **P3** | Move users to database | 4 hours |
| **P3** | Add audit logging | 2 hours |
