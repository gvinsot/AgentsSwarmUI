/**
 * Discover available projects by listing GitHub starred repos.
 * Replaces the old filesystem scan of /projects.
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let _cache = null;
let _cacheTime = 0;

/**
 * List starred repos for the configured GitHub user.
 * Returns [{ name, sshUrl, httpsUrl, description }]
 */
export async function listStarredRepos() {
  const token = process.env.GITHUB_TOKEN;
  const user = process.env.GITHUB_USER;
  if (!token || !user) {
    console.warn('⚠️  GITHUB_TOKEN or GITHUB_USER not set — cannot list projects');
    return [];
  }

  // Return cached result if fresh
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) return _cache;

  try {
    const repos = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      const res = await fetch(
        `https://api.github.com/users/${user}/starred?per_page=${perPage}&page=${page}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        }
      );

      if (!res.ok) {
        console.error(`GitHub API error: ${res.status} ${res.statusText}`);
        break;
      }

      const data = await res.json();
      if (!data.length) break;

      for (const repo of data) {
        repos.push({
          name: repo.name,
          fullName: repo.full_name,
          sshUrl: repo.ssh_url,
          httpsUrl: repo.clone_url,
          description: repo.description || '',
        });
      }

      if (data.length < perPage) break;
      page++;
    }

    _cache = repos;
    _cacheTime = Date.now();
    return repos;
  } catch (err) {
    console.error('Failed to fetch starred repos:', err.message);
    return _cache || [];
  }
}

/**
 * Get the git clone URL for a specific project name.
 * Returns the SSH URL (for cloning with SSH keys).
 */
export async function getProjectGitUrl(projectName) {
  const repos = await listStarredRepos();
  const repo = repos.find(r => r.name === projectName);
  return repo?.sshUrl || null;
}

/**
 * Invalidate the cache (e.g. after starring a new repo).
 */
export function invalidateProjectCache() {
  _cache = null;
  _cacheTime = 0;
}
