/**
 * Legacy compatibility wrapper — delegates to gitProvider.
 *
 * All existing imports of `listStarredRepos`, `getProjectGitUrl`,
 * `createProjectFromBoilerplate`, and `invalidateProjectCache`
 * continue to work unchanged.
 */

import {
  listRepos,
  getProjectGitUrl as _getProjectGitUrl,
  createProjectFromBoilerplate as _createProjectFromBoilerplate,
  invalidateCache,
} from './gitProvider.js';

export async function listStarredRepos() {
  return listRepos();
}

export async function getProjectGitUrl(projectName: string) {
  return _getProjectGitUrl(projectName);
}

export async function createProjectFromBoilerplate(name: string, description = '', isPrivate = false) {
  return _createProjectFromBoilerplate(name, description, isPrivate);
}

export function invalidateProjectCache() {
  invalidateCache();
}
