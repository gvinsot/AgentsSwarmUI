# Security Review — AgentsSwarmUI

**Date:** 2026-03-05 (Updated)
**Reviewer:** CLAUDE (Automated Security Agent)
**Scope:** Full-stack review of server, client, DevOps, and dependency management

---

## Executive Summary

The AgentsSwarmUI project follows several security best practices (JWT auth, bcrypt hashing, parameterized SQL, rate limiting, sandbox isolation, security headers). A comprehensive review identified **critical**, **high**, and **medium** issues. Several have been **fixed in this review cycle**; remaining items are documented below with remediation plans.

| Severity | Total Found | Fixed | Remaining |
|----------|------------|-------|-----------|
| CRITICAL | 3 | 1 | 2 |
| HIGH     | 5 | 3 | 2 |
| MEDIUM   | 5 | 3 | 2 |
| LOW      | 3 | 2 | 1 |

---

## Fixes Applied in This Review

### FIX 1: Health Endpoint Information Disclosure (was C3)
- **Status:** FIXED
- Split `/api/health` into public liveness probe (`{ status: 'ok' }`) and authenticated `/api/health/details`

### FIX 2: Zod Input Validation on All API Routes (was H3)
- **Status:** FIXED
- Added Zod schemas to validate request bodies on:
  - `POST /api/agents` and `PUT /api/agents/:id` (agent creation/update)
  - `POST /api/plugins` and `PUT /api/plugins/:id` (plugin creation/update)
  - `POST /api/mcp-servers` and `PUT /api/mcp-servers/:id` (MCP server creation/update)
- All fields are whitelisted with type/length constraints, preventing prototype pollution and arbitrary field injection

### FIX 3: Default Credentials Warning (was H1)
- **Status:** FIXED (partially — warning added, but still allows startup)
- Loud console warning logged when `ADMIN_PASSWORD` is not set

### FIX 4: Security Headers on Express API (new)
- **Status:** FIXED
- Added middleware setting `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy` on all API responses

### FIX 5: WebSocket Origin Validation (was part of H2)
- **Status:** FIXED
- WebSocket handshake now validates `Origin` header against the CORS allowed origins list

### FIX 6: Command Injection in git_commit_push (new finding)
- **Status:** FIXED
- Replaced weak double-quote escaping with comprehensive `sanitizeCommitMessage()` that strips shell metacharacters (backticks, `$`, `\`, `!`, null bytes, newlines), escapes single quotes, and truncates to 500 chars

### FIX 7: Rate Limiter Memory Leak (was part of M3)
- **Status:** FIXED
- Added periodic cleanup of expired login rate-limit entries

### FIX 8: Nginx Security Headers (was M4, L2, L3)
- **Status:** FIXED
- Added `Content-Security-Policy`, `Strict-Transport-Security` to nginx config
- `X-XSS-Protection` deprecated header is still present for legacy browser compatibility

### FIX 9: .gitignore Hardening
- **Status:** FIXED
- `devops/.env` explicitly added to `.gitignore`

---

## Remaining CRITICAL Issues

### C1. Production Secrets in `devops/.env`

**File:** `devops/.env`
**Impact:** Full compromise of all integrated services

The `devops/.env` file contains **real production secrets** in plaintext:
- Anthropic, OpenAI, Mistral API keys
- GitHub personal access token
- PostgreSQL database credentials
- Admin password, JWT secret

**Status:** File is NOT tracked by git (`.gitignore` covers it), but secrets should be rotated.

**Recommendations:**
1. **Immediately rotate ALL exposed credentials**
2. Use Docker Swarm secrets or a secrets manager
3. Run `git log --all -- devops/.env` to verify no accidental past commits

### C2. Docker Socket Mounted into Server Container

**File:** `devops/docker-compose.swarm.yml:30`

Mounting the Docker socket gives the server container root-level access to the host.

**Recommendations:**
1. Use a Docker socket proxy (e.g., Tecnativa/docker-socket-proxy)
2. Restrict Docker API access to only required commands
3. Consider rootless Docker or Podman

---

## Remaining HIGH Issues

### H1. JWT Token Stored in localStorage

**File:** `client/src/api.js`

Tokens in `localStorage` are accessible to any JavaScript on the page, making them vulnerable to XSS-based token theft.

**Recommendations:**
1. Use `httpOnly` cookies for token storage
2. Implement short-lived access token + refresh token pattern
3. CSP header (now added) provides defense-in-depth

### H2. npm Audit — Transitive Dependency Vulnerabilities

**Current status:** `npm audit` reports 0 vulnerabilities (previously had hono-related issues, now resolved via dependency updates).

**Recommendations:**
1. Set up automated dependency scanning (Dependabot, Renovate)
2. Run `npm audit` in CI/CD pipeline

---

## Remaining MEDIUM Issues

### M1. No Role-Based Authorization (RBAC)

All authenticated users have identical access. The `role` field exists on JWT tokens but is never checked.

**Recommendation:** Implement middleware that checks `req.user.role` for destructive operations.

### M2. In-Memory User Store

Users are stored in memory and lost on restart.

**Recommendation:** Store users in the PostgreSQL database (already available).

---

## Remaining LOW Issues

### L1. No Per-Route Request Body Size Limits

**File:** `server/src/index.js`

A global 10MB limit is set. Consider applying smaller limits to routes that don't need large bodies.

---

## Positive Security Findings

1. **Parameterized SQL queries** — All database queries use `$1, $2` placeholders (no SQL injection)
2. **bcrypt password hashing** with salt rounds of 10
3. **JWT secret validation** — Server refuses to start without `JWT_SECRET`
4. **Shell argument escaping** — `sandboxManager._sh()` properly escapes single quotes
5. **Path traversal prevention** — `agentTools.js` strips `..` segments from file paths
6. **Rate limiting** on login endpoints and Claude API calls
7. **CORS configuration** with explicit origins (not `*`)
8. **MCP API key masking** — Server sanitizes API keys before sending to client (`_sanitize()`)
9. **Agent API key masking** — `agentManager._sanitize()` strips `apiKey` field from all API responses
10. **Docker image uses Alpine** — Minimal attack surface
11. **Sandbox isolation** — Agents run as separate Linux users inside a shared container
12. **Input validation on names** — `_validateName()` and `_validateImageRef()` in SandboxManager
13. **Security headers** in nginx and Express (X-Frame-Options, X-Content-Type-Options, CSP, HSTS, Referrer-Policy)
14. **Zod schema validation** on all creation/update API routes
15. **WebSocket origin validation** prevents cross-site WebSocket hijacking
16. **Git commit message sanitization** prevents command injection via agent tool calls

---

## Remaining Priority Action Items

| Priority | Action | Effort | Status |
|----------|--------|--------|--------|
| 1 | Rotate ALL credentials in `devops/.env` | 1 hour | **Manual action required** |
| 2 | Replace Docker socket mount with socket proxy | 2-4 hours | Open |
| 3 | Move JWT to httpOnly cookies + refresh tokens | 4-8 hours | Open |
| 4 | Implement RBAC middleware | 2-4 hours | Open |
| 5 | Move user store to PostgreSQL | 2-4 hours | Open |
| 6 | Set up automated dependency scanning | 1 hour | Open |
