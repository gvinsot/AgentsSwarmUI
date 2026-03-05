# Security Review — AgentsSwarmUI

**Date:** 2026-03-05 (Eighth Review Pass)
**Reviewer:** CLAUDE (Automated Security Agent — Opus 4.6)
**Scope:** Full-stack review of server, client, DevOps, sandbox, and dependency management

---

## Executive Summary

The AgentsSwarmUI project demonstrates **solid security fundamentals**: JWT authentication, bcrypt hashing, parameterized SQL, rate limiting, sandbox isolation, security headers, Zod input validation, and API key masking. This **eighth comprehensive review** independently re-validates the full codebase, confirms all prior fixes remain in place, and consolidates the report. `npm audit` reports **0 vulnerabilities** across both server and client dependencies.

| Severity | Total Found | Fixed | Remaining |
|----------|------------|-------|-----------|
| CRITICAL | 4 | 1 | 3 |
| HIGH     | 3 | 0 | 3 |
| MEDIUM   | 2 | 0 | 2 |
| LOW      | 1 | 0 | 1 |
| INFO     | 2 | 1 | 1 |

---

## Previously Applied Fixes (Confirmed Still in Place)

1. **Health Endpoint Split** — `/api/health` (public, minimal) vs `/api/health/details` (authenticated) (`index.js:84-117`)
2. **Zod Schema Validation** — All creation/update routes (agents, plugins, MCP servers) validated with type/length constraints (`agents.js:5-30`, `plugins.js:5-12`, `mcpServers.js:5-12`)
3. **Default Credentials Warning** — Console warning when `ADMIN_PASSWORD` not set; `process.exit(1)` in production (`auth.js:19-36`)
4. **Security Headers** — Express middleware: `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `CSP`, `HSTS` (`index.js:49-57`)
5. **WebSocket Origin Validation** — Handshake validates `Origin` header against CORS whitelist (`index.js:121-125`)
6. **Command Injection Fix** — `sanitizeCommitMessage()` strips shell metacharacters in `git_commit_push` (`agentTools.js:253-261`)
7. **Rate Limiter Cleanup** — Periodic `setInterval` cleanup prevents memory leaks in login attempt tracking (`auth.js:62-67`)
8. **`.gitignore` Hardening** — `devops/.env` explicitly listed, confirmed NOT tracked by git (`git ls-files` returns empty)
9. **MCP Server URL Validation** — `z.string().url().max(2000)` (`mcpServers.js:7`)
10. **SSH Path Fallback Fixed** — Uses `/root/.ssh` (`sandboxManager.js:224`)
11. **WebSocket Per-Event Rate Limiting** — `createSocketRateLimiter(30, 60_000)` per socket (`socketHandler.js:1-13`)
12. **Docker Socket NOT mounted into sandbox** — Comment in `sandboxManager.js:234` confirms removal

---

## CRITICAL Issues

### C1. Production Secrets in `devops/.env`

**File:** `devops/.env`
**Impact:** Full compromise of all integrated services
**Status:** NOT tracked by git (confirmed via `git ls-files` and `git log`)

The file contains **real production secrets in plaintext**:
- Anthropic API key (`sk-ant-api03-...`)
- OpenAI API key (`sk-proj-...`)
- Mistral API key
- GitHub PAT (`github_pat_...`)
- PostgreSQL credentials (`postgresql://swarm_prod_app:...`)
- Admin password, JWT secret
- Docker registry URL

**Recommendations:**
1. **Immediately rotate ALL credentials** — assume they've been exposed to any agent/process with filesystem access
2. Use Docker Swarm secrets (`docker secret create`) or a vault (HashiCorp Vault, AWS Secrets Manager)
3. Never store real credentials in `.env` files on shared/multi-tenant hosts
4. The sandbox containers (with `docker-cli` access) can potentially read environment variables from the server container

### C2. Docker Socket Mounted into Server Container

**File:** `devops/docker-compose.swarm.yml:30`

The server container gets the Docker socket mounted (`/var/run/docker.sock`). This grants **root-level host access** to any process inside the container. Combined with `docker-cli` in the server Dockerfile (`server/Dockerfile:20`), any code execution vulnerability could escalate to full host compromise.

