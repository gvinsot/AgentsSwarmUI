import { readSecret } from '../secrets.js';

/**
 * Shared Google OAuth client config for Gmail, Drive, and any future Google
 * API (login, Calendar, Contacts, …).
 *
 * Google issues one OAuth client per Cloud Console project; the same
 * client_id / client_secret pair works for every Google API, and a single
 * registered redirect URI works for all of them — the originating service is
 * encoded in the OAuth `state` parameter, not the URL path. See
 * api/src/routes/googleOAuth.ts for the dispatch logic.
 *
 * Env vars (all three required for the config to be considered valid):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI
 *
 * The redirect URI must be registered in the Google Cloud Console.
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = readSecret('GOOGLE_CLIENT_SECRET');
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
