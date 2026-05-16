/**
 * Detect the deployment environment from an Express request's hostname.
 *
 * Returns:
 *   - "prod"   for apex domains (e.g. pulsarteam.io) and "www" subdomain
 *   - "dev"    for localhost / raw IPs
 *   - the leading subdomain otherwise (e.g. "qa", "staging", "preview")
 *
 * Used so several deployments sharing a single DB can be told apart, and
 * so the UI can badge non-prod tasks.
 */
export function detectEnvironment(host: string | undefined | null): string {
  if (!host) return 'prod';
  const hostname = String(host).split(':')[0].toLowerCase();
  if (!hostname) return 'prod';
  if (hostname === 'localhost' || /^(\d+\.){3}\d+$/.test(hostname)) return 'dev';
  const parts = hostname.split('.');
  if (parts.length <= 2) return 'prod';
  const subdomain = parts[0];
  if (subdomain === 'www') return 'prod';
  return subdomain;
}

// ─── Instance-level environment cache ──────────────────────────────────────
// Each API replica needs to know which deployment it serves so the workflow
// engine can ignore tasks that belong to a sibling replica sharing the DB.
// The value is set once: either from the APP_ENVIRONMENT env var at boot, or
// from the first public-facing HTTP request we observe (so QA locks to "qa"
// the moment a user hits qa.example.com). Healthchecks and internal docker
// service hostnames are skipped so they can't lock the instance to "dev".

let _currentEnv: string | null = null;

const envFromVar = (process.env.APP_ENVIRONMENT || '').trim().toLowerCase();
if (envFromVar) {
  _currentEnv = envFromVar;
  console.log(`[Environment] Instance pinned to "${_currentEnv}" via APP_ENVIRONMENT`);
}

/** Returns the locked environment, or "prod" as a safe default. */
export function getCurrentEnvironment(): string {
  return _currentEnv || 'prod';
}

/** Returns true once the instance has observed a real public hostname. */
export function isEnvironmentLocked(): boolean {
  return _currentEnv !== null;
}

/**
 * Lock the instance's environment from a request hostname. No-op if already
 * locked, or if the host is a docker/internal/healthcheck name (no dot,
 * localhost, IP). Public domains with at least one dot pass through.
 */
export function setCurrentEnvironmentFromHost(host: string | undefined | null): void {
  if (_currentEnv) return;
  if (!host) return;
  const hostname = String(host).split(':')[0].toLowerCase();
  if (!hostname) return;
  if (hostname === 'localhost' || /^(\d+\.){3}\d+$/.test(hostname)) return;
  if (!hostname.includes('.')) return; // docker service name like "team-api"
  _currentEnv = detectEnvironment(hostname);
  console.log(`[Environment] Instance locked to "${_currentEnv}" (from host="${hostname}")`);
}
