import { readSecret } from '../secrets.js';

/**
 * Shared Google OAuth client config for Gmail, Drive, and any future Google API.
 *
 * Google issues one OAuth client per Cloud Console project; the same
 * client_id / client_secret pair works for every Google API, and a single
 * registered redirect URI works for all of them — the originating service
 * is encoded in the OAuth `state` parameter, not the URL path. See
 * api/src/routes/googleOAuth.ts for the dispatch logic.
 *
 * Resolution order (first non-empty wins, for each field independently):
 *   1. GOOGLE_CLIENT_ID  / GOOGLE_CLIENT_SECRET  / GOOGLE_REDIRECT_URI   (preferred)
 *   2. GMAIL_CLIENT_ID   / GMAIL_CLIENT_SECRET   / GMAIL_REDIRECT_URI    (legacy)
 *   3. GDRIVE_CLIENT_ID  / GDRIVE_CLIENT_SECRET  / GDRIVE_REDIRECT_URI   (legacy)
 *
 * The redirect URI is used as-is and must be registered in the Google Cloud
 * Console. The API mounts the unified handler under multiple paths so any
 * of the legacy configs keep working without further changes — see
 * api/src/index.ts.
 */

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const v of values) if (v) return v;
  return undefined;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = firstNonEmpty(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GMAIL_CLIENT_ID,
    process.env.GDRIVE_CLIENT_ID,
  );
  const clientSecret = firstNonEmpty(
    readSecret('GOOGLE_CLIENT_SECRET'),
    readSecret('GMAIL_CLIENT_SECRET'),
    readSecret('GDRIVE_CLIENT_SECRET'),
  );
  const redirectUri = firstNonEmpty(
    process.env.GOOGLE_REDIRECT_URI,
    process.env.GMAIL_REDIRECT_URI,
    process.env.GDRIVE_REDIRECT_URI,
  );

  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}
