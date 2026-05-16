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
