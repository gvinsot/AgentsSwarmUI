/**
 * Build a git clone URL for a repo identified by its `owner/repo` full name.
 * Returns null when the input doesn't look like a GitHub-style full name.
 *
 * Credentials are injected separately via `getGitHubCredentialsForAgent` —
 * the URL itself stays anonymous.
 */
export function buildRepoCloneUrl(fullName: string | null | undefined): string | null {
  if (!fullName || typeof fullName !== 'string') return null;
  if (!fullName.includes('/')) return null;
  // Reject paths/whitespace that could break the URL
  if (/\s/.test(fullName)) return null;
  return `https://github.com/${fullName}.git`;
}