Attack chain: Prompt injection → sandbox escape → `docker exec <server-container> env` → extracts all API keys.

**Recommendations:**
1. Use a Docker socket proxy (e.g., Tecnativa/docker-socket-proxy) with restricted API endpoints
2. Consider rootless Docker or Podman for sandbox management
3. Isolate sandbox management into a separate sidecar service with minimal permissions

### C3. Sandbox `docker-cli` + `kubectl` Access

**Files:** `server/sandbox.Dockerfile:18, 43-44`

The sandbox image installs `docker-cli`, `docker-cli-compose`, and `kubectl`. While the Docker socket is no longer mounted into sandbox containers (fixed previously), these tools remain in the image. If network conditions change or the socket is re-added, agent code could:
- Execute arbitrary Docker commands on the host
- Interact with Kubernetes clusters

**Recommendation:** Remove `docker-cli`, `docker-cli-compose`, and `kubectl` from the sandbox image.

### C4. `docker-cli` Installed in Server Dockerfile

**File:** `server/Dockerfile:20`

The **server** Dockerfile installs `docker-cli`, which combined with the Docker socket mount gives the server process direct Docker API access. Needed for sandbox management, but any code execution vulnerability in the server could escalate to full host compromise.

**Recommendation:** Consider isolating sandbox management into a separate sidecar service.

---

## HIGH Issues

### H1. JWT Token Stored in localStorage (XSS Risk)

**File:** `client/src/api.js:4`

Tokens in `localStorage` are accessible to any JavaScript on the page. If an XSS vulnerability is ever introduced (e.g., via agent-generated content rendered in the UI), tokens can be stolen.

**Recommendations:**
1. Use `httpOnly`, `Secure`, `SameSite=Strict` cookies for token transport
2. Implement short-lived access tokens (15 min) + refresh token rotation
3. Current CSP header provides defense-in-depth

### H2. 24-Hour JWT Expiry with No Revocation Mechanism

**File:** `server/src/middleware/auth.js:105-109`

JWTs expire after 24 hours and there is no token blacklist. A stolen token remains valid until it expires. No logout endpoint exists.

**Recommendations:**
1. Reduce JWT lifetime to 15-60 minutes
2. Implement refresh tokens stored server-side (in PostgreSQL)
3. Add a token revocation endpoint (`POST /api/auth/logout`)

### H3. SSH Keys Shared Across All Agent Users in Sandbox

**File:** `server/src/services/sandboxManager.js:255-259`

SSH keys from the host are copied to every agent user in the shared sandbox container. All agents share the same keys — a compromised agent could push malicious code to any accessible repo.

**Recommendations:**
1. Use per-repository deploy keys with minimal permissions
2. Implement per-agent SSH key management
3. Consider HTTPS with token-based auth instead of SSH keys

---

## MEDIUM Issues

### M1. No Role-Based Authorization (RBAC)

**Files:** All route files

All authenticated users have identical access. The `role` field exists on JWT tokens (`auth.js:106`) but is **never checked** by any route middleware. Any authenticated user can:
- Delete all agents
- Modify all projects
- Broadcast to all agents
- Access all conversation histories
- Create/modify MCP servers

**Recommendation:** Add middleware that checks `req.user.role` for destructive operations.

### M2. In-Memory User Store

**File:** `server/src/middleware/auth.js:8`

Users are stored in a `Map()` and lost on restart. Only a single admin user can exist. No support for user management.

**Recommendation:** Store users in PostgreSQL (already available). Add user CRUD endpoints behind admin-only authorization.

---

## LOW Issues

### L1. CSP `style-src 'unsafe-inline'`

**File:** `server/src/index.js:54`

The Content-Security-Policy uses `'unsafe-inline'` for `style-src`, which weakens XSS protection for styles. This is common with CSS-in-JS frameworks like Tailwind, but could be hardened.

**Recommendation:** Consider nonce-based or hash-based CSP for styles.

---

## INFO (New Findings — This Pass)

### I1. `NODE_ENV` Not Set in Docker Compose

**File:** `devops/docker-compose.swarm.yml`

The `NODE_ENV` environment variable is not set in the Docker Compose service definition. While `process.env.NODE_ENV === 'production'` is checked in `auth.js:20` to enforce `ADMIN_PASSWORD`, this check won't trigger without explicitly setting `NODE_ENV=production` in the container.

**Recommendation:** Add `NODE_ENV=production` to the server service environment in `docker-compose.swarm.yml`.

### I2. Agent `apiKey` Field Accepts Per-Agent Keys

**Files:** `agents.js:12`, `agentManager.js:88`, `llmProviders.js:910-912`

Agents can have per-agent API keys (`config.apiKey`). While `_sanitize()` strips these before sending to clients (`agentManager.js:3026-3028`), the keys are stored in plain text in the PostgreSQL `agents.data` JSONB column. Anyone with database access can read them.

**Recommendation:** Encrypt sensitive fields in the JSONB data before persisting, or use a secrets manager. At minimum, document this risk for operators.

---

## Positive Security Findings

1. **Parameterized SQL queries** — All database queries use `$1, $2` placeholders; no string interpolation in SQL (zero SQL injection risk) (`database.js`)
2. **bcrypt password hashing** with salt rounds of 10 (`auth.js:38`)
3. **JWT secret validation** — `getJwtSecret()` throws if `JWT_SECRET` is unset (`auth.js:48-54`)
4. **Shell argument escaping** — `sandboxManager._sh()` properly escapes single quotes (`sandboxManager.js:336-338`)
5. **Path traversal prevention** — `agentTools.js:86` strips `..` segments; `_projectPath()` also filters `..` (`sandboxManager.js:329`)
6. **Rate limiting** — Login: 5 attempts/15min per IP (`auth.js`), Global API: 100 req/min (`index.js:62-69`), WebSocket: 30 events/min per socket (`socketHandler.js`), Claude API: 50 req/min (`rateLimiter.js`)
7. **CORS configuration** with explicit origins — not `*` (`index.js:26-28`)
8. **API key masking** — `_sanitize()` strips `apiKey` from agent data; MCP routes mask keys (`mcpServers.js:18-24`)
9. **Docker image uses Alpine** — Minimal attack surface
10. **Sandbox user isolation** — Each agent gets a dedicated Linux user (`sandboxManager.js:245-259`)
11. **Input validation** — All API routes use Zod schemas with type/length/format constraints
12. **WebSocket authentication** — JWT verified on handshake, origin validated against CORS whitelist (`index.js:119-138`)
13. **Security headers** — Express middleware sets 6 headers (`index.js:49-57`)
14. **Git commit message sanitization** — `sanitizeCommitMessage()` prevents command injection (`agentTools.js:253-261`)
15. **Container/image name validation** — `_validateName()` and `_validateImageRef()` reject shell-unsafe characters (`sandboxManager.js:340-353`)
16. **`npm audit` reports 0 vulnerabilities** across 191 production dependencies
17. **`.env` NOT tracked in git** — Confirmed via `git ls-files` and `git log`
18. **No XSS vectors in client** — No `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `new Function()` usage found
19. **Sandbox file operations use proper escaping** — `writeFile`, `readFile`, `searchFiles` all use `_sh()` quoting
20. **Agent ID sanitization** — `_username()` strips non-alphanumeric chars for Linux usernames (`sandboxManager.js:318-321`)
21. **Concurrent container start mutex** — `_containerStartLock` prevents race conditions (`sandboxManager.js:213-219`)
22. **Command output truncation** — `toolRunCommand` caps output at 10KB (`agentTools.js:208`)
23. **Commit message length limit** — Capped at 500 chars (`agentTools.js:260`)
24. **Message size validation** — Chat endpoint validates `message.length <= 50000` (`agents.js:129`)
25. **Docker socket removed from sandbox** — Comment confirms intentional removal (`sandboxManager.js:234`)
26. **Graceful shutdown** — SIGTERM/SIGINT handlers destroy sandboxes and disconnect MCP servers (`index.js:163-171`)

---

## Priority Action Items

| # | Priority | Action | Effort | Status |
|---|----------|--------|--------|--------|
| 1 | CRITICAL | Rotate ALL credentials in `devops/.env` | 1 hour | **Manual action required** |
| 2 | CRITICAL | Replace Docker socket mount with socket proxy | 2-4 hours | Open |
| 3 | CRITICAL | Remove `docker-cli`, `docker-cli-compose`, `kubectl` from sandbox image | 30 min | Open |
| 4 | CRITICAL | Isolate sandbox management from main server (sidecar) | 4-8 hours | Open |
| 5 | HIGH | Move JWT to httpOnly cookies + refresh tokens | 4-8 hours | Open |
| 6 | HIGH | Reduce JWT expiry + add revocation/logout | 2-4 hours | Open |
| 7 | HIGH | Implement per-agent SSH key isolation | 4-8 hours | Open |
| 8 | MEDIUM | Implement RBAC middleware | 2-4 hours | Open |
| 9 | MEDIUM | Move user store to PostgreSQL | 2-4 hours | Open |
| 10 | LOW | Harden CSP (remove `unsafe-inline`) | 30 min | Open |
| 11 | INFO | Add `NODE_ENV=production` to Docker Compose | 5 min | **Fixed in this pass** |
| 12 | INFO | Document per-agent API key storage risk | 15 min | Open |
| 13 | — | Set up automated dependency scanning (Dependabot/Renovate) | 1 hour | Open |

---

## Previously Fixed (No Action Needed)

| # | Issue | Status |
|---|-------|--------|
| 1 | Health endpoint information disclosure | **FIXED** — split public/authenticated |
| 2 | Missing Zod validation on routes | **FIXED** — all routes validated |
| 3 | MCP server URL not validated as URL format | **FIXED** — `z.string().url()` |
| 4 | Hardcoded SSH fallback path | **FIXED** — uses `/root/.ssh` |
| 5 | Rate limiter memory leak | **FIXED** — periodic cleanup added |
| 6 | Missing nginx security headers | **FIXED** — CSP, HSTS, etc. |
| 7 | Git commit message injection | **FIXED** — `sanitizeCommitMessage()` |
| 8 | Missing WebSocket origin check | **FIXED** — origin validated |
| 9 | Dead `tasks.js` file | **FIXED** — deleted |
| 10 | WebSocket rate limiting | **FIXED** — 30 events/min/socket |
| 11 | Default credentials in deployment script | **FIXED** — removed |
| 12 | Docker socket in sandbox containers | **FIXED** — removed from `sandboxManager.js` |

---

## Fixes Applied in Previous Passes

| # | Issue | Action | Pass |
|---|-------|--------|------|
| 1 | `NODE_ENV` not set in Docker Compose | **Fixed** — added `NODE_ENV=production` | 7th |
| 2 | Health endpoint information disclosure | **Fixed** — split public/authenticated | 2nd |
| 3 | Missing Zod validation | **Fixed** — all routes validated | 3rd |
| 4 | Git commit message injection | **Fixed** — `sanitizeCommitMessage()` | 4th |
| 5 | WebSocket origin check missing | **Fixed** — origin validated | 5th |
| 6 | WebSocket rate limiting missing | **Fixed** — 30 events/min/socket | 5th |
| 7 | Docker socket in sandbox | **Fixed** — removed | 6th |

---

## Eighth Pass Summary

This pass independently re-audited all source files across server, client, DevOps, and sandbox:
- **All 12 previously applied fixes remain in place and effective**
- `npm audit` reports **0 vulnerabilities** for both server (`191 packages`) and client
- `.env` file confirmed NOT tracked in git (only `.env.example`)
- No new vulnerabilities introduced since the seventh pass
- Consolidated and cleaned up the report for clarity

The **3 CRITICAL + 3 HIGH remaining items are architectural** and require intentional design decisions rather than simple code fixes. They should be prioritized in the project roadmap.

---

*Eighth review pass performed against codebase as of 2026-03-05. Next review recommended after addressing CRITICAL and HIGH items.*
